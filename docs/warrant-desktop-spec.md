**ENGINEERING BUILD SPEC**

**Warrant Desktop v1**

*Companion desktop management app for the Warrant MCP gateway. Prepared for Ethan. Humanity Systems SPC, August 2026, v1.0.*

---

SECTION 0

**What you are building**

Warrant Desktop is a native Electron shell that wraps the Warrant gateway process and gives an operator a single place to manage it. Warrant is a local, transparent MCP proxy: it sits between an AI agent and its downstream MCP servers, mirrors their tools, evaluates every proposed tool call against a policy, and can allow, block, or hold any call for human approval. The proxy core has no UI of its own beyond a loopback browser console. Warrant Desktop is that console's first-class home.

The desktop app does **not** change the proxy core. It spawns and supervises the Warrant server process, then drives it through the existing loopback admin HTTP API and live SSE stream. Start, stop, restart, watch status, manage downstream servers, inspect mirrored tools, approve or deny held calls, and follow the live verdict stream — all in one native window, with tray operation and OS-native notifications.

**Deliberate v1 cut.** Config and policy editing, the attestation ledger UI, and audit export are **deferred to a first follow-up** and explicitly listed as non-goals for this iteration. If a feature tempts you and it is on that list, skip it.

SECTION 1

**Stack decisions (made, not open)**

| Concern | Choice | Why |
| --- | --- | --- |
| Shell | Electron | Mature desktop shell; reuses the existing React/Vite UI with no bridge rewrite; first-class child-process management and tray support. |
| Renderer UI | Reuse the existing React + Vite UI (`src/ui/`) | The current admin console is already a thin React app. No new framework. |
| Process bridge | Electron main thread spawns the Warrant server as a child process | The app owns the gateway lifecycle. The current `node dist/server.js` entrypoint is the child. |
| Control seam | Loopback admin HTTP API + SSE (`/api/*`, `/api/events/stream`) | Already the seam for the browser console; the desktop app consumes it identically. |
| IPC | Electron contextBridge + `contextIsolation` (no Node in the renderer) | Standard, secure Electron posture; the renderer stays a pure web client. |
| Packaging | electron-builder → per-platform installers | Distributable desktop product on macOS / Windows / Linux. |
| Background | OS launch-at-login + system tray | A gateway is a background service; it should be on by default and restorable from the tray. |

SECTION 2

**Architecture**

One app, three layers:

```
renderer (React + Vite, existing UI + new panes)
   │  browser-side fetch to warrant admin API + EventSource SSE
   ▼
preload bridge (contextBridge, contextIsolation; no Node exposure)
   │  lifecycle + tray IPC only
   ▼
main process (Electron)
   ├── spawns/supervises warrant server child (node dist/server.js)
   ├── tray, start/stop/restart, autostart
   └── native notifications on held calls
```

- **Renderer talks to Warrant directly, not through Node.** It fetches `http://127.0.0.1:<adminPort>` the same way the current browser console does. SSE comes from `/api/events/stream` via `EventSource`. This keeps the proxy core untouched and the renderer a stock web client.
- **Main process owns the child.** Start, stop, restart, and recreate of the Warrant server are main-process responsibilities. The renderer never holds a handle to the server process.
- **Config stays file-based.** `warrant.yaml` remains the source of truth (per the v1 proxy spec). The desktop app reads it to inform status and surfaces; it does **not** rewrite it in this iteration.
- **The browser console stays.** It remains served on loopback as a fallback, unchanged. Warrant Desktop is the primary surface, not a replacement that removes the old one.

SECTION 3

**Feature surface (mapped to the current admin API)**

The admin API the app drives is the one already implemented in `src/admin/app.ts`:

- `GET /health`
- `GET /api/status` — process identity, client transport, connected/total downstream servers, tool count
- `GET /api/servers` — mirrored downstream server states
- `GET /api/tools` — mirrored tool list
- `GET /api/holds` + `POST /api/holds/:requestId/:decision` — confirmation queue and approve/deny
- `GET /api/events` (paginated) + `GET /api/events/stream` (SSE)

**1. Gateway status pane.**
Show `GET /api/status`: whether the gateway is running, connected/total servers, and tool count. Provide **start / stop / restart** controls wired to the main process, so the operator can bring the gateway up and down without a terminal. Reflect the gateway's actual state (running vs. stopped) and disable controls accordingly.

**2. Server and tools view.**
List downstream servers from `GET /api/servers` with their connection state. List mirrored tools from `GET /api/tools` grouped by server. This iteration is **read-only**: adding and removing downstream servers in config is deferred.

**3. Approval queue.**
Poll `GET /api/holds` (and refresh on stream events) to render the pending-confirmation queue. Each held call shows its request, and Approve / Deny map to `POST /api/holds/:requestId/approve|deny`. This is the human-in-the-loop gate.

**4. Live event stream.**
Consume `/api/events/stream` via `EventSource` and render the live verdict feed (server connected/error, request started/held/succeeded/blocked/failed) with `GET /api/events?limit=&before=` for paginated history. Filter by event kind.

**5. Native notifications.**
When a `request.held` event arrives, the main process raises an OS notification (with an in-app / tray shortcut to the approval queue). This is the product's core job — the operator is nowhere near a terminal when an agent tries a held action.

**6. Tray + autostart.**
System tray icon with live status (running / stopped), quick Approve affordance, and restore/minimize behavior. Register optional launch-at-login so the gateway is available without manual startup.

SECTION 4

**Security posture**

Inherit the v1 proxy's posture: the admin API binds to loopback only. Warrant Desktop adds nothing that widens the network surface.

- **Loopback-only.** The app talks only to `127.0.0.1:<adminPort>`. No remote access, no multi-user.
- **Startup token.** Before the renderer is trusted, the main process holds the Warrant startup token (concept from the v1 system) and the renderer's calls include it, so a non-admin local process cannot drive the gateway. This is the one bit of auth added in v1; keep it minimal.
- **`contextIsolation` on, Node disabled in the renderer.** The renderer cannot reach the filesystem or spawn processes; all privileged actions flow through typed IPC.
- **Autostart registration is opt-in**, and the tray and autostart respect a user preference in the app.

SECTION 5

**Milestones and acceptance criteria**

Build in this order. Each milestone is shippable and reviewable on its own.

| # | Milestone | Done means | Est. |
| --- | --- | --- | --- |
| MD1 | Electron scaffold + process supervision | Electron app launches, spawns `node dist/server.js`, reports live `GET /api/status`, and Start/Stop/Restart works. Browser console still reachable on loopback. | 1-2 wks |
| MD2 | Servers & tools | `GET /api/servers` and `GET /api/tools` render grouped by server with connection state. Read-only. Status pane reflects disconnected servers. | 3-5 days |
| MD3 | Approval queue + notifications | Held call appears in the queue via the live stream; Approve/Deny works end-to-end against `POST /api/holds`. A `request.held` event raises an OS notification linking to the queue. Full demo: agent hits a confirm rule, operator approves from the desktop app, call resumes. | 1 wk |
| MD4 | Tray + autostart + packaging | Tray shows running/stopped status and restore. Opt-in launch-at-login. `electron-builder` produces installers for the host platform. README covers install to demo. | 3-5 days |

**Demo per milestone.** Each milestone ends with a recorded or live demo against a real MCP client, and a short written note on what changed, carrying review context for Matt at milestone boundaries.

**Tests ride along.** The typed admin API client and the main-process lifecycle (spawn/stop/restart, event → notification mapping) get tests in the same PR as the feature, alongside the existing warrant suite.

SECTION 6

**Explicit non-goals (first follow-up)**

These are **deferred**, not canceled:

- Config / policy editing UI (downstream servers, rules, `defaultAction`, `confirmTimeoutMs`) — v1 is read-only on config; editing ships as the first follow-up.
- Attestation-ledger UI (`warrant verify`, `warrant export`) — the ledger work that underlies it is not built in the proxy yet; surface it after the ledger lands.
- Audit/export download UI.
- Multi-user or remote console access.

*A single window into the gateway you can trust, with the human in the loop. Config and proof come next.*
