import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import type { McpProxy } from '@/proxy/proxy';

export function createAdminApp(proxy: McpProxy, production = false): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/api/status', (c) => {
    const servers = proxy.registry.serversList();
    return c.json({
      ok: true,
      process: 'warrant',
      clientTransport: 'stdio',
      servers: {
        total: servers.length,
        connected: servers.filter((server) => server.status === 'connected').length,
      },
      tools: proxy.registry.toolsList().length,
    });
  });
  app.get('/api/servers', (c) => c.json({ servers: proxy.registry.serversList() }));
  app.get('/api/tools', (c) => c.json({ tools: proxy.registry.toolsList() }));
  app.get('/api/holds', (c) => c.json({ holds: proxy.listHolds() }));
  app.post('/api/holds/:requestId/:decision', (c) => {
    const decision = c.req.param('decision');
    if (decision !== 'approve' && decision !== 'deny') {
      return c.json({ error: 'decision must be approve or deny' }, 400);
    }
    const resolved = proxy.resolveHold(c.req.param('requestId'), decision === 'approve');
    return resolved ? c.json({ ok: true }) : c.json({ error: 'unknown hold' }, 404);
  });
  app.get('/api/events', (c) => {
    const limitParam = c.req.query('limit');
    const beforeParam = c.req.query('before');
    const limit = limitParam !== undefined ? Number(limitParam) : undefined;
    const before = beforeParam !== undefined ? Number(beforeParam) : undefined;
    if (
      (limit !== undefined && !Number.isInteger(limit)) ||
      (before !== undefined && !Number.isInteger(before))
    ) {
      return c.json({ error: 'limit and before must be integers' }, 400);
    }
    const page = proxy.events.list({
      ...(limit !== undefined ? { limit } : {}),
      ...(before !== undefined ? { before } : {}),
    });
    return c.json(page);
  });
  app.get('/api/events/stream', (c) =>
    streamSSE(c, async (stream) => {
      let wake: (() => void) | undefined;
      let aborted = false;
      const unsubscribe = proxy.events.subscribe((event) => {
        void stream.writeSSE({ data: JSON.stringify(event), id: event.id });
        wake?.();
      });

      await stream.writeSSE({ data: JSON.stringify({ connected: true }), event: 'connected' });
      const keepalive = setInterval(() => {
        void stream.writeSSE({ data: '', event: 'keepalive' });
      }, 15_000);
      c.req.raw.signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          wake?.();
        },
        { once: true },
      );
      while (!aborted)
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      clearInterval(keepalive);
      unsubscribe();
    }),
  );

  if (production) {
    const uiRoot = fileURLToPath(new URL('../ui', import.meta.url));
    app.get('/', async (c) => c.html(await readFile(`${uiRoot}/index.html`, 'utf8')));
    app.use('/*', serveStatic({ root: uiRoot }));
    app.get('*', serveStatic({ path: 'index.html', root: uiRoot }));
  }

  return app;
}
