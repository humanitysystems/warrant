import { randomUUID } from 'node:crypto';
import type { ProxyEvent } from '@/events/types';

type Listener = (event: ProxyEvent) => void;

export class EventStore {
  private readonly events: ProxyEvent[] = [];
  private readonly listeners = new Set<Listener>();

  constructor(private readonly maxEvents = 500) {}

  append(event: Omit<ProxyEvent, 'id' | 'timestamp'>): ProxyEvent {
    const stored: ProxyEvent = {
      ...event,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    this.events.push(stored);
    if (this.events.length > this.maxEvents) this.events.shift();
    for (const listener of this.listeners) listener(stored);
    return stored;
  }

  list(): ProxyEvent[] {
    return [...this.events].reverse();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
