import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { DownstreamConfig } from '@/config/schema';

export type DownstreamConnection = {
  client: Client;
  transport: Transport;
};

export async function connectDownstream(config: DownstreamConfig): Promise<DownstreamConnection> {
  const client = new Client({ name: `warrant-${config.name}`, version: '0.1.0' });
  const transport: Transport =
    config.transport === 'http'
      ? new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: config.headers !== undefined ? { headers: config.headers } : undefined,
        })
      : new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: config.env,
          cwd: config.cwd,
          stderr: 'pipe',
        });
  await client.connect(transport);
  return { client, transport };
}
