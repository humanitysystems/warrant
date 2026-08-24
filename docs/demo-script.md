# Warrant POC demo script

Ten minutes, four beats, one proxy. Everything runs locally on loopback.

## Setup (once per demo)

```bash
npm install && npm run build
node fixtures/demo-http-server.mjs &        # streamable HTTP downstream on :8907
rm -f warrant.db                             # fresh audit trail
```

`warrant.yaml` ships the demo policy: `defaultAction: allow`, `no-writes`
blocks any `*__write*` tool, `confirm-publish` holds any `publish` tool for a
human decision.

## The run

```bash
node scripts/demo-client.mjs
```

The script connects an MCP client to Warrant exactly like Claude Desktop or
OpenCode would, then plays the beats:

| #   | Beat                                | Tool call                   | Expected verdict                                                |
| --- | ----------------------------------- | --------------------------- | --------------------------------------------------------------- |
| 1   | Transparent allow (stdio)           | `demo__read_file`           | result returns, downstream ran                                  |
| 2   | Policy block naming rule            | `demo__write_file`          | `isError` — "Blocked by Warrant rule 'no-writes'"               |
| 3   | Transparent allow (streamable HTTP) | `demo-http__remote_read`    | result returns from remote server                               |
| 4   | Human-in-the-loop hold              | `demo-http__remote_publish` | call **pauses**; operator approves at the console; call resumes |

Beat 4 is the show: the agent's call sits in "Pending confirmations" in the
admin console (`http://127.0.0.1:8787`) until someone clicks Approve.

## Proof afterwards

The script prints the audit trail it reads back from `/api/events`: every
attempt, every verdict, every rule id — persisted to SQLite and reviewable
after restart.
