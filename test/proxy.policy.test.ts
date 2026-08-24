import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { McpProxy } from '@/proxy/proxy';
import type { WarrantConfigInput } from '@/config/schema';

function buildProxy(
  policies: WarrantConfigInput['policies'],
  handleCall: () => void,
): { proxy: McpProxy; connections: Array<{ client: Client; server: Server }> } {
  const connections: Array<{ client: Client; server: Server }> = [];
  const proxy = new McpProxy(
    {
      server: { host: '127.0.0.1', adminPort: 8787 },
      downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
      ...(policies !== undefined ? { policies } : {}),
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
          { name: 'echo', description: 'Echo input', inputSchema: { type: 'object' } },
          { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object' } },
        ],
      }));
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        handleCall();
        return { content: [{ type: 'text', text: JSON.stringify(request.params.arguments) }] };
      });
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      connections.push({ client, server });
      return { client, transport: clientTransport };
    },
  );
  return { proxy, connections };
}

describe('policy-gated proxy', () => {
  it('blocks a ruled tool call before it reaches downstream, naming the rule', async () => {
    let downstreamCalls = 0;
    const { proxy } = buildProxy(
      { defaultAction: 'allow', rules: [{ id: 'no-writes', effect: 'block', match: 'write' }] },
      () => {
        downstreamCalls += 1;
      },
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await proxy.start(serverSide);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientSide);

    const result = await client.callTool({ name: 'demo__write_file', arguments: { path: 'x' } });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('no-writes');
    expect(downstreamCalls).toBe(0);

    const blockedEvents = proxy.events
      .list()
      .events.filter((event) => event.kind === 'request.blocked');
    expect(blockedEvents).toHaveLength(1);
    expect(blockedEvents[0]?.ruleId).toBe('no-writes');
    expect(blockedEvents[0]?.name).toBe('demo__write_file');

    await client.close();
    await proxy.close();
  });

  it('forwards allowed calls untouched and records the flow without a blocked verdict', async () => {
    let downstreamCalls = 0;
    const { proxy } = buildProxy(
      { defaultAction: 'allow', rules: [{ id: 'no-writes', effect: 'block', match: 'write' }] },
      () => {
        downstreamCalls += 1;
      },
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await proxy.start(serverSide);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientSide);

    const result = await client.callTool({ name: 'demo__echo', arguments: { value: 'hi' } });

    expect(result.isError).toBeUndefined();
    expect(downstreamCalls).toBe(1);
    const kinds = proxy.events.list().events.map((event) => event.kind);
    expect(kinds).not.toContain('request.blocked');
    expect(kinds).toContain('request.succeeded');

    await client.close();
    await proxy.close();
  });
});
