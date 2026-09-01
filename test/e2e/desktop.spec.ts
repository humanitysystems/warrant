import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron') as string;
const gatewayPort = 18878;
let app: ElectronApplication | undefined;
let page: Page;
let userDataDir: string;

test.beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'warrant-desktop-e2e-'));
  app = await electron.launch({
    executablePath: electronPath,
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ELECTRON_USER_DATA_DIR: userDataDir,
      WARRANT_CONFIG: join(process.cwd(), 'warrant.yaml'),
      WARRANT_ADMIN_PORT: String(gatewayPort),
      ELECTRON_DISABLE_SANDBOX: '1',
    },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  await app?.close();
  await rm(userDataDir, { recursive: true, force: true });
});

test('loads a secure desktop renderer with context isolation', async () => {
  await expect(page.getByRole('heading', { name: 'Warrant' })).toBeVisible();

  const capabilities = await page.evaluate(() => ({
    hasDesktopApi: typeof window.warrantDesktop !== 'undefined',
    hasRequire: typeof (window as unknown as { require?: unknown }).require !== 'undefined',
    hasProcess: typeof (window as unknown as { process?: unknown }).process !== 'undefined',
  }));

  // Preload bridge is exposed
  expect(capabilities.hasDesktopApi).toBe(true);
  // Node.js globals are NOT exposed to renderer (context isolation)
  expect(capabilities.hasRequire).toBe(false);
  expect(capabilities.hasProcess).toBe(false);
});

test('preload exposes typed gateway API', async () => {
  await expect(page.getByRole('heading', { name: 'Warrant' })).toBeVisible();

  const apiShape = await page.evaluate(() => {
    const api = window.warrantDesktop;
    if (!api) return null;
    return {
      hasGateway: typeof api.gateway === 'object' && api.gateway !== null,
      hasGetStatus: typeof api.gateway?.getStatus === 'function',
      hasStart: typeof api.gateway?.start === 'function',
      hasStop: typeof api.gateway?.stop === 'function',
      hasRestart: typeof api.gateway?.restart === 'function',
      hasOnStatus: typeof api.gateway?.onStatus === 'function',
    };
  });

  expect(apiShape).toEqual({
    hasGateway: true,
    hasGetStatus: true,
    hasStart: true,
    hasStop: true,
    hasRestart: true,
    hasOnStatus: true,
  });
});

test('IPC gateway status returns a valid state', async () => {
  await expect(page.getByRole('heading', { name: 'Warrant' })).toBeVisible();

  const status = await page.evaluate(async () => {
    const api = window.warrantDesktop;
    if (!api) return null;
    return api.gateway.getStatus();
  });

  expect(status).not.toBeNull();
  expect(status!.state).toMatch(/^(stopped|starting|running|stopping|error)$/);
});

test('gateway lifecycle controls respond to IPC calls', async () => {
  await expect(page.getByRole('heading', { name: 'Warrant' })).toBeVisible();

  // Stop the gateway (may already be stopped — that's fine)
  const afterStop = await page.evaluate(async () => {
    const api = window.warrantDesktop;
    if (!api) return null;
    return api.gateway.stop();
  });

  expect(afterStop).not.toBeNull();
  expect(afterStop!.state).toBe('stopped');

  // Start the gateway
  const afterStart = await page.evaluate(async () => {
    const api = window.warrantDesktop;
    if (!api) return null;
    return api.gateway.start();
  });

  expect(afterStart).not.toBeNull();
  expect(afterStart!.state).toMatch(/^(running|starting)$/);
});

test('renderer has no access to Node.js APIs', async () => {
  const security = await page.evaluate(() => ({
    hasFs: typeof (globalThis as Record<string, unknown>).require === 'function',
    hasChildProcess: typeof (globalThis as Record<string, unknown>).__dirname !== 'undefined',
    hasElectronRemote:
      typeof (window as unknown as { electron?: unknown }).electron !== 'undefined',
  }));

  expect(security.hasFs).toBe(false);
  expect(security.hasChildProcess).toBe(false);
  expect(security.hasElectronRemote).toBe(false);
});
