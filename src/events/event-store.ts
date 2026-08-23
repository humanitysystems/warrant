import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { ProxyEvent } from '@/events/types';

type EventInput = Partial<Omit<ProxyEvent, 'id' | 'timestamp' | 'seq'>> & {
  kind: ProxyEvent['kind'];
};

type Listener = (event: ProxyEvent) => void;

export interface ListEventsQuery {
  limit?: number;
  before?: number;
}

export interface EventPage {
  events: ProxyEvent[];
  nextCursor?: number;
}

const DEFAULT_PAGE_LIMIT = 100;

function assertSqliteAvailable(): void {
  if (DatabaseSync === undefined) {
    throw new Error(
      'node:sqlite is unavailable in this Node build. Use Node >=22.12 (or >=23.4), or run Node 22 with the --experimental-sqlite flag.',
    );
  }
}

export class EventStore {
  private readonly db: DatabaseSync;
  private readonly listeners = new Set<Listener>();

  constructor(options: { path?: string } = {}) {
    assertSqliteAvailable();
    this.db = new DatabaseSync(options.path ?? ':memory:');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        kind TEXT NOT NULL,
        request_id TEXT,
        server_name TEXT,
        method TEXT,
        name TEXT,
        duration_ms INTEGER,
        error_code TEXT,
        error_message TEXT,
        rule_id TEXT
      )
    `);
  }

  append(input: EventInput): ProxyEvent {
    const event: Omit<ProxyEvent, 'seq'> = {
      ...input,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    const result = this.db
      .prepare(
        `INSERT INTO events (id, timestamp, kind, request_id, server_name, method, name, duration_ms, error_code, error_message, rule_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.timestamp,
        event.kind,
        event.requestId ?? null,
        event.serverName ?? null,
        event.method ?? null,
        event.name ?? null,
        event.durationMs ?? null,
        event.error?.code != null ? String(event.error.code) : null,
        event.error?.message ?? null,
        event.ruleId ?? null,
      );
    const stored: ProxyEvent = { ...event, seq: Number(result.lastInsertRowid) };
    for (const listener of this.listeners) listener(stored);
    return stored;
  }

  list(query: ListEventsQuery = {}): EventPage {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_LIMIT, 1), 500);
    const statement =
      query.before !== undefined
        ? this.db.prepare('SELECT * FROM events WHERE seq < ? ORDER BY seq DESC LIMIT ?')
        : this.db.prepare('SELECT * FROM events ORDER BY seq DESC LIMIT ?');
    const rows =
      query.before !== undefined
        ? statement.all(query.before, limit + 1)
        : statement.all(limit + 1);
    const page = rows.slice(0, limit).map((row) => this.toEvent(row));
    return {
      events: page,
      ...(page.length === limit && rows.length > limit && page.at(-1)?.seq !== undefined
        ? { nextCursor: page.at(-1)!.seq }
        : {}),
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.db.close();
  }

  private toEvent(row: Record<string, unknown>): ProxyEvent {
    const event: ProxyEvent = {
      seq: Number(row.seq),
      id: String(row.id),
      timestamp: String(row.timestamp),
      kind: row.kind as ProxyEvent['kind'],
    };
    if (row.request_id !== null) event.requestId = String(row.request_id);
    if (row.server_name !== null) event.serverName = String(row.server_name);
    if (row.method !== null) event.method = String(row.method);
    if (row.name !== null) event.name = String(row.name);
    if (row.duration_ms !== null) event.durationMs = Number(row.duration_ms);
    if (row.rule_id !== null) event.ruleId = String(row.rule_id);
    if (row.error_message !== null || row.error_code !== null) {
      event.error = {
        ...(row.error_code !== null ? { code: row.error_code as string | number } : {}),
        ...(row.error_message !== null ? { message: String(row.error_message) } : { message: '' }),
      };
    }
    return event;
  }
}
