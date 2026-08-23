import { serve } from '@hono/node-server';
import { createAdminApp } from '@/admin/app';
import { loadConfig } from '@/config/loader';
import { EventStore } from '@/events/event-store';
import { McpProxy } from '@/proxy/proxy';

async function main(): Promise<void> {
  const config = await loadConfig(process.env.WARRANT_CONFIG ?? 'warrant.yaml');
  const events = new EventStore({ path: config.storage?.path ?? 'warrant.db' });
  const proxy = new McpProxy(config, events);
  const production = process.env.NODE_ENV !== 'development';
  const admin = serve({
    fetch: createAdminApp(proxy, production).fetch,
    hostname: config.server.host,
    port: config.server.adminPort,
  });

  try {
    await proxy.start();
  } catch (error) {
    admin.close();
    await proxy.close();
    events.close();
    throw error;
  }
  console.error(`Warrant admin console: http://${config.server.host}:${config.server.adminPort}`);
  console.error('Warrant MCP proxy is ready on stdio');

  const shutdown = async () => {
    admin.close();
    await proxy.close();
    events.close();
  };
  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
}

main().catch((error: unknown) => {
  console.error('Warrant failed to start:', error);
  process.exitCode = 1;
});
