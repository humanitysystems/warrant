# Warrant

Warrant is a local, transparent MCP proxy with a browser admin console. It
connects an MCP client to configured downstream MCP servers, mirrors their
capabilities, forwards requests unchanged, and exposes live operational events
over a localhost dashboard.

This first vertical intentionally does **not** implement Cedar, authorization
verdicts, SQLite, signing, intent capture, or policy editing. The proxy is an
observation and routing seam for those capabilities to be added later.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Development

```bash
npm install
npm run dev
```

The development server starts the admin API on `http://127.0.0.1:8787` and the
Vite UI on `http://127.0.0.1:5173`. The MCP client-facing transport uses stdio
when Warrant is started with `npm start` or the built executable.

All logs use stderr in stdio mode. stdout is reserved for MCP JSON-RPC traffic.

## Commands

```bash
npm run typecheck
npm test
npm run build
npm start
```

## Configuration

Warrant reads `warrant.yaml` from the current working directory:

```yaml
server:
  host: 127.0.0.1
  adminPort: 8787

storage:
  path: warrant.db

policies:
  defaultAction: allow
  rules:
    - id: no-writes
      effect: block
      match: '__write$'

downstream:
  - name: demo
    transport: stdio
    command: node
    args:
      - ./fixtures/demo-server.mjs
  - name: demo-http
    transport: http
    url: http://127.0.0.1:8907/mcp
```

Downstream servers speak stdio (child process) or streamable HTTP (remote
URL, optional `headers`). Run the HTTP demo server with
`node fixtures/demo-http-server.mjs`.

### Policies

Every proposed tool call is evaluated before it is forwarded downstream.
Rules match on the exposed tool name (`<server>__<tool>`), by exact `tools`
list or by `match` regex, and evaluation is **deny-overrides**: any matching
`block` rule wins over any `allow`; otherwise an explicit allow passes; the
`defaultAction` posture decides when nothing matches. Blocked calls return an
`isError` result naming the rule, and every decision lands in the audit trail.

The audit trail persists to the SQLite database at `storage.path` (created on
first run) and survives restarts; `GET /api/events?limit=&before=` paginates
newest-first via `nextCursor`.

The initial implementation supports downstream stdio servers and a
client-facing stdio transport. Streamable HTTP support is deliberately a
follow-up milestone.

## OpenCode integration

Build Warrant first, then add this entry to the repository's `opencode.jsonc`
or to the applicable OpenCode configuration:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "warrant": {
      "type": "local",
      "command": ["node", "dist/server.js"],
      "cwd": "apps/warrant",
      "enabled": true,
    },
  },
}
```

OpenCode resolves `cwd` relative to the workspace. The command therefore finds
`apps/warrant/warrant.yaml` and starts the built proxy at
`apps/warrant/dist/server.js`. OpenCode prefixes tools with the MCP server name;
the proxy additionally prefixes downstream tools with their configured server
name to avoid collisions.

After OpenCode connects, use the admin console to verify downstream servers,
mirrored tools, request events, failures, and latency.

## Admin API

The local admin server exposes:

- `GET /health`
- `GET /api/status`
- `GET /api/servers`
- `GET /api/tools`
- `GET /api/holds`
- `POST /api/holds/:requestId/:decision` (decision: `approve` | `deny`)
- `GET /api/events`
- `GET /api/events/stream` (SSE)

Runtime server management (persists back to `warrant.yaml`):

- `POST /api/servers` — add a downstream server (stdio or http). Body matches
  the `downstream` shape: `{ name, transport: 'stdio', command, args?, env?, cwd? }`
  or `{ name, transport: 'http', url, headers? }`. `400` invalid, `409` duplicate.
- `POST /api/servers/:name/reload` — disconnect + reconnect (re-mirror tools).
- `DELETE /api/servers/:name` — remove a downstream server.

The server binds to loopback only. It is not intended for remote access or
multi-user use.

### Persistence caveat

Management mutations persist back to `warrant.yaml`, but by re-serializing the
whole document. This **drops comments and reformats** the file — a hand-written
commented config will not survive a management operation byte-for-byte.

### Escape hatch

After a server is added, removed, or reloaded, Warrant emits
`notifications/tools/list_changed`, but a connected MCP client (e.g. OpenCode)
may not re-pull the new tool list automatically. If you need the new tools in
the current session, refresh the MCP connection / restart the session, then
verify with `GET /api/status` (`.tools`) and `GET /api/tools`.

## CLI

The `warrant` binary is a deterministic management interface that targets the
live admin API when reachable, and otherwise falls back to the config file
(with a "Restart warrant to apply" warning).

```bash
warrant status                 # gateway + proxy status
warrant servers                # downstream servers (live, else from config)
warrant tools                  # mirrored tools (live)
warrant events [--limit N]     # audit trail (live)
warrant add-server <name> --transport stdio|http [--command C] [--args a,b] [--url U] [--header k=v]
warrant remove-server <name>   # alias: rm
warrant reload <name>
warrant approve <requestId>    # resolve a held call
warrant deny <requestId>
```

`add` is an alias for `add-server`. Global flags: `--config <path>` (default
`WARRANT_CONFIG` or `./warrant.yaml`) and `--admin-url <url>` (default
`WARRANT_ADMIN_URL` or `http://127.0.0.1:8787`). See
`skills/warrant/references/cli.md` and `references/api.md` for full detail.
