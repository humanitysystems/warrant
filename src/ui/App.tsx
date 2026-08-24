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

type Hold = {
  requestId: string;
  name: string;
  serverName: string;
  ruleId: string;
  heldAt: string;
};

type Status = {
  servers: { total: number; connected: number };
  tools: number;
  clientTransport: string;
};

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [filter, setFilter] = useState('');

  const refreshHolds = async () => {
    const response = await fetch('/api/holds');
    const data = (await response.json()) as { holds: Hold[] };
    setHolds(data.holds);
  };

  const decideHold = async (requestId: string, decision: 'approve' | 'deny') => {
    await fetch(`/api/holds/${requestId}/${decision}`, { method: 'POST' });
    void refreshHolds();
  };

  useEffect(() => {
    const load = async () => {
      const [statusResponse, serversResponse, toolsResponse, eventsResponse, holdsResponse] =
        await Promise.all([
          fetch('/api/status'),
          fetch('/api/servers'),
          fetch('/api/tools'),
          fetch('/api/events'),
          fetch('/api/holds'),
        ]);
      setStatus((await statusResponse.json()) as Status);
      const serverData = (await serversResponse.json()) as { servers: Server[] };
      const toolData = (await toolsResponse.json()) as { tools: Tool[] };
      const eventData = (await eventsResponse.json()) as { events: Event[] };
      const holdData = (await holdsResponse.json()) as { holds: Hold[] };
      setServers(serverData.servers);
      setTools(toolData.tools);
      setEvents(eventData.events);
      setHolds(holdData.holds);
    };
    void load();

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
    };
  }, []);

  const visibleEvents = events.filter((event) => {
    const searchable = `${event.kind} ${event.name ?? ''} ${event.serverName ?? ''}`.toLowerCase();
    return searchable.includes(filter.toLowerCase());
  });

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">LOCAL MCP CONTROL PLANE</p>
          <h1>Warrant</h1>
        </div>
        <div className="connection">
          <span className="dot" />
          {status ? 'Proxy online' : 'Connecting...'}
        </div>
      </header>
      <section className="status-grid">
        <Metric
          label="Downstream servers"
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
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
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
        <Panel title="Downstream servers">
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
                {server.lastError && <p className="error">{server.lastError}</p>}
              </article>
            ))}
            {!servers.length && <p className="muted">No downstream servers configured.</p>}
          </div>
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
                className={`event-kind ${
                  event.kind.includes('blocked') ||
                  event.kind.includes('failed') ||
                  event.kind.includes('error')
                    ? 'danger'
                    : ''
                }`}
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
