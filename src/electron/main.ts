import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, Tray } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GatewaySupervisor } from './gateway.js';

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let eventMonitor: EventMonitor | undefined;

function createSupervisor(): GatewaySupervisor {
  const appRoot = app.getAppPath();
  return new GatewaySupervisor({
    serverEntry: join(appRoot, 'dist/server.js'),
    configPath: process.env.WARRANT_CONFIG ?? join(appRoot, 'warrant.yaml'),
    cwd: app.isPackaged ? app.getPath('userData') : process.cwd(),
  });
}

async function createWindow(supervisor: GatewaySupervisor): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0b0d11',
    webPreferences: {
      preload: join(dirname(fileURLToPath(import.meta.url)), 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(join(app.getAppPath(), 'dist/ui/index.html'));
  }

  supervisor.onStatus((status) => {
    mainWindow?.webContents.send('gateway:status', status);
    if (status.state === 'running') {
      eventMonitor?.close();
      eventMonitor = new EventMonitor(status.url);
      void eventMonitor.start();
    } else if (status.state === 'stopped' || status.state === 'error') {
      eventMonitor?.close();
      eventMonitor = undefined;
    }
  });
}

function createTray(supervisor: GatewaySupervisor): void {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Warrant MCP gateway');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Warrant', click: () => showWindow() },
      { type: 'separator' },
      { label: 'Start gateway', click: () => void supervisor.start() },
      { label: 'Stop gateway', click: () => void supervisor.stop() },
      { label: 'Restart gateway', click: () => void supervisor.restart() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', () => showWindow());
}

function showWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function registerIpc(supervisor: GatewaySupervisor): void {
  ipcMain.handle('gateway:get-status', () => supervisor.status);
  ipcMain.handle('gateway:start', async () => {
    await supervisor.start();
    return supervisor.status;
  });
  ipcMain.handle('gateway:stop', async () => {
    await supervisor.stop();
    return supervisor.status;
  });
  ipcMain.handle('gateway:restart', async () => {
    await supervisor.restart();
    return supervisor.status;
  });
}

async function bootstrap(): Promise<void> {
  const supervisor = createSupervisor();
  registerIpc(supervisor);
  await createWindow(supervisor);
  createTray(supervisor);
  app.setLoginItemSettings({ openAtLogin: true });

  app.on('activate', showWindow);
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    eventMonitor?.close();
    void supervisor.stop().finally(() => app.quit());
  });

  try {
    await supervisor.start();
  } catch (error) {
    console.error('Unable to start Warrant gateway:', error);
  }
}

app.whenReady().then(() => void bootstrap());

class EventMonitor {
  private readonly controller = new AbortController();
  private closed = false;

  constructor(private readonly baseUrl: string) {}

  close(): void {
    this.closed = true;
    this.controller.abort();
  }

  async start(): Promise<void> {
    while (!this.closed) {
      try {
        const response = await fetch(`${this.baseUrl}/api/events/stream`, {
          signal: this.controller.signal,
        });
        if (!response.ok || !response.body)
          throw new Error(`event stream returned ${response.status}`);
        await this.read(response.body);
      } catch (error) {
        if (this.closed || (error instanceof Error && error.name === 'AbortError')) return;
        await delay(1_000);
      }
    }
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!this.closed) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        const records = buffer.split(/\r?\n\r?\n/);
        buffer = records.pop() ?? '';
        for (const record of records) this.handleRecord(record);
      }
    } finally {
      reader.releaseLock();
    }
  }

  private handleRecord(record: string): void {
    const data = record
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    try {
      const event = JSON.parse(data) as { kind?: string; name?: string; serverName?: string };
      if (event.kind !== 'request.held' || !Notification.isSupported()) return;
      new Notification({
        title: 'Warrant approval required',
        body: `${event.serverName ?? 'A server'} requested ${event.name ?? 'a tool call'}`,
      }).show();
    } catch {
      // Ignore malformed events; the browser console remains the source of truth.
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
