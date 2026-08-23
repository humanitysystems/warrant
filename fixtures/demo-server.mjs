import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'demo-downstream', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'read_file',
      description: 'Read a file from disk (safe demo tool)',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Write a file to disk (dangerous demo tool)',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, contents: { type: 'string' } },
        required: ['path', 'contents'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === 'read_file') {
    return { content: [{ type: 'text', text: `read ${args.path}: (demo) ok` }] };
  }
  if (name === 'write_file') {
    return { content: [{ type: 'text', text: `wrote ${args.path}: (demo) ok` }] };
  }
  return { content: [{ type: 'text', text: `unknown tool: ${String(name)}` }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);
