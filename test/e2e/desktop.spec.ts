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

const GATEWAY_TIMEOUT = process.env.CI ? 30_000 : 15_000;

async function waitForHealth(url: string): Promise<void> {
  await expect
    .poll(async () => (await fetch(`${url}/health`)).ok, { timeout: GATEWAY_TIMEOUT })
    .toBe(true);
}

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

test('loads a secure desktop renderer and starts the gateway', async () => {
  await expect(page.getByRole('heading', { name: 'Warrant' })).toBeVisible();
  const capabilities = await page.evaluate(() => ({
    hasDesktopApi: typeof window.warrantDesktop !== 'undefined',
    hasRequire: typeof (window as unknown as { require?: unknown }).require !== 'undefined',
    hasProcess: typeof (window as unknown as { process?: unknown }).process !== 'undefined',
  }));
  expect(capabilities).toMatchObject({ hasDesktopApi: true, hasRequire: false, hasProcess: false });
  await expect(page.getByText(/Gateway running|Proxy online/)).toBeVisible({
    timeout: GATEWAY_TIMEOUT,
  });
  await waitForHealth(`http://127.0.0.1:${gatewayPort}`);
});

test('exposes lifecycle controls and updates status after stop and start', async () => {
  await expect(page.getByRole('button', { name: 'Stop' })).toBeEnabled({
    timeout: GATEWAY_TIMEOUT,
  });
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Gateway stopped')).toBeVisible({ timeout: GATEWAY_TIMEOUT });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByText('Gateway running')).toBeVisible({ timeout: GATEWAY_TIMEOUT });
  await expect(page.getByRole('button', { name: 'Stop' })).toBeEnabled();
});
