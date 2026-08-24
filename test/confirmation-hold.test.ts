import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { createAdminApp } from '@/admin/app';
import { McpProxy } from '@/proxy/proxy';
import type { WarrantConfigInput } from '@/config/schema';

function buildHarness(policies: WarrantConfigInput['policies']) {
  let downstreamCalls = 0;
  const proxy = new McpProxy(
    {
      server: { host: '127.0.0.1', adminPort: 8787 },
      storage: { path: ':memory:' },
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
      policies,
    },
    undefined,
    async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'downstream-client', version: '1.0.0' });
      const server = new Server(
        { name: 'fake-downstream', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          { name: 'send_message', description: 'Send', inputSchema: { type: 'object' } },
          { name: 'read_file', description: 'Read', inputSchema: { type: 'object' } },
        ],
      }));
      server.setRequestHandler(CallToolRequestSchema, async () => {
        downstreamCalls += 1;
        return { content: [{ type: 'text', text: 'downstream-ok' }] };
      });
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      return { client, transport: clientTransport };
    },
  );
  return {
    proxy,
    app: createAdminApp(proxy),
    calls: () => downstreamCalls,
  };
}

async function connectedClient(proxy: McpProxy): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await proxy.start(serverSide);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientSide);
  return client;
}

async function waitUntilHoldCount(
  app: ReturnType<typeof createAdminApp>,
  count: number,
): Promise<{ holds: Array<{ requestId: string; ruleId?: string; name?: string }> }> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const page = (await (await app.request('/api/holds')).json()) as {
      holds: Array<{ requestId: string; ruleId?: string; name?: string }>;
    };
    if (page.holds.length === count) return page;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`expected ${count} hold(s) to appear`);
}

describe('confirmation holds', () => {
  it('holds a confirm-ruled call and forwards it only after admin approval', async () => {
    const { proxy, app, calls } = buildHarness({
      defaultAction: 'allow',
      rules: [{ id: 'confirm-send', effect: 'confirm', match: 'send' }],
    });
    const client = await connectedClient(proxy);

    const callPromise = client.callTool({ name: 'demo__send_message', arguments: {} });

    const holdsPage = await waitUntilHoldCount(app, 1);
    expect(holdsPage.holds[0]?.ruleId).toBe('confirm-send');
    expect(holdsPage.holds[0]?.name).toBe('demo__send_message');
    expect(calls()).toBe(0);

    const approve = await app.request(`/api/holds/${holdsPage.holds[0]!.requestId}/approve`, {
      method: 'POST',
    });
    expect(approve.status).toBe(200);

    const result = await callPromise;
    expect(JSON.stringify(result.content)).toContain('downstream-ok');
    expect(calls()).toBe(1);
    const kinds = proxy.events.list().events.map((event) => event.kind);
    expect(kinds).toContain('request.held');
    expect(kinds).not.toContain('request.blocked');

    await client.close();
    await proxy.close();
  });

  it('blocks with an operator-denial error when the hold is denied', async () => {
    const { proxy, app, calls } = buildHarness({
      defaultAction: 'allow',
      rules: [{ id: 'confirm-send', effect: 'confirm', match: 'send' }],
    });
    const client = await connectedClient(proxy);

    const callPromise = client.callTool({ name: 'demo__send_message', arguments: {} });
    const holdsPage = await waitUntilHoldCount(app, 1);
    await app.request(`/api/holds/${holdsPage.holds[0]!.requestId}/deny`, { method: 'POST' });

    const result = (await callPromise) as { isError?: boolean; content?: unknown[] };
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/denied/i);
    expect(calls()).toBe(0);
    const blocked = proxy.events.list().events.find((event) => event.kind === 'request.blocked');
    expect(blocked?.error?.code).toBe('denied_by_operator');

    await client.close();
    await proxy.close();
  });

  it('auto-blocks when no operator answers before the timeout', async () => {
    const { proxy, calls } = buildHarness({
      defaultAction: 'allow',
      confirmTimeoutMs: 30,
      rules: [{ id: 'confirm-send', effect: 'confirm', match: 'send' }],
    });
    const client = await connectedClient(proxy);

    const result = (await client.callTool({ name: 'demo__send_message', arguments: {} })) as {
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(calls()).toBe(0);
    const blocked = proxy.events.list().events.find((event) => event.kind === 'request.blocked');
    expect(blocked?.error?.code).toBe('confirmation_timeout');

    await client.close();
    await proxy.close();
  });
});
