import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { downstreamSchema, type DownstreamConfig } from '@/config/schema';
import type { EventPage, ListEventsQuery } from '@/events/event-store';
import type { HoldSnapshot } from '@/proxy/proxy';
import type { RegisteredTool, ServerSnapshot } from '@/proxy/types';

export const MANAGEMENT_NAMESPACE = 'warrant';

export const RESERVED_DOWNSTREAM_NAME = MANAGEMENT_NAMESPACE;

export function managementToolName(tool: string): string {
  return `${MANAGEMENT_NAMESPACE}__${tool}`;
}

export function isManagementTool(exposedName: string): boolean {
  return exposedName.startsWith(`${MANAGEMENT_NAMESPACE}__`);
}

export const MANAGEMENT_TOOL_NAMES: string[] = [
  'status',
  'list_servers',
  'list_tools',
  'events',
  'add_server',
  'remove_server',
  'reload_server',
  'approve',
  'deny',
].map(managementToolName);

/**
 * Environment of operations the built-in tools can perform. Implemented by the
 * proxy (and, where useful, the admin app). Deliberately decoupled from
 * McpProxy to avoid a circular module dependency.
 */
export interface ManagementToolsEnv {
  currentConfig(): { downstream: { name: string; transport: 'stdio' | 'http' }[] };
  serversList(): ServerSnapshot[];
  toolsList(): RegisteredTool[];
  eventsList(query: ListEventsQuery): EventPage;
  listHolds(): HoldSnapshot[];
  addServer(config: DownstreamConfig): Promise<void>;
  removeServer(name: string): Promise<void>;
  reloadServer(name: string): Promise<void>;
  resolveHold(requestId: string, approved: boolean): boolean;
  persist(): Promise<void> | void;
}

function text(content: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(content, null, 2) }],
  };
}

function error(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export const MANAGEMENT_TOOLS: Tool[] = [
  {
    name: managementToolName('status'),
    description:
      "Warrant gateway status: connected/total downstream servers and the mirrored tool count. Read-only, local.",
    inputSchema: { type: 'object' },
  },
  {
    name: managementToolName('list_servers'),
    description:
      "List configured downstream MCP servers with their live connection status, transport, and mirrored tool count. Read-only, local.",
    inputSchema: { type: 'object' },
  },
  {
    name: managementToolName('list_tools'),
    description:
      "List the tools mirrored from downstream servers (named <server>__<tool>). Read-only, local.",
    inputSchema: { type: 'object' },
  },
  {
    name: managementToolName('events'),
    description:
      "Read the warrant audit trail, newest-first. Optional limit (max 500) and before (a nextCursor from a prior page). Read-only, local.",
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, maximum: 500 },
        before: { type: 'number' },
      },
    },
  },
  {
    name: managementToolName('add_server'),
    description:
      "Add a downstream MCP server live (stdio child process or streamable HTTP) and persist it to warrant.yaml. The server name 'warrant' is reserved. Duplicate names are rejected.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        transport: { type: 'string', enum: ['stdio', 'http'] },
        command: { type: 'string', description: 'stdio: executable to spawn' },
        args: { type: 'array', items: { type: 'string' }, description: 'stdio: args' },
        env: { type: 'object', additionalProperties: { type: 'string' }, description: 'stdio: env' },
        cwd: { type: 'string', description: 'stdio: working directory' },
        url: { type: 'string', description: 'http: streamable HTTP endpoint' },
        headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'http: headers' },
      },
      required: ['name', 'transport'],
    },
  },
  {
    name: managementToolName('remove_server'),
    description:
      "Remove a downstream MCP server live and persist it to warrant.yaml. Fails if the server is unknown.",
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: managementToolName('reload_server'),
    description:
      "Disconnect and reconnect a downstream MCP server to re-mirror its tools. Persists. Fails if the server is unknown.",
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: managementToolName('approve'),
    description:
      "Approve a held tool call by its requestId, forwarding it downstream. Resolves the confirmation gate. Use with care.",
    inputSchema: {
      type: 'object',
      properties: { requestId: { type: 'string' } },
      required: ['requestId'],
    },
  },
  {
    name: managementToolName('deny'),
    description:
      "Deny a held tool call by its requestId, blocking it. Resolves the confirmation gate.",
    inputSchema: {
      type: 'object',
      properties: { requestId: { type: 'string' } },
      required: ['requestId'],
    },
  },
];

export function resolveInputArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) return args as Record<string, unknown>;
  return {};
}

export async function executeManagementTool(
  name: string,
  rawArgs: unknown,
  env: ManagementToolsEnv,
): Promise<CallToolResult> {
  const args = resolveInputArgs(rawArgs);

  switch (name) {
    case managementToolName('status'): {
      const config = env.currentConfig();
      const servers = env.serversList();
      return text({
        ok: true,
        process: 'warrant',
        clientTransport: 'stdio',
        servers: {
          total: servers.length,
          connected: servers.filter((s) => s.status === 'connected').length,
        },
        tools: env.toolsList().length,
        configured: config.downstream.length,
      });
    }
    case managementToolName('list_servers'):
      return text({ servers: env.serversList() });
    case managementToolName('list_tools'):
      return text({ tools: env.toolsList() });
    case managementToolName('events'): {
      const query: ListEventsQuery = {};
      if (typeof args.limit === 'number') query.limit = args.limit;
      if (typeof args.before === 'number') query.before = args.before;
      return text(env.eventsList(query));
    }
    case managementToolName('add_server'): {
      const parsed = downstreamSchema.safeParse(args);
      if (!parsed.success) {
        return error(`invalid downstream server config: ${JSON.stringify(parsed.error.issues)}`);
      }
      try {
        await env.addServer(parsed.data);
      } catch (err) {
        return error(err instanceof Error ? err.message : String(err));
      }
      await env.persist();
      return text({ servers: env.serversList() });
    }
    case managementToolName('remove_server'): {
      const name = typeof args.name === 'string' ? args.name : '';
      if (!name) return error('remove_server requires a name');
      try {
        await env.removeServer(name);
      } catch (err) {
        return error(err instanceof Error ? err.message : String(err));
      }
      await env.persist();
      return text({ servers: env.serversList() });
    }
    case managementToolName('reload_server'): {
      const name = typeof args.name === 'string' ? args.name : '';
      if (!name) return error('reload_server requires a name');
      try {
        await env.reloadServer(name);
      } catch (err) {
        return error(err instanceof Error ? err.message : String(err));
      }
      await env.persist();
      return text({ servers: env.serversList() });
    }
    case managementToolName('approve'):
    case managementToolName('deny'): {
      const requestId = typeof args.requestId === 'string' ? args.requestId : '';
      if (!requestId) return error(`${name} requires a requestId`);
      const approved = name === managementToolName('approve');
      const resolved = env.resolveHold(requestId, approved);
      if (!resolved) return error(`unknown hold: ${requestId}`);
      return text({ ok: true });
    }
    default:
      return error(`unknown warranty management tool: ${name}`);
  }
}
