import { describe, expect, it } from 'vitest';
import { EventStore } from '@/events/event-store.js';

describe('EventStore', () => {
  it('keeps newest events within its bound and notifies subscribers', () => {
    const store = new EventStore(2);
    const received: string[] = [];
    const unsubscribe = store.subscribe((event) => received.push(event.kind));

    store.append({ kind: 'server.connected', serverName: 'files' });
    store.append({ kind: 'request.started', method: 'tools/call' });
    store.append({ kind: 'request.succeeded', method: 'tools/call' });
    unsubscribe();

    expect(received).toEqual(['server.connected', 'request.started', 'request.succeeded']);
    expect(store.list()).toHaveLength(2);
    expect(store.list()[0]?.kind).toBe('request.succeeded');
  });
});
