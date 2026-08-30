import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { McpProxy } from '@/proxy/proxy';
import type { WarrantConfigInput } from '@/config/schema';

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };

function textOf(result: ToolResult): string {
  const block = result.content[0];
  return block && block.text !== undefined ? block.text : '';
}

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
    server.setRequestHandler(CallToolRequestSchema, async () => ({
      content: [{ type: 'text', text: 'fake echo ok' }],
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

const MANAGEMENT_NAMES = [
  'warrant__status',
  'warrant__list_servers',
  'warrant__list_tools',
  'warrant__events',
  'warrant__add_server',
  'warrant__remove_server',
  'warrant__reload_server',
  'warrant__approve',
  'warrant__deny',
];

describe('warrant management tools', () => {
  it('lists built-in management tools alongside mirrored downstream tools', async () => {
    const harness = buildProxy({
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
    });
    const client = await startProxy(harness.proxy);

    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual([...MANAGEMENT_NAMES, 'demo__echo']);

    await closeAll(harness.proxy, client, harness.connections);
  });

  it('warrant__status returns the gateway summary', async () => {
    const harness = buildProxy({
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
    });
    const client = await startProxy(harness.proxy);

    const result = await client.callTool({ name: 'warrant__status', arguments: {} });
    const body = JSON.parse(textOf(result as ToolResult) || '') as {
      ok: boolean;
      servers: { total: number; connected: number };
      tools: number;
    };
    expect(body.ok).toBe(true);
    expect(body.servers).toEqual({ total: 1, connected: 1 });
    expect(body.tools).toBe(1);

    await closeAll(harness.proxy, client, harness.connections);
  });

  it('warrant__list_servers and list_tools return structured output', async () => {
    const harness = buildProxy({
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
    });
    const client = await startProxy(harness.proxy);

    const servers = await client.callTool({ name: 'warrant__list_servers', arguments: {} });
    const serversBody = JSON.parse(textOf(servers as ToolResult) || '') as {
      servers: Array<{ name: string; status: string }>;
    };
    expect(serversBody.servers.map((s) => s.name)).toEqual(['demo']);
    expect(serversBody.servers[0].status).toBe('connected');

    const tools = await client.callTool({ name: 'warrant__list_tools', arguments: {} });
    const toolsBody = JSON.parse(textOf(tools as ToolResult) || '') as {
      tools: Array<{ exposedName: string }>;
    };
    expect(toolsBody.tools.map((t) => t.exposedName)).toContain('demo__echo');

    await closeAll(harness.proxy, client, harness.connections);
  });

  it('warrant__events returns the audit trail', async () => {
    const harness = buildProxy({
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
    });
    const client = await startProxy(harness.proxy);

    const result = await client.callTool({ name: 'warrant__events', arguments: { limit: 5 } });
    const body = JSON.parse(textOf(result as ToolResult) || '') as { events: Array<{ kind: string }> };
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.map((e) => e.kind)).toContain('server.connected');

    await closeAll(harness.proxy, client, harness.connections);
  });

  it('warrant__add_server adds a server and persists via the persist hook', async () => {
    const saves: string[] = [];
    const connections: Harness['connections'] = [];
    const proxy = new McpProxy(
      { downstream: [] },
      undefined,
      async (config) => {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'dc', version: '1.0.0' });
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
      },
      { persist: () => void saves.push('persisted') },
    );
    const client = await startProxy(proxy);

    const result = await client.callTool({
      name: 'warrant__add_server',
      arguments: { name: 'demo', transport: 'stdio', command: 'unused' },
    });
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(textOf(result as ToolResult) || '') as {
      servers: Array<{ name: string }>;
    };
    expect(body.servers.map((s) => s.name)).toEqual(['demo']);
    expect(proxy.currentConfig().downstream.map((d) => d.name)).toEqual(['demo']);
    expect(saves).toEqual(['persisted']);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
      ...MANAGEMENT_NAMES,
      'demo__echo',
    ]);

    await closeAll(proxy, client, connections);
  });

  it('warrant__add_server rejects a duplicate name with isError', async () => {
    const harness = buildProxy({
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
    });
    const client = await startProxy(harness.proxy);

    const result = await client.callTool({
      name: 'warrant__add_server',
      arguments: { name: 'demo', transport: 'stdio', command: 'unused' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result as ToolResult)).toContain('Duplicate downstream server');

    await closeAll(harness.proxy, client, harness.connections);
  });

  it('warrant__add_server rejects the reserved name warrant', async () => {
    const harness = buildProxy();
    const client = await startProxy(harness.proxy);

    const result = await client.callTool({
      name: 'warrant__add_server',
      arguments: { name: 'warrant', transport: 'stdio', command: 'unused' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result as ToolResult)).toContain('reserved');

    await closeAll(harness.proxy, client, harness.connections);
  });

  it('warrant__remove_server removes and persists; unknown returns isError', async () => {
    const saves: string[] = [];
    const connections: Harness['connections'] = [];
    const proxy = new McpProxy(
      { downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }] },
      undefined,
      async (config) => {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'dc', version: '1.0.0' });
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
      },
      { persist: () => void saves.push('persisted') },
    );
    const client = await startProxy(proxy);

    const result = await client.callTool({
      name: 'warrant__remove_server',
      arguments: { name: 'demo' },
    });
    expect(result.isError).toBeUndefined();
    expect(proxy.currentConfig().downstream).toEqual([]);
    expect(saves).toEqual(['persisted']);

    const missing = await client.callTool({
      name: 'warrant__remove_server',
      arguments: { name: 'missing' },
    });
    expect(missing.isError).toBe(true);
    expect(textOf(missing as ToolResult)).toContain('Unknown downstream server');

    await closeAll(proxy, client, connections);
  });

  it('warrant__reload_server reconnects a server', async () => {
    const harness = buildProxy({
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
    });
    const client = await startProxy(harness.proxy);
    const before = harness.connections.length;

    const result = await client.callTool({
      name: 'warrant__reload_server',
      arguments: { name: 'demo' },
    });
    expect(result.isError).toBeUndefined();
    expect(harness.connections.length).toBe(before + 1);
    expect(harness.proxy.currentConfig().downstream.map((d) => d.name)).toEqual(['demo']);

    await closeAll(harness.proxy, client, harness.connections);
  });

  it('warrant__approve resolves a held call and forwards it downstream', async () => {
    const harness = buildProxy({
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
      policies: {
        defaultAction: 'allow',
        rules: [{ id: 'confirm-echo', effect: 'confirm', match: 'demo__echo' }],
      },
    });
    const client = await startProxy(harness.proxy);

    const pending = client.callTool({ name: 'demo__echo', arguments: { x: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const holds = harness.proxy.listHolds();
    expect(holds).toHaveLength(1);
    const requestId = holds[0].requestId;

    const approve = await client.callTool({
      name: 'warrant__approve',
      arguments: { requestId },
    });
    expect(approve.isError).toBeUndefined();
    expect(JSON.parse(textOf(approve as ToolResult))).toEqual({ ok: true });

    const final = await pending;
    expect(final.isError).toBeUndefined();

    await closeAll(harness.proxy, client, harness.connections);
  });

  it('warrant__deny blocks a held call', async () => {
    const harness = buildProxy({
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
      policies: {
        defaultAction: 'allow',
        rules: [{ id: 'confirm-echo', effect: 'confirm', match: 'demo__echo' }],
      },
    });
    const client = await startProxy(harness.proxy);

    const pending = client.callTool({ name: 'demo__echo', arguments: { x: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const requestId = harness.proxy.listHolds()[0].requestId;
    const deny = await client.callTool({
      name: 'warrant__deny',
      arguments: { requestId },
    });
    expect(deny.isError).toBeUndefined();

    const final = await pending;
    expect(final.isError).toBe(true);

    await closeAll(harness.proxy, client, harness.connections);
  });

  it('management tools bypass the policy engine', async () => {
    const harness = buildProxy({
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
      policies: {
        defaultAction: 'allow',
        rules: [{ id: 'block-remove', effect: 'block', match: 'warrant__remove_server' }],
      },
    });
    const client = await startProxy(harness.proxy);

    const result = await client.callTool({
      name: 'warrant__remove_server',
      arguments: { name: 'demo' },
    });
    expect(result.isError).toBeUndefined();
    expect(harness.proxy.currentConfig().downstream).toEqual([]);

    await closeAll(harness.proxy, client, harness.connections);
  });

  it('warrant__approve on an unknown hold returns isError', async () => {
    const harness = buildProxy();
    const client = await startProxy(harness.proxy);

    const result = await client.callTool({
      name: 'warrant__approve',
      arguments: { requestId: 'nope' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result as ToolResult)).toContain('unknown hold');

    await closeAll(harness.proxy, client, harness.connections);
  });
});
