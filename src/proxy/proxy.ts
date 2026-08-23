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
import type { WarrantConfig, WarrantConfigInput } from '@/config/schema';
import { warrantConfigSchema } from '@/config/schema';
import { EventStore } from '@/events/event-store';
import type { ProxyEventKind } from '@/events/types';
import { PolicyEngine } from '@/policy/policy-engine';
import { connectDownstream, type DownstreamConnection } from '@/transport/downstream';
import { Registry } from '@/proxy/registry';
import type { RegisteredTool } from '@/proxy/types';

type DownstreamState = DownstreamConnection & { name: string };
export type DownstreamConnector = (
  config: WarrantConfig['downstream'][number],
) => Promise<DownstreamConnection>;

export class McpProxy {
  readonly registry = new Registry();
  readonly events: EventStore;
  private readonly config: WarrantConfig;
  private readonly policyEngine: PolicyEngine;
  private readonly server: Server;
  private readonly downstream = new Map<string, DownstreamState>();
  private connected = false;

  constructor(
    configInput: WarrantConfigInput,
    events = new EventStore(),
    private readonly connect: DownstreamConnector = connectDownstream,
  ) {
    const config: WarrantConfig = warrantConfigSchema.parse(configInput);
    this.config = config;
    this.events = events;
    this.policyEngine = new PolicyEngine(config.policies);
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
      const emit = (
        kind: ProxyEventKind,
        fields: {
          ruleId?: string;
          error?: { message: string; code?: string | number };
        } = {},
      ): void => {
        this.events.append({
          kind,
          requestId,
          method: 'tools/call',
          name: request.params.name,
          serverName: tool?.serverName,
          durationMs: Math.round(performance.now() - started),
          ...fields,
        });
      };

      emit('request.started');

      if (!tool) {
        const message = `Unknown proxied tool: ${request.params.name}`;
        emit('request.failed', { error: { message } });
        throw new Error(message);
      }

      const connection = this.downstream.get(tool.serverName);
      if (!connection) throw new Error(`Downstream server is unavailable: ${tool.serverName}`);

      const verdict = this.policyEngine.evaluate({ exposedName: tool.exposedName });
      if (verdict.action === 'block') {
        emit('request.blocked', {
          ruleId: verdict.ruleId,
          error: { message: verdict.reason, code: 'blocked_by_rule' },
        });
        return {
          content: [
            {
              type: 'text',
              text: `Blocked by Warrant rule '${verdict.ruleId}': ${verdict.reason}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await connection.client.callTool({
          name: tool.downstreamName,
          arguments: request.params.arguments,
        });
        emit('request.succeeded');
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit('request.failed', { error: { message } });
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
