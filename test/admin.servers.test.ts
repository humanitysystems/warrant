import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { createAdminApp } from '@/admin/app';
import { McpProxy } from '@/proxy/proxy';
import type { WarrantConfigInput } from '@/config/schema';

type Harness = {
  proxy: McpProxy;
  app: ReturnType<typeof createAdminApp>;
  connections: Array<{ name: string; client: Client; server: Server }>;
};

function buildHarness(initial: WarrantConfigInput = { downstream: [] }): Harness {
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
  const saves: string[] = [];
  const app = createAdminApp(proxy, false, {
    save: () => {
      saves.push('saved');
    },
  });
  return { proxy, app, connections };
}

describe('admin server management API', () => {
  it('POST /api/servers adds a server and persists', async () => {
    const { proxy, app, connections } = buildHarness();
    const response = await app.request('/api/servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'demo', transport: 'stdio', command: 'unused', args: [] }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { servers: Array<{ name: string; status: string }> };
    expect(body.servers).toHaveLength(1);
    expect(body.servers[0]).toMatchObject({ name: 'demo', transport: 'stdio', status: 'connected' });
    expect(proxy.currentConfig().downstream).toEqual([
      { name: 'demo', transport: 'stdio', command: 'unused', args: [] },
    ]);
    await proxy.close();
    for (const connection of connections) {
      await connection.client.close();
      await connection.server.close();
    }
  });

  it('POST /api/servers rejects an invalid body with 400', async () => {
    const { app } = buildHarness();
    const response = await app.request('/api/servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/invalid downstream server config/i);
  });

  it('POST /api/servers returns 409 on duplicate name', async () => {
    const { app } = buildHarness({
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
    });
    const response = await app.request('/api/servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'demo', transport: 'stdio', command: 'unused', args: [] }),
    });
    expect(response.status).toBe(409);
  });

  it('DELETE /api/servers/:name removes a server and persists', async () => {
    const { proxy, app, connections } = buildHarness({
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
    });
    const response = await app.request('/api/servers/demo', { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(proxy.currentConfig().downstream).toEqual([]);
    const body = (await response.json()) as { servers: unknown[] };
    expect(body.servers).toEqual([]);
    await proxy.close();
    for (const connection of connections) {
      await connection.client.close();
      await connection.server.close();
    }
  });

  it('DELETE /api/servers/:name returns 404 for unknown server', async () => {
    const { app } = buildHarness();
    const response = await app.request('/api/servers/missing', { method: 'DELETE' });
    expect(response.status).toBe(404);
  });

  it('POST /api/servers/:name/reload reconnects and persists', async () => {
    const { proxy, app, connections } = buildHarness({
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
    });
    const before = connections.length;
    const response = await app.request('/api/servers/demo/reload', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(connections.length).toBe(before + 1);
    expect(proxy.currentConfig().downstream.map((d) => d.name)).toEqual(['demo']);
    await proxy.close();
    for (const connection of connections) {
      await connection.client.close();
      await connection.server.close();
    }
  });

  it('POST /api/servers/:name/reload returns 404 for unknown server', async () => {
    const { app } = buildHarness();
    const response = await app.request('/api/servers/missing/reload', { method: 'POST' });
    expect(response.status).toBe(404);
  });
});
