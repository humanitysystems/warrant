import { contextBridge, ipcRenderer } from 'electron';
import type { GatewayStatus } from './gateway.js';

export type WarrantDesktopApi = {
  gateway: {
    getStatus: () => Promise<GatewayStatus>;
    start: () => Promise<GatewayStatus>;
    stop: () => Promise<GatewayStatus>;
    restart: () => Promise<GatewayStatus>;
    onStatus: (listener: (status: GatewayStatus) => void) => () => void;
  };
};

const api: WarrantDesktopApi = {
  gateway: {
    getStatus: () => ipcRenderer.invoke('gateway:get-status'),
    start: () => ipcRenderer.invoke('gateway:start'),
    stop: () => ipcRenderer.invoke('gateway:stop'),
    restart: () => ipcRenderer.invoke('gateway:restart'),
    onStatus: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, status: GatewayStatus) =>
        listener(status);
      ipcRenderer.on('gateway:status', handler);
      return () => ipcRenderer.removeListener('gateway:status', handler);
    },
  },
};

contextBridge.exposeInMainWorld('warrantDesktop', api);
