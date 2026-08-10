import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { DownstreamConfig } from '../config/schema.js';

export type DownstreamConnection = {
  client: Client;
  transport: StdioClientTransport;
};

export async function connectDownstream(config: DownstreamConfig): Promise<DownstreamConnection> {
  const client = new Client({ name: `warrant-${config.name}`, version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
    cwd: config.cwd,
    stderr: 'pipe',
  });
  await client.connect(transport);
  return { client, transport };
}
