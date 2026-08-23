import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const PORT = Number(process.env.DEMO_HTTP_PORT ?? 8907);

function buildStatelessPair() {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = new Server(
    { name: 'demo-http-downstream', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'remote_read',
        description: 'Read a value from the remote service (safe)',
        inputSchema: {
          type: 'object',
          properties: { key: { type: 'string' } },
          required: ['key'],
        },
      },
      {
        name: 'remote_publish',
        description: 'Publish to the remote service (dangerous)',
        inputSchema: {
          type: 'object',
          properties: { channel: { type: 'string' }, message: { type: 'string' } },
          required: ['channel', 'message'],
        },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [{ type: 'text', text: `http:${JSON.stringify(request.params.arguments)}` }],
  }));
  return { transport, server };
}

const httpServer = createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;

  const { transport, server } = buildStatelessPair();
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, JSON.parse(body || '{}'));
});

httpServer.listen(PORT, '127.0.0.1', () => {
  console.error(`demo http-server listening on http://127.0.0.1:${PORT}/mcp`);
});
