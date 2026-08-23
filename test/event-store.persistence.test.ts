import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventStore } from '@/events/event-store';

describe('EventStore persistence', () => {
  it('serves events written by an earlier store instance after restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'warrant-eventstore-'));
    const path = join(dir, 'events.db');

    const first = new EventStore({ path });
    const appended = first.append({ kind: 'server.connected', serverName: 'files' });
    first.close();

    const second = new EventStore({ path });
    const page = second.list();

    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.kind).toBe('server.connected');
    expect(page.events[0]?.serverName).toBe('files');
    expect(page.events[0]?.id).toBe(appended.id);
    expect(page.nextCursor).toBeUndefined();
    second.close();
  });

  it('paginates newest-first via seq cursors until the oldest event is served', () => {
    const store = new EventStore();
    for (let i = 1; i <= 25; i += 1) {
      store.append({ kind: 'request.started', method: 'tools/call', name: `tool-${i}` });
    }

    const firstPage = store.list({ limit: 10 });
    expect(firstPage.events.map((event) => event.name)).toEqual([
      'tool-25',
      'tool-24',
      'tool-23',
      'tool-22',
      'tool-21',
      'tool-20',
      'tool-19',
      'tool-18',
      'tool-17',
      'tool-16',
    ]);
    expect(firstPage.nextCursor).toBe(firstPage.events.at(-1)?.seq);

    const secondPage = store.list({ limit: 10, before: firstPage.nextCursor });
    expect(secondPage.events).toHaveLength(10);
    expect(secondPage.events[0]?.name).toBe('tool-15');
    expect(secondPage.nextCursor).toBeDefined();

    const thirdPage = store.list({ limit: 10, before: secondPage.nextCursor });
    expect(thirdPage.events.map((event) => event.name)).toEqual([
      'tool-5',
      'tool-4',
      'tool-3',
      'tool-2',
      'tool-1',
    ]);
    expect(thirdPage.nextCursor).toBeUndefined();
    store.close();
  });

  it('notifies subscribers live while persisting', () => {
    const store = new EventStore();
    const received: string[] = [];
    const unsubscribe = store.subscribe((event) => received.push(event.kind));
    store.append({ kind: 'server.connected', serverName: 'files' });
    unsubscribe();

    expect(received).toEqual(['server.connected']);
    expect(store.list().events).toHaveLength(1);
    store.close();
  });
});
