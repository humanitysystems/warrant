---
name: warrant
description: Manage the local Warrant MCP gateway on the fly — add/remove/reload downstream MCP servers, inspect status/tools/events, and approve or deny pending holds. Use when a task mentions warrant, MCP servers, downstream servers, admin API, or the gateway on 127.0.0.1:8787.
---

# Warrant gateway skill

Warrant is a local, transparent MCP proxy. A single MCP client connects to
Warrant over stdio, and Warrant mirrors tools from every configured
**downstream** MCP server (children — stdio child processes or streamable HTTP
servers). This skill covers operating that gateway at runtime: seeing what's
connected, adding/removing/reloading servers, and resolving policy holds.

Two equivalent interfaces, use whichever fits:

- **CLI** — `warrant <command>` (deterministic, gateway-first with config-file
  fallback). See `references/cli.md`.
- **Admin API** — HTTP on `127.0.0.1:8787`. See `references/api.md`.

## Golden rule: the escape hatch

After the tool set changes (a server is added, removed, or reloaded), a
**connected MCP client (e.g. OpenCode) may NOT auto-discover the new tools**,
even though Warrant emits `notifications/tools/list_changed`. The tools its
model can actually call come from what the client pulled when it connected.

If the user needs the new tools in the current session, the reliable fallback
is to **refresh the MCP connection / restart the session** so the client
re-pulls the tool list. In OpenCode use the `/mcp` reconnect or restart.

Verify before and after (see `references/api.md`):

- Tool count — `GET /api/status` → `.tools`
- Full list — `GET /api/tools`

If the user only needed the gateway itself to change (a server started/stopped,
a policy applied) and does not need the new tools in-session, no restart is
needed.

## When to use which

| Goal | Do this |
| --- | --- |
| See current state | `warrant status` / `warrant servers` |
| Add a server | `warrant add-server <name> ...` / `POST /api/servers` |
| Remove a server | `warrant remove-server <name>` / `DELETE /api/servers/:name` |
| Reload a server | `warrant reload <name>` / `POST /api/servers/:name/reload` |
| List mirrored tools | `warrant tools` / `GET /api/tools` |
| Audit trail | `warrant events` / `GET /api/events` |
| Resolve a hold | `warrant approve|deny <requestId>` / `POST /api/holds/:requestId/:decision` |
| Forward a tools/ call | normal MCP use |

> `add` is an alias for `add-server`. `rm` is an alias for `remove-server`.

## Shortest useful loop

1. `warrant status` — is the gateway up, how many servers/tools.
2. `warrant add-server new --transport stdio --command <cmd> --args a,b` (or
   `--transport http --url ...`) — bring up a new downstream.
3. `warrant servers` — confirm it shows as `connected`.
4. **Remind the user**: if they need the new tools in this session, refresh the
   MCP connection / restart; verify with `GET /api/status` tool count.

## Downstream server shape

Matches `warrant.yaml`:
- **stdio**: `name`, `transport: stdio`, `command`, `args[]` (optional), `env{}`
  (optional), `cwd` (optional)
- **http**: `name`, `transport: http`, `url`, `headers{}` (optional)

## Config-file fallback (CLI)

The CLI hits the live admin API when the gateway is reachable. If it is down,
it falls back to editing `warrant.yaml` and prints a **"Restart warrant to
apply"** warning — file edits do not take effect until the gateway restarts.

## Persistence caveat

Server mutations persist back to `warrant.yaml`, but by re-serializing the
whole document. This **drops comments and reformats** the file. It's the
documented tradeoff; don't be surprised if a hand-written, commented
`warrant.yaml` comes back looking uniform after a management operation.

## Policy holds

Some tool calls match a `confirm` rule and are held instead of forwarded. Use
`GET /api/holds` to list them, then `warrant approve <requestId>` or
`warrant deny <requestId>` (or the API equivalents). Holds expire after
`confirmTimeoutMs`.
