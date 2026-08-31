import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/status')
      return route.fulfill({
        json: { servers: { total: 1, connected: 1 }, tools: 1, clientTransport: 'stdio' },
      });
    if (url.pathname === '/api/servers')
      return route.fulfill({
        json: {
          servers: [
            {
              name: 'demo',
              status: 'connected',
              transport: 'stdio',
              tools: [{ exposedName: 'demo__echo', downstreamName: 'echo' }],
            },
          ],
        },
      });
    if (url.pathname === '/api/tools')
      return route.fulfill({
        json: {
          tools: [{ exposedName: 'demo__echo', serverName: 'demo', downstreamName: 'echo' }],
        },
      });
    if (url.pathname === '/api/events') return route.fulfill({ json: { events: [] } });
    if (url.pathname === '/api/holds') return route.fulfill({ json: { holds: [] } });
    return route.fulfill({ status: 200, body: '' });
  });
  await page.addInitScript(() => {
    let state = { state: 'running', url: 'http://127.0.0.1:8787' };
    (window as unknown as { warrantDesktop: unknown }).warrantDesktop = {
      gateway: {
        getStatus: async () => state,
        start: async () => (state = { ...state, state: 'running' }),
        stop: async () => (state = { ...state, state: 'stopped' }),
        restart: async () => state,
        onStatus: () => () => undefined,
      },
    };
  });
  await page.goto('/');
});

test('renders gateway controls and proxy data headlessly', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Warrant' })).toBeVisible();
  await expect(page.getByText('Gateway running')).toBeVisible();
  await expect(page.getByText('demo__echo')).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Gateway stopped')).toBeVisible();
});
