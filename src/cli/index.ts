#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { AdminClient } from '@/cli/gateway';
import {
  resolveConfigPath,
  resolveAdminUrl,
  fileAddServer,
  fileRemoveServer,
  fileServerNames,
} from '@/cli/config';

export const USAGE = `warrant — manage your MCP gateway

Usage: warrant <command> [options]

Inspect:
  status                         Gateway + proxy status
  servers | list-servers         Downstream servers (live, else from config)
  tools                          Mirrored tools (requires live gateway)
  events [--limit N] [--before N]  Audit trail (requires live gateway)

Manage (gateway-first, config-file fallback):
  add-server | add <name> --transport stdio|http [--command C] [--args a,b] [--url U] [--header k=v]
  remove-server | rm <name>
  reload <name>

Holds (requires live gateway):
  approve <requestId>
  deny <requestId>

Global:
  --config <path>      warrant.yaml path (env: WARRANT_CONFIG)
  --admin-url <url>    gateway admin URL (env: WARRANT_ADMIN_URL)
  help                 Show this help

Examples:
  warrant status
  warrant add-server demo --transport stdio --command node --args ./fixtures/demo-server.mjs
  warrant add demo-http --transport http --url http://127.0.0.1:8907/mcp
  warrant remove-server demo
  warrant reload demo-http
`;

export type Io = {
  log: (line: string) => void;
  error: (line: string) => void;
};

export const consoleIo: Io = {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
};

export async function run(argv: string[], io: Io = consoleIo): Promise<number> {
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    io.log(USAGE);
    return 0;
  }

  const { common, rest } = stripGlobals(argv);
  const command = rest[0];
  if (!command) {
    io.log(USAGE);
    return 0;
  }

  const configPath = resolveConfigPath(common.config);
  const client = new AdminClient(resolveAdminUrl(common.adminUrl));

  switch (command) {
    case 'status':
      return statusCommand(rest.slice(1), client, io);
    case 'servers':
    case 'list-servers':
      return serversCommand(rest.slice(1), client, configPath, io);
    case 'tools':
      return toolsCommand(client, io);
    case 'events':
      return eventsCommand(rest.slice(1), client, io);
    case 'add-server':
    case 'add':
      return addServerCommand(rest.slice(1), client, configPath, io);
    case 'remove-server':
    case 'rm':
      return removeServerCommand(rest.slice(1), client, configPath, io);
    case 'reload':
      return reloadCommand(rest.slice(1), client, configPath, io);
    case 'approve':
    case 'deny':
      return decideCommand(command, rest.slice(1), client, io);
    default:
      io.error(`unknown command: ${command}`);
      io.error(USAGE);
      return 1;
  }
}

type Common = { config?: string; adminUrl?: string };

function stripGlobals(argv: string[]): { common: Common; rest: string[] } {  const common: Common = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--config' || arg === '-c') {
      common.config = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--config=')) {
      common.config = arg.slice('--config='.length);
    } else if (arg === '--admin-url') {
      common.adminUrl = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--admin-url=')) {
      common.adminUrl = arg.slice('--admin-url='.length);
    } else {
      rest.push(arg);
    }
  }
  return { common, rest };
}

async function statusCommand(rest: string[], client: AdminClient, io: Io): Promise<number> {
  void rest;
  try {
    const body = await client.request('/api/status');
    io.log(JSON.stringify(body, null, 2));
    return 0;
  } catch (error) {
    io.error(`Gateway unreachable: ${message(error)}`);
    return 1;
  }
}

async function serversCommand(
  rest: string[],
  client: AdminClient,
  configPath: string,
  io: Io,
): Promise<number> {
  void rest;
  try {
    const body = (await client.request('/api/servers')) as { servers: unknown[] };
    io.log(JSON.stringify(body.servers, null, 2));
    return 0;
  } catch {
    io.error('Gateway unreachable; listing configured servers from config file.');
    try {
      const names = await fileServerNames(configPath);
      io.log(JSON.stringify(names, null, 2));
      return 0;
    } catch (error) {
      io.error(`Could not read config: ${message(error)}`);
      return 1;
    }
  }
}

async function toolsCommand(client: AdminClient, io: Io): Promise<number> {
  try {
    const body = await client.request('/api/tools');
    io.log(JSON.stringify(body, null, 2));
    return 0;
  } catch (error) {
    io.error(`Gateway unreachable; tools require a live gateway: ${message(error)}`);
    return 1;
  }
}

async function eventsCommand(rest: string[], client: AdminClient, io: Io): Promise<number> {
  const { values } = parseArgs({
    args: rest,
    options: { limit: { type: 'string' }, before: { type: 'string' } },
    strict: false,
    allowPositionals: true,
  });
  const query = new URLSearchParams();
  if (values.limit) query.set('limit', values.limit as string);
  if (values.before) query.set('before', values.before as string);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  try {
    const body = await client.request(`/api/events${suffix}`);
    io.log(JSON.stringify(body, null, 2));
    return 0;
  } catch (error) {
    io.error(`Gateway unreachable: ${message(error)}`);
    return 1;
  }
}

async function addServerCommand(
  positionals: string[],
  client: AdminClient,
  configPath: string,
  io: Io,
): Promise<number> {
  const { values, positionals: pos } = parseArgs({
    args: positionals,
    options: {
      transport: { type: 'string', short: 't' },
      command: { type: 'string' },
      args: { type: 'string' },
      url: { type: 'string' },
      header: { type: 'string', multiple: true },
      env: { type: 'string', multiple: true },
      cwd: { type: 'string' },
    },
    strict: false,
    allowPositionals: true,
  });
  const name = pos[0];
  if (!name) {
    io.error('add-server requires a server name');
    io.error(USAGE);
    return 1;
  }
  const transport = (values.transport ?? 'stdio') as 'stdio' | 'http';
  if (transport !== 'stdio' && transport !== 'http') {
    io.error(`invalid --transport: ${String(values.transport)} (must be stdio or http)`);
    return 1;
  }
  const config: Record<string, unknown> = { name, transport };
  if (transport === 'stdio') {
    if (!values.command) {
      io.error('stdio servers require --command');
      io.error(USAGE);
      return 1;
    }
    config.command = values.command;
    config.args = values.args ? String(values.args).split(',').map((s) => s.trim()) : [];
    if (values.cwd) config.cwd = values.cwd;
    if (values.env) config.env = parseKv(values.env as string[]);
  } else {
    if (!values.url) {
      io.error('http servers require --url');
      io.error(USAGE);
      return 1;
    }
    config.url = values.url;
    if (values.header) config.headers = parseKv(values.header as string[]);
  }
  return withFallback('add', config, client, configPath, name, io);
}

async function removeServerCommand(
  positionals: string[],
  client: AdminClient,
  configPath: string,
  io: Io,
): Promise<number> {
  const name = positionals[0];
  if (!name) {
    io.error('remove-server requires a server name');
    io.error(USAGE);
    return 1;
  }
  return withFallback('remove', name, client, configPath, name, io);
}

async function reloadCommand(
  positionals: string[],
  client: AdminClient,
  configPath: string,
  io: Io,
): Promise<number> {
  const name = positionals[0];
  if (!name) {
    io.error('reload requires a server name');
    io.error(USAGE);
    return 1;
  }
  try {
    await client.request(`/api/servers/${encodeURIComponent(name)}/reload`, { method: 'POST' });
    io.log(`Reloaded '${name}'.`);
    return 0;
  } catch {
    io.error(
      `Gateway unreachable; cannot reload on the fly. Edit ${configPath} and restart warrant to apply changes for '${name}'.`,
    );
    return 1;
  }
}

async function decideCommand(
  command: 'approve' | 'deny',
  positionals: string[],
  client: AdminClient,
  io: Io,
): Promise<number> {
  const requestId = positionals[0];
  if (!requestId) {
    io.error(`${command} requires a requestId`);
    io.error(USAGE);
    return 1;
  }
  try {
    await client.request(`/api/holds/${encodeURIComponent(requestId)}/${command}`, {
      method: 'POST',
    });
    io.log(`${command === 'approve' ? 'Approved' : 'Denied'} request '${requestId}'.`);
    return 0;
  } catch (error) {
    io.error(`Gateway unreachable or hold unknown: ${message(error)}`);
    return 1;
  }
}

async function withFallback(
  op: 'add' | 'remove',
  payload: unknown,
  client: AdminClient,
  configPath: string,
  name: string,
  io: Io,
): Promise<number> {
  try {
    if (op === 'add') {
      await client.request('/api/servers', { method: 'POST', body: JSON.stringify(payload) });
      io.log(`Added '${name}' to the live gateway.`);
    } else {
      await client.request(`/api/servers/${encodeURIComponent(name)}`, { method: 'DELETE' });
      io.log(`Removed '${name}' from the live gateway.`);
    }
    return 0;
  } catch (error) {
    io.error(
      `Gateway unreachable (${message(error)}); falling back to config file ${configPath}.`,
    );
    try {
      if (op === 'add') {
        await fileAddServer(configPath, payload);
        io.log(`Wrote '${name}' to ${configPath}. Restart warrant to apply.`);
      } else {
        await fileRemoveServer(configPath, name);
        io.log(`Removed '${name}' from ${configPath}. Restart warrant to apply.`);
      }
      return 0;
    } catch (fileError) {
      io.error(`Config fallback failed: ${message(fileError)}`);
      return 1;
    }
  }
}

function parseKv(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of values) {
    const idx = value.indexOf('=');
    if (idx === -1) {
      result[value] = '';
    } else {
      result[value.slice(0, idx)] = value.slice(idx + 1);
    }
  }
  return result;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , ...argv] = process.argv;
  void run(argv).then((code) => {
    process.exitCode = code;
  });
}
