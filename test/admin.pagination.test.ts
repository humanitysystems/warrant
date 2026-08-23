import { describe, expect, it } from 'vitest';
import { createAdminApp } from '@/admin/app';
import { EventStore } from '@/events/event-store';
import { McpProxy } from '@/proxy/proxy';

describe('admin API events pagination', () => {
  it('serves limit and cursor pages over HTTP', async () => {
    const store = new EventStore();
    const proxy = new McpProxy(
      { server: { host: '127.0.0.1', adminPort: 8787 }, downstream: [] },
      store,
    );
    for (let i = 1; i <= 5; i += 1) {
      proxy.events.append({ kind: 'request.started', method: 'tools/call', name: `tool-${i}` });
    }
    const app = createAdminApp(proxy);

    const first = await app.request('/api/events?limit=2');
    expect(first.status).toBe(200);
    const firstPage = (await first.json()) as {
      events: { name?: string; seq?: number }[];
      nextCursor?: number;
    };
    expect(firstPage.events.map((event) => event.name)).toEqual(['tool-5', 'tool-4']);
    expect(firstPage.nextCursor).toBe(firstPage.events.at(-1)?.seq);

    const second = await app.request(`/api/events?limit=2&before=${firstPage.nextCursor}`);
    const secondPage = (await second.json()) as { events: { name?: string }[] };
    expect(secondPage.events.map((event) => event.name)).toEqual(['tool-3', 'tool-2']);

    store.close();
  });
});
