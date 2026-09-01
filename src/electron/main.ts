import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, Tray } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GatewaySupervisor } from './gateway.js';

export type DesktopPlatform = {
  createWindow: (
    preloadPath: string,
    options: { file?: string; url?: string },
  ) => Promise<BrowserWindow>;
  createTray: (onShow: () => void, supervisor: GatewaySupervisor) => Tray;
  setLoginItem: (enabled: boolean) => void;
  notify: (title: string, body: string) => void;
};

export const electronPlatform: DesktopPlatform = {
  createWindow: async (preloadPath, { file, url }) => {
    const window = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 900,
      minHeight: 640,
      backgroundColor: '#0b0d11',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    if (url) await window.loadURL(url);
    else if (file) await window.loadFile(file);
    return window;
  },
  createTray: (onShow, supervisor) => {
    const nextTray = new Tray(nativeImage.createEmpty());
    nextTray.setToolTip('Warrant MCP gateway');
    nextTray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show Warrant', click: onShow },
        { type: 'separator' },
        { label: 'Start gateway', click: () => void supervisor.start() },
        { label: 'Stop gateway', click: () => void supervisor.stop() },
        { label: 'Restart gateway', click: () => void supervisor.restart() },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
    nextTray.on('click', onShow);
    return nextTray;
  },
  setLoginItem: (enabled) => app.setLoginItemSettings({ openAtLogin: enabled }),
  notify: (title, body) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  },
};

let mainWindow: BrowserWindow | undefined;
let eventMonitor: EventMonitor | undefined;
let quitting = false;

function createSupervisor(): GatewaySupervisor {
  const appRoot = app.getAppPath();
  return new GatewaySupervisor({
    serverEntry: join(appRoot, 'dist/server.js'),
    configPath: process.env.WARRANT_CONFIG ?? join(appRoot, 'warrant.yaml'),
    cwd: app.isPackaged ? app.getPath('userData') : process.cwd(),
    host: process.env.WARRANT_ADMIN_HOST,
    port: process.env.WARRANT_ADMIN_PORT ? Number(process.env.WARRANT_ADMIN_PORT) : undefined,
  });
}

async function bootstrap(platform: DesktopPlatform = electronPlatform): Promise<void> {
  const supervisor = createSupervisor();
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
  const show = () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  // Start the gateway first so the UI can reach the API.
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  try {
    await supervisor.start();
  } catch (error) {
    console.error('Unable to start Warrant gateway:', error);
  }

  // In dev mode, load from Vite (proxy forwards /api to gateway).
  // In production, load from the gateway's own HTTP server so
  // relative /api/... fetch calls resolve correctly.
  mainWindow = await platform.createWindow(
    join(dirname(fileURLToPath(import.meta.url)), 'preload.cjs'),
    devUrl ? { url: devUrl } : { url: supervisor.url },
  );
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
  const tray = platform.createTray(show, supervisor);
  tray.setToolTip('Warrant MCP gateway');
  platform.setLoginItem(true);
  supervisor.onStatus((status) => {
    mainWindow?.webContents.send('gateway:status', status);
    if (status.state === 'running') {
      eventMonitor?.close();
      eventMonitor = new EventMonitor(status.url, platform);
      void eventMonitor.start();
    } else if (status.state === 'stopped' || status.state === 'error') {
      eventMonitor?.close();
      eventMonitor = undefined;
    }
  });
  app.on('activate', show);
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    eventMonitor?.close();
    void supervisor.stop().finally(() => app.quit());
  });
}

class EventMonitor {
  private readonly controller = new AbortController();
  private closed = false;
  constructor(
    private readonly baseUrl: string,
    private readonly platform: DesktopPlatform,
  ) {}
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
      if (event.kind === 'request.held')
        this.platform.notify(
          'Warrant approval required',
          `${event.serverName ?? 'A server'} requested ${event.name ?? 'a tool call'}`,
        );
    } catch {
      /* Ignore malformed events. */
    }
  }
}
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
if (!process.env.VITEST) app.whenReady().then(() => void bootstrap());
export { bootstrap };
