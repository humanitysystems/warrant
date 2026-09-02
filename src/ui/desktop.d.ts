import type { WarrantDesktopApi, ConfigInfo } from '@/electron/preload';
import type { GatewayStatus } from '@/electron/gateway';

declare global {
  interface Window {
    warrantDesktop?: WarrantDesktopApi;
  }
}

export type { GatewayStatus, ConfigInfo };
