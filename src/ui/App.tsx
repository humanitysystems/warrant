import { useEffect, useState } from 'react';

type Server = {
  name: string;
  status: string;
  transport: string;
  tools: Array<{ exposedName: string; downstreamName: string; description?: string }>;
  lastError?: string;
};
type Tool = Server['tools'][number] & { serverName: string };
type Event = {
  id: string;
  timestamp: string;
  kind: string;
  requestId?: string;
  method?: string;
  serverName?: string;
  name?: string;
  durationMs?: number;
  ruleId?: string;
  error?: { message: string };
};
type Hold = { requestId: string; name: string; serverName: string; ruleId: string; heldAt: string };
type Status = {
  servers: { total: number; connected: number };
  tools: number;
  clientTransport: string;
};
type GatewayStatus = {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  url: string;
  pid?: number;
  error?: string;
};

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [filter, setFilter] = useState('');
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [mutationHint, setMutationHint] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [configPath, setConfigPath] = useState<string | null>(null);

  const refreshHolds = async () => {
    const response = await fetch('/api/holds');
    setHolds(((await response.json()) as { holds: Hold[] }).holds);
  };
  const refreshManagement = async () => {
    const [statusResponse, serversResponse, toolsResponse] = await Promise.all([
      fetch('/api/status'),
      fetch('/api/servers'),
      fetch('/api/tools'),
    ]);
    setStatus((await statusResponse.json()) as Status);
    setServers(((await serversResponse.json()) as { servers: Server[] }).servers);
    setTools(((await toolsResponse.json()) as { tools: Tool[] }).tools);
  };
  const decideHold = async (requestId: string, decision: 'approve' | 'deny') => {
    await fetch(`/api/holds/${requestId}/${decision}`, { method: 'POST' });
    void refreshHolds();
  };
  const controlGateway = async (action: 'start' | 'stop' | 'restart') => {
    if (!window.warrantDesktop) return;
    setGatewayError(null);
    try {
      setGatewayStatus(await window.warrantDesktop.gateway[action]());
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : String(error));
    }
  };
  const reloadServer = async (name: string) => {
    await fetch(`/api/servers/${encodeURIComponent(name)}/reload`, { method: 'POST' });
    setMutationHint(`Reloaded '${name}'.`);
    setMutationError(null);
    void refreshManagement();
  };
  const removeServer = async (name: string) => {
    if (!window.confirm(`Remove MCP server '${name}'? This is destructive.`)) return;
    await fetch(`/api/servers/${encodeURIComponent(name)}`, { method: 'DELETE' });
    setMutationHint(`Removed '${name}'.`);
    setMutationError(null);
    void refreshManagement();
  };
  const addServer = async (config: Record<string, unknown>) => {
    const response = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    });
    const body = (await response.json()) as { servers?: Server[]; error?: string };
    if (!response.ok) {
      setMutationError(body.error ?? 'Failed to add server.');
      return;
    }
    setMutationError(null);
    setMutationHint(`Added '${config.name}'.`);
    setServers(body.servers ?? []);
    setFormOpen(false);
    void refreshHolds();
  };

  useEffect(() => {
    const desktop = window.warrantDesktop;
    const unsubStatus = desktop?.gateway.onStatus(setGatewayStatus);
    const unsubConfig = desktop?.config.onChanged((info) => setConfigPath(info.path));
    const unsubSaved = desktop?.config.onSaved((info) => {
      setMutationHint(`Saved ${info.path.split(/[/\\]/).pop()}.`);
    });
    if (desktop) {
      void desktop.gateway.getStatus().then(setGatewayStatus);
      void desktop.config.getPath().then(setConfigPath);
    }
    void (async () => {
      const [statusResponse, serversResponse, toolsResponse, eventsResponse, holdsResponse] =
        await Promise.all([
          fetch('/api/status'),
          fetch('/api/servers'),
          fetch('/api/tools'),
          fetch('/api/events'),
          fetch('/api/holds'),
        ]);
      setStatus((await statusResponse.json()) as Status);
      setServers(((await serversResponse.json()) as { servers: Server[] }).servers);
      setTools(((await toolsResponse.json()) as { tools: Tool[] }).tools);
      setEvents(((await eventsResponse.json()) as { events: Event[] }).events);
      setHolds(((await holdsResponse.json()) as { holds: Hold[] }).holds);
    })();
    const pollHolds = setInterval(() => void refreshHolds(), 1500);
    const source = new EventSource('/api/events/stream');
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as Event;
      if (event.kind === 'request.held') void refreshHolds();
      setEvents((current) => [event, ...current].slice(0, 500));
    };
    source.onerror = () => source.close();
    return () => {
      clearInterval(pollHolds);
      source.close();
      unsubStatus?.();
      unsubConfig?.();
      unsubSaved?.();
    };
  }, []);
  const visibleEvents = events.filter((event) =>
    `${event.kind} ${event.name ?? ''} ${event.serverName ?? ''}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">LOCAL MCP CONTROL PLANE</p>
          <h1>Warrant</h1>
        </div>
        <div className="topbar-actions">
          {configPath && (
            <span className="config-file" title={configPath}>
              {configPath.split(/[/\\]/).pop()}
            </span>
          )}
          <div className="connection">
            <span className={`dot ${gatewayStatus?.state === 'error' ? 'error' : ''}`} />
            {gatewayStatus
              ? `Gateway ${gatewayStatus.state}`
              : status
                ? 'Proxy online'
                : 'Connecting...'}
          </div>
          {window.warrantDesktop && (
            <div className="gateway-controls">
              <button
                onClick={() => void controlGateway('start')}
                disabled={gatewayStatus?.state === 'running' || gatewayStatus?.state === 'starting'}
              >
                Start
              </button>
              <button
                onClick={() => void controlGateway('restart')}
                disabled={
                  gatewayStatus?.state === 'starting' || gatewayStatus?.state === 'stopping'
                }
              >
                Restart
              </button>
              <button
                onClick={() => void controlGateway('stop')}
                disabled={gatewayStatus?.state === 'stopped' || gatewayStatus?.state === 'stopping'}
              >
                Stop
              </button>
            </div>
          )}
        </div>
      </header>
      {gatewayError && <p className="error gateway-error">{gatewayError}</p>}
      <section className="status-grid">
        <Metric
          label="MCP servers"
          value={`${status?.servers.connected ?? 0}/${status?.servers.total ?? 0}`}
        />
        <Metric label="Mirrored tools" value={String(status?.tools ?? 0)} />
        <Metric label="Client transport" value={status?.clientTransport ?? '...'} />
      </section>
      <section className="columns">
        <Panel title="Pending confirmations">
          <div className="hold-list">
            {holds.map((hold) => (
              <article className="server" key={hold.requestId}>
                <div>
                  <strong>
                    {hold.serverName}__{hold.name}
                  </strong>
                  <span className="badge connecting">held</span>
                </div>
                <small>rule: {hold.ruleId}</small>
                <div className="server-actions">
                  <button onClick={() => void decideHold(hold.requestId, 'approve')}>
                    Approve
                  </button>
                  <button onClick={() => void decideHold(hold.requestId, 'deny')}>Deny</button>
                </div>
              </article>
            ))}
            {!holds.length && <p className="muted">No calls waiting for confirmation.</p>}
          </div>
        </Panel>
        <Panel title="MCP servers">
          <div className="server-list">
            {servers.map((server) => (
              <article className="server" key={server.name}>
                <div>
                  <strong>{server.name}</strong>
                  <span className={`badge ${server.status}`}>{server.status}</span>
                </div>
                <small>
                  {server.transport} · {server.tools.length} tools
                </small>
                <div className="server-actions">
                  <button onClick={() => void reloadServer(server.name)}>Reload</button>
                  <button className="danger" onClick={() => void removeServer(server.name)}>
                    Remove
                  </button>
                </div>
                {server.lastError && <p className="error">{server.lastError}</p>}
              </article>
            ))}
            {!servers.length && <p className="muted">No MCP servers configured.</p>}
            {mutationHint && <p className="muted">{mutationHint}</p>}
            {mutationError && <p className="error">{mutationError}</p>}
            {formOpen && (
              <AddServerForm
                onAdd={addServer}
                onCancel={() => setFormOpen(false)}
                onError={setMutationError}
              />
            )}
          </div>
          {!formOpen && (
            <button className="add" onClick={() => setFormOpen(true)}>
              + Add server
            </button>
          )}
        </Panel>
        <Panel title="Tool registry">
          <div className="tool-list">
            {tools.map((tool) => (
              <div className="tool" key={tool.exposedName}>
                <code>{tool.exposedName}</code>
                <small>
                  {tool.serverName} · {tool.description ?? 'No description'}
                </small>
              </div>
            ))}
            {!tools.length && <p className="muted">No tools mirrored yet.</p>}
          </div>
        </Panel>
      </section>
      <section className="panel events-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">LIVE FEED</p>
            <h2>Proxy events</h2>
          </div>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter events"
          />
        </div>
        <div className="event-list">
          {visibleEvents.map((event) => (
            <div className="event" key={event.id}>
              <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
              <span
                className={`event-kind ${event.kind.includes('blocked') || event.kind.includes('failed') || event.kind.includes('error') ? 'danger' : ''}`}
              >
                {event.kind}
              </span>
              <span>{event.serverName ?? 'proxy'}</span>
              <code>{event.name ?? event.method ?? ''}</code>
              <span className="event-detail">
                {event.ruleId ? `rule: ${event.ruleId} · ` : ''}
                {event.durationMs !== undefined
                  ? `${event.durationMs}ms`
                  : (event.error?.message ?? '')}
              </span>
            </div>
          ))}
          {!visibleEvents.length && <p className="muted">Waiting for proxy activity.</p>}
        </div>
      </section>
    </main>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
function AddServerForm({
  onAdd,
  onCancel,
  onError,
}: {
  onAdd: (config: Record<string, unknown>) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [jsonText, setJsonText] = useState('');
  const submit = () => {
    onError('');
    if (mode === 'json') {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonText) as Record<string, unknown>;
      } catch {
        return onError('Invalid JSON.');
      }
      if (!parsed.name || typeof parsed.name !== 'string')
        return onError('JSON must include a "name" field.');
      if (!parsed.transport)
        return onError('JSON must include a "transport" field (stdio or http).');
      if (parsed.transport === 'stdio' && !parsed.command)
        return onError('stdio config must include a "command" field.');
      if (parsed.transport === 'http' && !parsed.url)
        return onError('http config must include a "url" field.');
      onAdd(parsed);
      return;
    }
    if (!name.trim()) return onError('Name is required.');
    if (transport === 'stdio') {
      if (!command.trim()) return onError('Command is required for stdio servers.');
      onAdd({
        name: name.trim(),
        transport,
        command: command.trim(),
        args: args
          .split(',')
          .map((arg) => arg.trim())
          .filter(Boolean),
      });
    } else {
      if (!url.trim()) return onError('URL is required for http servers.');
      onAdd({ name: name.trim(), transport, url: url.trim() });
    }
  };
  return (
    <article className="server add-form">
      <div className="add-form-mode">
        <button className={mode === 'form' ? 'active' : ''} onClick={() => setMode('form')}>
          Form
        </button>
        <button className={mode === 'json' ? 'active' : ''} onClick={() => setMode('json')}>
          Paste JSON
        </button>
      </div>
      {mode === 'json' ? (
        <label className="json-paste-label">
          Config JSON
          <textarea
            value={jsonText}
            onChange={(event) => setJsonText(event.target.value)}
            placeholder={
              transport === 'http'
                ? '{\n  "name": "my-server",\n  "transport": "http",\n  "url": "http://127.0.0.1:8907/mcp"\n}'
                : '{\n  "name": "my-server",\n  "transport": "stdio",\n  "command": "node",\n  "args": ["./server.mjs"]\n}'
            }
            rows={8}
          />
        </label>
      ) : (
        <div className="add-form-grid">
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="server-name"
            />
          </label>
          <label>
            Transport
            <select
              value={transport}
              onChange={(event) => setTransport(event.target.value as 'stdio' | 'http')}
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>
          </label>
          {transport === 'stdio' ? (
            <>
              <label>
                Command
                <input
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="node"
                />
              </label>
              <label>
                Args
                <input
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  placeholder="./server.mjs"
                />
              </label>
            </>
          ) : (
            <label>
              URL
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="http://127.0.0.1:8907/mcp"
              />
            </label>
          )}
        </div>
      )}
      <div className="add-form-actions">
        <button onClick={submit}>Add</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </article>
  );
}
