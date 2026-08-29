import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, type ServerType } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { run, type Io } from '@/cli/index';
import { fileServerNames } from '@/cli/config';
import { createAdminApp } from '@/admin/app';
import { McpProxy } from '@/proxy/proxy';

type Connections = Array<{ name: string; client: Client; server: Server }>;

function buildGateway() {
  const connections: Connections = [];
  const proxy = new McpProxy({ downstream: [] }, undefined, async (config) => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'downstream-client', version: '1.0.0' });
    const server = new Server(
      { name: `fake-${config.name}`, version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }],
    }));
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    connections.push({ name: config.name, client, server });
    return { client, transport: clientTransport };
  });
  const app = createAdminApp(proxy, false, { save: () => undefined });
  return { proxy, app, connections };
}

async function closeGateway(proxy: McpProxy, connections: Connections): Promise<void> {
  await proxy.close();
  for (const connection of connections) {
    await connection.client.close();
    await connection.server.close();
  }
}

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { log: (l) => out.push(l), error: (l) => err.push(l) },
  };
}

async function withTempConfig<T>(
  fn: (dir: string, configPath: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'warrant-cli-'));
  const configPath = join(dir, 'warrant.yaml');
  await writeFile(
    configPath,
    [
      'server:',
      '  host: 127.0.0.1',
      '  adminPort: 8787',
      'downstream:',
      '  - name: demo',
      '    transport: stdio',
      '    command: node',
      '    args:',
      '      - ./fixtures/demo-server.mjs',
      '',
    ].join('\n'),
    'utf8',
  );
  try {
    return await fn(dir, configPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const unreachableUrl = 'http://127.0.0.1:1';

describe('cli help & errors', () => {
  it('prints usage for help and returns 0', async () => {
    const c = capture();
    const code = await run(['help'], c.io);
    expect(code).toBe(0);
    expect(c.out.join('\n')).toContain('Usage: warrant <command>');
  });

  it('returns 1 for an unknown command', async () => {
    const c = capture();
    const code = await run(['bogus'], c.io);
    expect(code).toBe(1);
    expect(c.err.join('\n')).toContain('unknown command');
  });

  it('returns 1 for add-server without a name', async () => {
    const c = capture();
    const code = await run(['add-server'], c.io);
    expect(code).toBe(1);
  });
});

describe('cli file-fallback (gateway unreachable)', () => {
  it('adds a stdio server to the config file', async () => {
    await withTempConfig(async (_dir, configPath) => {
      const c = capture();
      const code = await run(
        [
          'add-server',
          'newbie',
          '--admin-url',
          unreachableUrl,
          '--transport',
          'stdio',
          '--command',
          'node',
          '--args',
          'a,b',
          '--config',
          configPath,
        ],
        c.io,
      );
      expect(code).toBe(0);
      expect(c.out.join('\n')).toContain("Wrote 'newbie'");
      expect(await fileServerNames(configPath)).toContain('newbie');
    });
  });

  it('adds an http server with headers', async () => {
    await withTempConfig(async (_dir, configPath) => {
      const c = capture();
      const code = await run(
        [
          'add',
          'edge',
          '--admin-url',
          unreachableUrl,
          '--transport',
          'http',
          '--url',
          'http://127.0.0.1:9999/mcp',
          '--header',
          'Authorization=Bearer x',
          '--config',
          configPath,
        ],
        c.io,
      );
      expect(code).toBe(0);
      expect(await fileServerNames(configPath)).toContain('edge');
    });
  });

  it('removes a server from the config file', async () => {
    await withTempConfig(async (_dir, configPath) => {
      const c = capture();
      const code = await run(
        ['remove-server', 'demo', '--admin-url', unreachableUrl, '--config', configPath],
        c.io,
      );
      expect(code).toBe(0);
      expect(c.out.join('\n')).toContain("Removed 'demo'");
      expect(await fileServerNames(configPath)).not.toContain('demo');
    });
  });

  it('lists servers from config when gateway is down', async () => {
    await withTempConfig(async (_dir, configPath) => {
      const c = capture();
      const code = await run(
        ['servers', '--admin-url', unreachableUrl, '--config', configPath],
        c.io,
      );
      expect(code).toBe(0);
      const parsed = JSON.parse(c.out.join('\n')) as string[];
      expect(parsed).toContain('demo');
    });
  });

  it('fails fast on missing --command for stdio', async () => {
    await withTempConfig(async (_dir, configPath) => {
      const c = capture();
      const code = await run(
        ['add-server', 'x', '--admin-url', unreachableUrl, '--config', configPath],
        c.io,
      );
      expect(code).toBe(1);
      expect(c.err.join('\n')).toContain('--command');
    });
  });
});

describe('cli gateway-first (live admin app)', () => {
  it('status, add/remove servers against a live gateway', async () => {
    const { proxy, app, connections } = buildGateway();

    const server = await new Promise<ServerType>((resolve) => {
      const srv = serve({ fetch: app.fetch, port: 0 }, () => resolve(srv));
    });
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}`;

    try {
      const status = capture();
      expect(await run(['status', '--admin-url', url], status.io)).toBe(0);
      const parsed = JSON.parse(status.out.join('\n')) as { servers: { total: number } };
      expect(parsed.servers.total).toBe(0);

      const added = capture();
      expect(
        await run(
          [
            'add-server',
            'newbie',
            '--admin-url',
            url,
            '--transport',
            'stdio',
            '--command',
            'unused',
          ],
          added.io,
        ),
      ).toBe(0);
      expect(added.out.join('\n')).toContain("Added 'newbie'");
      expect(proxy.currentConfig().downstream.map((d) => d.name)).toContain('newbie');

      const after = capture();
      expect(await run(['servers', '--admin-url', url], after.io)).toBe(0);
      const listed = JSON.parse(after.out.join('\n')) as Array<{ name: string }>;
      expect(listed.map((s) => s.name)).toContain('newbie');

      const removed = capture();
      expect(
        await run(['remove-server', 'newbie', '--admin-url', url], removed.io),
      ).toBe(0);
      expect(removed.out.join('\n')).toContain("Removed 'newbie'");
      expect(proxy.currentConfig().downstream).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeGateway(proxy, connections);
    }
  });
});
