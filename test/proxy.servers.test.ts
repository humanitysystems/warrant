import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { McpProxy } from '@/proxy/proxy';
import { MANAGEMENT_TOOL_NAMES } from '@/proxy/management-tools';
import type { WarrantConfigInput } from '@/config/schema';

type Harness = {
  proxy: McpProxy;
  connections: Array<{ name: string; client: Client; server: Server }>;
};

function buildProxy(initial: WarrantConfigInput = { downstream: [] }): Harness {
  const connections: Array<{ name: string; client: Client; server: Server }> = [];
  const proxy = new McpProxy(initial, undefined, async (config) => {
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
  return { proxy, connections };
}

async function startProxy(proxy: McpProxy): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await proxy.start(serverSide);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientSide);
  return client;
}

async function closeAll(proxy: McpProxy, client?: Client, connections?: Harness['connections']): Promise<void> {
  if (client) await client.close();
  await proxy.close();
  if (connections) {
    for (const connection of connections) {
      await connection.client.close();
      await connection.server.close();
    }
  }
}

describe('runtime server management', () => {
  it('adds a downstream server, mirrors its tools, and persists it in config', async () => {
    const harness = buildProxy();
    const client = await startProxy(harness.proxy);

    await harness.proxy.addServer({ name: 'demo', transport: 'stdio', command: 'unused', args: [] });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([...MANAGEMENT_TOOL_NAMES, 'demo__echo']);
    expect(harness.proxy.currentConfig().downstream).toEqual([
      { name: 'demo', transport: 'stdio', command: 'unused', args: [] },
    ]);
    expect(harness.proxy.registry.serversList().map((s) => s.name)).toEqual(['demo']);
    expect(harness.proxy.events.list().events.map((e) => e.kind)).toContain('server.connected');

    await closeAll(harness.proxy, client, harness.connections);
  });

  it('rejects a duplicate server name', async () => {
    const harness = buildProxy({
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
    });
    await startProxy(harness.proxy);
    await expect(
      harness.proxy.addServer({ name: 'demo', transport: 'stdio', command: 'unused', args: [] }),
    ).rejects.toThrow('Duplicate downstream server');
    await closeAll(harness.proxy, undefined, harness.connections);
  });

  it('removes a server, unregisters its tools, and updates config', async () => {
    const harness = buildProxy({
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
    });
    const client = await startProxy(harness.proxy);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
      ...MANAGEMENT_TOOL_NAMES,
      'demo__echo',
    ]);

    await harness.proxy.removeServer('demo');

    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(MANAGEMENT_TOOL_NAMES);
    expect(harness.proxy.currentConfig().downstream).toEqual([]);
    expect(harness.proxy.registry.serversList()).toEqual([]);
    expect(harness.proxy.events.list().events.map((e) => e.kind)).toContain('server.disconnected');

    await closeAll(harness.proxy, client, harness.connections);
  });

  it('rejects removing an unknown server', async () => {
    const harness = buildProxy();
    await startProxy(harness.proxy);
    await expect(harness.proxy.removeServer('missing')).rejects.toThrow('Unknown downstream server');
    await closeAll(harness.proxy, undefined, harness.connections);
  });

  it('reloads a server in place, keeping its config and reconnecting', async () => {
    const harness = buildProxy({
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
    });
    const client = await startProxy(harness.proxy);
    const before = harness.connections.length;

    await harness.proxy.reloadServer('demo');

    expect(harness.connections.length).toBe(before + 1);
    expect(harness.proxy.currentConfig().downstream.map((d) => d.name)).toEqual(['demo']);
    expect(harness.proxy.registry.serversList().map((s) => s.name)).toEqual(['demo']);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
      ...MANAGEMENT_TOOL_NAMES,
      'demo__echo',
    ]);

    await closeAll(harness.proxy, client, harness.connections);
  });

  it('rejects reloading an unknown server', async () => {
    const harness = buildProxy();
    await startProxy(harness.proxy);
    await expect(harness.proxy.reloadServer('missing')).rejects.toThrow('Unknown downstream server');
    await closeAll(harness.proxy, undefined, harness.connections);
  });
});
