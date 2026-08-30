# Warrant admin API reference

Base URL: `http://127.0.0.1:8787` (loopback only). JSON in, JSON out.

## Health & status

**`GET /health`** → `{ "ok": true }`

**`GET /api/status`** → summary
```json
{
  "ok": true,
  "process": "warrant",
  "clientTransport": "stdio",
  "servers": { "total": 2, "connected": 2 },
  "tools": 4
}
```
`.tools` is the mirrored tool count — use it to verify tools are present
(compare before/after a change).

## Servers (management)

**`GET /api/servers`** → `{ "servers": [...] }` where each entry is a configured
downstream with its live connection `status`.

**`POST /api/servers`** — add a server. Body is a downstream server config
(matches `warrant.yaml`):
```json
{ "name": "newbie", "transport": "stdio", "command": "node", "args": ["x.mjs"] }
```
or HTTP:
```json
{ "name": "edge", "transport": "http", "url": "http://127.0.0.1:9999/mcp", "headers": { "Authorization": "Bearer x" } }
```
Returns `200 { "servers": [...] }`. `400` invalid config, `409` duplicate name.

**`POST /api/servers/:name/reload`** — disconnect + reconnect (re-mirrors
tools). Returns `200 { "servers": [...] }`, `404` unknown.

**`DELETE /api/servers/:name`** — remove. Returns `200 { "servers": [...] }`,
`404` unknown.

## Tools & holds

**`GET /api/tools`** → `{ "tools": [...] }` — full mirrored tool list. Tool
names are prefixed `<server>__<tool>`.

**`GET /api/holds`** → `{ "holds": [...] }` — pending confirm-held calls.

**`POST /api/holds/:requestId/:decision`** — `decision` is `approve` or `deny`.
Returns `{ "ok": true }`, `404` unknown hold.

## Built-in management MCP tools (`warrant__*`)

Every MCP client connected to the gateway sees a fixed set of built-in
management tools alongside the mirrored downstream tools. They are namespaced
`warrant__*` and **bypass the policy engine**. The name `warrant` is reserved
and cannot be used for a downstream server.

| tool | purpose |
| --- | --- |
| `warrant__status` | gateway + proxy summary (mirrors `GET /api/status`) |
| `warrant__list_servers` | configured downstreams + live status |
| `warrant__list_tools` | full exposed tool list |
| `warrant__events` | audit trail |
| `warrant__add_server` | add + persist a downstream server |
| `warrant__remove_server` | remove + persist a downstream server |
| `warrant__reload_server` | disconnect + reconnect a server |
| `warrant__approve` | approve a held call (confirms a pending request) |
| `warrant__deny` | deny a held call |

They mirror the CLI surface (`skills/warrant/references/cli.md`) and the admin
HTTP endpoints above. Results are structured JSON; failures return `isError`.

## Audit trail

**`GET /api/events`** — newest-first, paginated. Query: `?limit=N` and
`?before=<nextCursor>` (cursor from a prior response). Returns
`{ "items": [...], "nextCursor": ... }`.

**`GET /api/events/stream`** — SSE live feed. First event is
`event: connected`; keepalives every 15s; every audit event is pushed with a
numeric `id`.

## Downstream config shape

| transport | fields |
| --- | --- |
| `stdio` | `name`, `transport`, `command`, `args[]?`, `env{}?`, `cwd?` |
| `http` | `name`, `transport`, `url`, `headers{}?` |

Mutations persist back to `warrant.yaml` (re-serialized; comments lost).

## Escape hatch

Emitting `notifications/tools/list_changed` does not guarantee a connected
client re-pulls tools. Verify with `GET /api/status` (`.tools`) and
`GET /api/tools`; if the client is missing new tools, refresh the MCP
connection / restart the session.
