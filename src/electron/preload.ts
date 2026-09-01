import { contextBridge, ipcRenderer } from 'electron';
import type { GatewayStatus } from './gateway.js';

export type ConfigInfo = {
  path: string | null;
  config: Record<string, unknown> | null;
};

export type WarrantDesktopApi = {
  gateway: {
    getStatus: () => Promise<GatewayStatus>;
    start: () => Promise<GatewayStatus>;
    stop: () => Promise<GatewayStatus>;
    restart: () => Promise<GatewayStatus>;
    onStatus: (listener: (status: GatewayStatus) => void) => () => void;
  };
  config: {
    getPath: () => Promise<string | null>;
    get: () => Promise<ConfigInfo>;
    set: (config: Record<string, unknown>) => Promise<ConfigInfo>;
    onChanged: (listener: (info: ConfigInfo) => void) => () => void;
    onSaved: (listener: (info: { path: string }) => void) => () => void;
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
  config: {
    getPath: () => ipcRenderer.invoke('config:getPath'),
    get: () => ipcRenderer.invoke('config:get'),
    set: (config) => ipcRenderer.invoke('config:set', config),
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, info: ConfigInfo) => listener(info);
      ipcRenderer.on('config:changed', handler);
      return () => ipcRenderer.removeListener('config:changed', handler);
    },
    onSaved: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, info: { path: string }) =>
        listener(info);
      ipcRenderer.on('config:saved', handler);
      return () => ipcRenderer.removeListener('config:saved', handler);
    },
  },
};

contextBridge.exposeInMainWorld('warrantDesktop', api);
