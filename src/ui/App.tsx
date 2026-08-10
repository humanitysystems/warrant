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
  error?: { message: string };
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
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const load = async () => {
      const [statusResponse, serversResponse, toolsResponse, eventsResponse] = await Promise.all([
        fetch('/api/status'), fetch('/api/servers'), fetch('/api/tools'), fetch('/api/events'),
      ]);
      setStatus(await statusResponse.json() as Status);
      const serverData = await serversResponse.json() as { servers: Server[] };
      const toolData = await toolsResponse.json() as { tools: Tool[] };
      const eventData = await eventsResponse.json() as { events: Event[] };
      setServers(serverData.servers);
      setTools(toolData.tools);
      setEvents(eventData.events);
    };
    void load();

    const source = new EventSource('/api/events/stream');
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as Event;
      setEvents((current) => [event, ...current].slice(0, 500));
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, []);

  const visibleEvents = events.filter((event) => {
    const searchable = `${event.kind} ${event.name ?? ''} ${event.serverName ?? ''}`.toLowerCase();
    return searchable.includes(filter.toLowerCase());
  });

  return (
    <main>
      <header className="topbar">
        <div><p className="eyebrow">LOCAL MCP CONTROL PLANE</p><h1>Warrant</h1></div>
        <div className="connection"><span className="dot" />{status ? 'Proxy online' : 'Connecting...'}</div>
      </header>
      <section className="status-grid">
        <Metric label="Downstream servers" value={`${status?.servers.connected ?? 0}/${status?.servers.total ?? 0}`} />
        <Metric label="Mirrored tools" value={String(status?.tools ?? 0)} />
        <Metric label="Client transport" value={status?.clientTransport ?? '...'} />
      </section>
      <section className="columns">
        <Panel title="Downstream servers">
          <div className="server-list">
            {servers.map((server) => <article className="server" key={server.name}>
              <div><strong>{server.name}</strong><span className={`badge ${server.status}`}>{server.status}</span></div>
              <small>{server.transport} · {server.tools.length} tools</small>
              {server.lastError && <p className="error">{server.lastError}</p>}
            </article>)}
            {!servers.length && <p className="muted">No downstream servers configured.</p>}
          </div>
        </Panel>
        <Panel title="Tool registry">
          <div className="tool-list">
            {tools.map((tool) => <div className="tool" key={tool.exposedName}>
              <code>{tool.exposedName}</code><small>{tool.serverName} · {tool.description ?? 'No description'}</small>
            </div>)}
            {!tools.length && <p className="muted">No tools mirrored yet.</p>}
          </div>
        </Panel>
      </section>
      <section className="panel events-panel">
        <div className="panel-heading"><div><p className="eyebrow">LIVE FEED</p><h2>Proxy events</h2></div><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter events" /></div>
        <div className="event-list">
          {visibleEvents.map((event) => <div className="event" key={event.id}>
            <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
            <span className={`event-kind ${event.kind.includes('failed') || event.kind.includes('error') ? 'danger' : ''}`}>{event.kind}</span>
            <span>{event.serverName ?? 'proxy'}</span><code>{event.name ?? event.method ?? ''}</code>
            <span className="event-detail">{event.durationMs !== undefined ? `${event.durationMs}ms` : event.error?.message ?? ''}</span>
          </div>)}
          {!visibleEvents.length && <p className="muted">Waiting for proxy activity.</p>}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel"><div className="panel-heading"><h2>{title}</h2></div>{children}</section>;
}
