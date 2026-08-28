# Warrant POC Demo — Slide Deck

---

## SLIDE 1 — Title

# Warrant
### A transparent MCP proxy with policy enforcement and human-in-the-loop controls

**Speaker notes:**
Warrant sits between your AI agent and the MCP servers it talks to. It mirrors all downstream tools, evaluates every call against a policy, and can allow, block, or hold any tool call for human approval — all without modifying the agent or the downstream servers. Today I will walk through a live demo of all four behaviors.

---

## SLIDE 2 — The Problem

    Claude Desktop / OpenCode
            |
            v
       +---------+
       |   MCP   | <--- No visibility, no guardrails
       | Servers |
       +---------+

**Speaker notes:**
Right now, when an AI agent calls an MCP tool, it is a black box. You do not know what was called, you cannot block dangerous operations, and you cannot require human approval before something like a publish goes through. Warrant fixes that.

---

## SLIDE 3 — The Architecture

    AI Agent (Claude / OpenCode)
            |
            v
       +----------+         +--------------+
       |  Warrant | ------> |  Admin UI    |  http://127.0.0.1:8787
       |  (proxy) |         +--------------+
       |          |
       |  +-------+-------+
       |  | warrant.yaml  |  <-- policies live here
       |  +-------+-------+
       +----------+----------+
                  |
        +---------+---------+
        |                   |
        v                   v
    +---------+      +-----------+
    | stdio   |      | HTTP      |
    | server  |      | :8907     |
    +---------+      +-----------+

**Speaker notes:**
Warrant is a transparent proxy. It connects to downstream MCP servers — stdio or HTTP — mirrors their tools, and sits in the call path. The admin console runs on the same port. Policies are defined in warrant.yaml.

---

## SLIDE 4 — The Policy

    policies:
      defaultAction: allow
      rules:
        - id: no-writes
          effect: block
          match: write
        - id: confirm-publish
          effect: confirm
          match: publish

**Speaker notes:**
Three lines of policy. Default is allow — most tools pass through transparently. The no-writes rule blocks any tool whose name contains write. The confirm-publish rule holds any tool containing publish for human approval. Deny-overrides: a block always wins over an allow.

---

## SLIDE 5 — Setup Commands

    # Terminal 1: build and start Warrant
    cd repos/warrant
    npm install && npm run build
    rm -f warrant.db              # fresh audit trail
    node dist/server.js           # starts on :8787

    # Terminal 2: start the HTTP fixture
    node fixtures/demo-http-server.mjs &   # listens on :8907

**Speaker notes:**
Two terminals. Terminal 1 builds and starts Warrant — single Node process on port 8787 serving both the MCP proxy and the admin UI. Terminal 2 starts a dummy HTTP downstream on 8907.

---

## SLIDE 6 — Run the Demo

    # Terminal 3: run the demo client
    node scripts/demo-client.mjs

**Speaker notes:**
The demo client connects to Warrant exactly like Claude Desktop or OpenCode would — via stdio transport. It then plays four tool calls, each exercising a different policy path.

---

## SLIDE 7 — Beat 1: Transparent Allow (stdio)

    === 1. ALLOWED (stdio read) ===
    Tool call: demo__read_file
    Verdict: allowed — forwarded to downstream stdio server

    Expected output:
    verdict: allowed -> read notes.txt: (demo) ok

**Speaker notes:**
Beat 1: the agent calls read_file. No rules match the name read, so it is allowed. The call is forwarded to the stdio downstream, which returns a result. The transparent path — 99% of calls look like this.

---

## SLIDE 8 — Beat 2: Policy Block

    === 2. BLOCKED (stdio write) ===
    Tool call: demo__write_file
    Verdict: blocked — matched rule no-writes

    Expected output:
    verdict: blocked -> Blocked by Warrant rule no-writes

**Speaker notes:**
Beat 2: the agent calls write_file. Warrant matches the no-writes rule and blocks it. The downstream never sees the call. The guardrail: ban entire categories of tools by name pattern.

---

## SLIDE 9 — Beat 3: Transparent Allow (HTTP)

    === 3. ALLOWED (streamable HTTP read) ===
    Tool call: demo-http__remote_read
    Verdict: allowed — forwarded to HTTP server on :8907

    Expected output:
    verdict: allowed -> http: upstream result from :8907

**Speaker notes:**
Beat 3: same transparency, but over streamable HTTP. Proves Warrant handles both transport types — stdio and HTTP — transparently.

---

## SLIDE 10 — Beat 4: Human-in-the-Loop Hold

    === 4. CONFIRMED (http publish held, then approved) ===
    Tool call: demo-http__remote_publish
    Verdict: held by rule confirm-publish
    Operator approves via admin API -> call resumes

    Expected output:
    held: rule=confirm-publish tool=demo-http__remote_publish
    operator approve: 200
    verdict: confirmed-after-approval -> http: upstream result from :8907

**Speaker notes:**
Beat 4 — the show. Warrant matches the confirm-publish rule and pauses the call. It sits in Pending confirmations in the admin console. In a real scenario, an operator clicks Approve, and the call resumes. This is the human-in-the-loop gate.

---

## SLIDE 11 — Live: The Admin Console

    http://127.0.0.1:8787

**What you will see:**
- Connected servers (stdio + HTTP downstreams)
- Mirrored tools (4 tools, prefixed by server name)
- Pending confirmations (beat 4 hold)
- Live event stream

**Speaker notes:**
Let me show the admin console. Two connected downstream servers, four mirrored tools, live event feed. When beat 4 is holding, the publish call appears under Pending confirmations with an Approve button.

---

## SLIDE 12 — Audit Trail

    === AUDIT TRAIL (newest first) ===
     request.succeeded    demo-http__remote_publish
     request.held         demo-http__remote_publish    [rule:confirm-publish]
     request.started      demo-http__remote_publish
     request.succeeded    demo-http__remote_read
     request.started      demo-http__remote_read
     request.blocked      demo__write_file             [rule:no-writes]
     request.started      demo__write_file
     request.succeeded    demo__read_file
     request.started      demo__read_file
     server.connected
     server.connected

**Speaker notes:**
Every event is persisted to SQLite — every tool start, every verdict, every rule that matched. This survives restarts and is paginated via the API. This is your compliance log.

---

## SLIDE 13 — Summary

| Beat | Tool                       | Policy           | Result          |
|------|----------------------------|------------------|-----------------|
| 1    | demo__read_file            | default allow    | Passed through  |
| 2    | demo__write_file           | no-writes        | Blocked         |
| 3    | demo-http__remote_read     | default allow    | Passed through  |
| 4    | demo-http__remote_publish  | confirm-publish  | Held -> Approved|

**Speaker notes:**
Four beats, three policy paths. Allow is transparent. Block stops dangerous calls. Confirm holds for human approval. All decisions are logged.

---

## SLIDE 14 — What is Next

- Cedar-based policy evaluation
- Intent capture and signing
- Multi-user admin console
- Real downstream server integration
- Policy editing in the UI

**Speaker notes:**
This is the POC. The observation seam is in place. Next: Cedar authorization, intent capture, and policy editing in the UI.

---

## SLIDE 15 — Quick Reference

    # Full demo from scratch
    cd repos/warrant
    npm install && npm run build
    rm -f warrant.db
    node fixtures/demo-http-server.mjs &
    node dist/server.js                    # Terminal 1
    node scripts/demo-client.mjs           # Terminal 2

    # Admin console
    open http://127.0.0.1:8787

    # Manual beat 4 (no auto-approve):
    # Comment out lines 46-57 in scripts/demo-client.mjs
    # Then approve via the browser console
ENDO
