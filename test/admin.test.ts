import { describe, expect, it } from 'vitest';
import { createAdminApp } from '@/admin/app';
import { McpProxy } from '@/proxy/proxy';

describe('admin API', () => {
  it('exposes proxy status, servers, tools, and events', async () => {
    const proxy = new McpProxy({ server: { host: '127.0.0.1', adminPort: 8787 }, downstream: [] });
    proxy.events.append({ kind: 'server.connected', serverName: 'test' });
    const app = createAdminApp(proxy);

    const status = await app.request('/api/status');
    const events = await app.request('/api/events');

    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ ok: true, tools: 0 });
    expect(await events.json()).toMatchObject({ events: [{ kind: 'server.connected' }] });
  });
});
