import { createServer, type Server as HttpServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { McpProxy } from '@/proxy/proxy';
import { MANAGEMENT_TOOL_NAMES } from '@/proxy/management-tools';

describe('streamable HTTP downstream', () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    // Stateless MCP endpoint: a fresh transport/server pair per request,
    // matching the SDK's documented stateless deployment pattern.
    httpServer = createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      let body = '';
      for await (const chunk of req) body += chunk;

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const downstream = new Server(
        { name: 'remote-demo', version: '0.1.0' },
        { capabilities: { tools: {} } },
      );
      downstream.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: 'remote_read',
            description: 'Read from the remote',
            inputSchema: { type: 'object' },
          },
        ],
      }));
      downstream.setRequestHandler(CallToolRequestSchema, async (request) => ({
        content: [{ type: 'text', text: `remote:${JSON.stringify(request.params.arguments)}` }],
      }));
      res.on('close', () => {
        void transport.close();
        void downstream.close();
      });
      await downstream.connect(transport);
      await transport.handleRequest(req, res, JSON.parse(body));
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (address === null || typeof address === 'string') throw new Error('HTTP server did not bind');
    baseUrl = `http://127.0.0.1:${address.port}/mcp`;
  });

  afterAll(async () => {
    httpServer.close();
  });

  it('mirrors tools from and forwards calls to an HTTP MCP server through the full proxy path', async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const proxy = new McpProxy({
      server: { host: '127.0.0.1', adminPort: 8787 },
      storage: { path: ':memory:' },
      policies: { defaultAction: 'allow', rules: [] },
      downstream: [{ name: 'remote', transport: 'http', url: baseUrl }],
    });
    await proxy.start(serverSide);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientSide);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([...MANAGEMENT_TOOL_NAMES, 'remote__remote_read']);

    const result = await client.callTool({ name: 'remote__remote_read', arguments: { q: 1 } });
    expect(JSON.stringify(result.content)).toContain('remote:');

    const kinds = proxy.events.list().events.map((event) => event.kind);
    expect(kinds).toContain('request.succeeded');
    expect(kinds).not.toContain('request.blocked');

    await client.close();
    await proxy.close();
  });
});
