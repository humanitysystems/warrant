# warrant CLI reference

`warrant <command> [options]` — deterministic gateway management, gateway-first
with config-file fallback. Run it from the repo that owns `warrant.yaml` (or
pass `--config`).

## Global options

- `--config <path>` / `-c` — `warrant.yaml` path (default: `WARRANT_CONFIG` env
  or `./warrant.yaml`)
- `--admin-url <url>` — gateway admin URL (default: `WARRANT_ADMIN_URL` env or
  `http://127.0.0.1:8787`)
- `help` — usage

## Inspect

| command | notes |
| --- | --- |
| `warrant status` | gateway + proxy status; requires live gateway |
| `warrant servers` / `warrant list-servers` | live list; falls back to config-file list when gateway is down |
| `warrant tools` | mirrored tools; requires live gateway |
| `warrant events [--limit N] [--before <cursor>]` | audit trail; requires live gateway |

## Manage (gateway-first, file-fallback)

| command | notes |
| --- | --- |
| `warrant add-server <name> ...` / `warrant add <name> ...` | `add` is an alias |
| `warrant remove-server <name>` / `warrant rm <name>` | |
| `warrant reload <name>` | disconnect + reconnect; requires live gateway |

`add-server` flags:
- `--transport stdio|http` (default `stdio`)
- stdio: `--command <cmd>`, `--args a,b`, `--cwd <dir>`, `--env K=V`
- http: `--url <url>`, `--header "K=V"` (repeatable)

If the gateway is reachable the change applies live. If not, the CLI edits
`warrant.yaml` and warns **"Restart warrant to apply."**

## Holds (requires live gateway)

- `warrant approve <requestId>`
- `warrant deny <requestId>`

## Examples

```bash
warrant status
warrant servers
warrant add-server demo --transport stdio --command node --args ./fixtures/demo-server.mjs
warrant add edge --transport http --url http://127.0.0.1:9999/mcp --header "Authorization=Bearer x"
warrant remove-server demo
warrant reload edge
warrant approve 42
```

## Exit codes

`0` success, `1` error (unknown command, bad flag, validation, or failed
config fallback). For management commands the CLI returns `0` when it either
applied the change live or wrote the config file.

## Escape hatch

After add/remove/reload, the live gateway may have new/removed tools that a
connected MCP client (e.g. OpenCode) has not re-pulled even with
`notifications/tools/list_changed`. Verify with `warrant status` (`.tools`) and
`warrant tools`; if needed, refresh the MCP connection / restart the session.
