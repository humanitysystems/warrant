import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, Tray } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, writeConfig } from '@/config/loader';
import type { WarrantConfig } from '@/config/schema';
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

/** Active config state — tracks the currently loaded file and in-memory config. */
let activeConfigPath: string | null = null;
let activeConfig: WarrantConfig | null = null;

function buildMenu(supervisor: GatewaySupervisor): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Config',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            activeConfigPath = null;
            activeConfig = null;
            updateWindowTitle();
            mainWindow?.webContents.send('config:changed', {
              path: null,
              config: null,
            });
          },
        },
        {
          label: 'Open Config…',
          accelerator: 'CmdOrCtrl+O',
          click: () => void handleOpenConfig(supervisor),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => void handleSaveConfig(),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => void handleSaveAsConfig(supervisor),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function updateWindowTitle(): void {
  if (!mainWindow) return;
  const suffix = activeConfigPath ? ` — ${activeConfigPath.split(/[/\\]/).pop()}` : '';
  mainWindow.setTitle(`Warrant${suffix}`);
}

async function handleOpenConfig(supervisor: GatewaySupervisor): Promise<void> {
  const result = await dialog.showOpenDialog({
    title: 'Open Warrant Config',
    filters: [
      { name: 'YAML', extensions: ['yaml', 'yml'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return;

  const filePath = result.filePaths[0];
  try {
    const config = await loadConfig(filePath);
    activeConfigPath = filePath;
    activeConfig = config;
    updateWindowTitle();
    await supervisor.restartWithConfig(filePath);
    mainWindow?.webContents.send('config:changed', {
      path: activeConfigPath,
      config: activeConfig,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('Invalid Config', `Failed to load config:\n${message}`);
  }
}

async function handleSaveConfig(): Promise<void> {
  if (!activeConfigPath || !activeConfig) return;
  try {
    await writeConfig(activeConfigPath, activeConfig);
    mainWindow?.webContents.send('config:saved', { path: activeConfigPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('Save Failed', `Could not save config:\n${message}`);
  }
}

async function handleSaveAsConfig(supervisor: GatewaySupervisor): Promise<void> {
  const result = await dialog.showSaveDialog({
    title: 'Save Warrant Config As',
    defaultPath: activeConfigPath ?? 'warrant.yaml',
    filters: [
      { name: 'YAML', extensions: ['yaml', 'yml'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) return;

  const filePath = result.filePath;
  try {
    // If no in-memory config yet, try to load from the current path.
    const configToSave = activeConfig ?? (activeConfigPath ? await loadConfig(activeConfigPath) : null);
    if (!configToSave) {
      dialog.showErrorBox('No Config', 'No config loaded to save.');
      return;
    }
    await writeConfig(filePath, configToSave);
    activeConfigPath = filePath;
    activeConfig = configToSave;
    updateWindowTitle();
    await supervisor.restartWithConfig(filePath);
    mainWindow?.webContents.send('config:changed', {
      path: activeConfigPath,
      config: activeConfig,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('Save Failed', `Could not save config:\n${message}`);
  }
}

function createSupervisor(): GatewaySupervisor {
  const appRoot = app.getAppPath();
  // When packaged, prefer the user-editable warrant.yaml from extraResources.
  // process.resourcesPath points to the resources/ dir next to the executable.
  const defaultConfig = app.isPackaged
    ? join(process.resourcesPath, 'warrant.yaml')
    : join(appRoot, 'warrant.yaml');
  return new GatewaySupervisor({
    serverEntry: join(appRoot, 'dist/server.js'),
    configPath: process.env.WARRANT_CONFIG ?? defaultConfig,
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

  // Config IPC handlers
  ipcMain.handle('config:getPath', () => activeConfigPath);
  ipcMain.handle('config:get', () => ({
    path: activeConfigPath,
    config: activeConfig,
  }));
  ipcMain.handle('config:set', (_event, config: WarrantConfig) => {
    activeConfig = config;
    return { path: activeConfigPath, config: activeConfig };
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

  // Set the File menu and initial window title.
  Menu.setApplicationMenu(buildMenu(supervisor));
  updateWindowTitle();

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
