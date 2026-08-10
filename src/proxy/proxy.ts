import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { WarrantConfig } from '@/config/schema.js';
import { EventStore } from '@/events/event-store.js';
import { connectDownstream, type DownstreamConnection } from '@/transport/downstream.js';
import { Registry } from '@/proxy/registry.js';
import type { RegisteredTool } from '@/proxy/types.js';

type DownstreamState = DownstreamConnection & { name: string };
export type DownstreamConnector = (
  config: WarrantConfig['downstream'][number],
) => Promise<DownstreamConnection>;

export class McpProxy {
  readonly registry = new Registry();
  readonly events: EventStore;
  private readonly server: Server;
  private readonly downstream = new Map<string, DownstreamState>();
  private connected = false;

  constructor(
    private readonly config: WarrantConfig,
    events = new EventStore(),
    private readonly connect: DownstreamConnector = connectDownstream,
  ) {
    this.events = events;
    this.server = new Server(
      { name: 'warrant-proxy', version: '0.1.0' },
      { capabilities: { tools: { listChanged: false } } },
    );
    this.registerHandlers();
  }

  async start(clientTransport: Transport = new StdioServerTransport()): Promise<void> {
    for (const downstream of this.config.downstream) {
      await this.connectServer(downstream.name, downstream);
    }

    await this.server.connect(clientTransport);
    this.connected = true;
  }

  async close(): Promise<void> {
    if (this.connected) await this.server.close();
    for (const state of this.downstream.values()) await state.client.close();
    this.downstream.clear();
    this.connected = false;
  }

  private async connectServer(
    name: string,
    config: WarrantConfig['downstream'][number],
  ): Promise<void> {
    this.registry.register(name);
    try {
      const connection = await this.connect(config);
      const state = { ...connection, name };
      this.downstream.set(name, state);
      const tools = await listAllTools(connection.client);
      const registered = tools.map((tool) => this.registeredTool(name, tool));
      this.registry.setTools(name, registered);
      this.registry.setStatus(name, 'connected');
      this.events.append({ kind: 'server.connected', serverName: name });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.registry.setStatus(name, 'error', message);
      this.events.append({ kind: 'server.error', serverName: name, error: { message } });
      throw error;
    }
  }

  private registeredTool(serverName: string, tool: Tool): RegisteredTool {
    const exposedName = `${serverName}__${tool.name}`;
    return { ...tool, exposedName, serverName, downstreamName: tool.name };
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.registry
        .toolsList()
        .map(({ exposedName, ...tool }) => ({ ...tool, name: exposedName })),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const requestId = randomUUID();
      const tool = this.registry.findTool(request.params.name);
      const started = performance.now();
      this.events.append({
        kind: 'request.started',
        requestId,
        method: 'tools/call',
        name: request.params.name,
        serverName: tool?.serverName,
      });

      if (!tool) {
        const message = `Unknown proxied tool: ${request.params.name}`;
        this.events.append({
          kind: 'request.failed',
          requestId,
          method: 'tools/call',
          name: request.params.name,
          durationMs: Math.round(performance.now() - started),
          error: { message },
        });
        throw new Error(message);
      }

      const connection = this.downstream.get(tool.serverName);
      if (!connection) throw new Error(`Downstream server is unavailable: ${tool.serverName}`);

      try {
        const result = await connection.client.callTool({
          name: tool.downstreamName,
          arguments: request.params.arguments,
        });
        this.events.append({
          kind: 'request.succeeded',
          requestId,
          method: 'tools/call',
          name: request.params.name,
          serverName: tool.serverName,
          durationMs: Math.round(performance.now() - started),
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.events.append({
          kind: 'request.failed',
          requestId,
          method: 'tools/call',
          name: request.params.name,
          serverName: tool.serverName,
          durationMs: Math.round(performance.now() - started),
          error: { message },
        });
        throw error;
      }
    });
  }
}

async function listAllTools(client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const result = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...result.tools);
    cursor = result.nextCursor;
  } while (cursor);
  return tools;
}
