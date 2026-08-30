import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { McpProxy } from '@/proxy/proxy';
import { MANAGEMENT_TOOL_NAMES } from '@/proxy/management-tools';

describe('MCP proxy', () => {
  it('mirrors and forwards a tool call without changing its arguments', async () => {
    const [proxyClientTransport, proxyServerTransport] = InMemoryTransport.createLinkedPair();
    const downstreamConnections: Array<{ client: Client; server: Server }> = [];
    let receivedArguments: Record<string, unknown> | undefined;

    const proxy = new McpProxy(
      {
        server: { host: '127.0.0.1', adminPort: 8787 },
        downstream: [{ name: 'demo', transport: 'stdio', command: 'unused', args: [] }],
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
          tools: [{ name: 'echo', description: 'Echo input', inputSchema: { type: 'object' } }],
        }));
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
          receivedArguments = request.params.arguments;
          return { content: [{ type: 'text', text: JSON.stringify(request.params.arguments) }] };
        });
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        downstreamConnections.push({ client, server });
        return { client, transport: clientTransport };
      },
    );

    await proxy.start(proxyServerTransport);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(proxyClientTransport);

    const tools = await client.listTools();
    const result = await client.callTool({ name: 'demo__echo', arguments: { value: 'hello' } });

    expect(tools.tools.map((tool) => tool.name)).toEqual([...MANAGEMENT_TOOL_NAMES, 'demo__echo']);
    expect(receivedArguments).toEqual({ value: 'hello' });
    expect(result.content).toEqual([{ type: 'text', text: '{"value":"hello"}' }]);
    expect(proxy.events.list().events.map((event) => event.kind)).toEqual([
      'request.succeeded',
      'request.started',
      'server.connected',
    ]);

    await client.close();
    await proxy.close();
    for (const connection of downstreamConnections) {
      await connection.client.close();
      await connection.server.close();
    }
  });
});
