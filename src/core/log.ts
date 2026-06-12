/**
 * core/log.ts — append-only event stores (D-001: JSONL first, interface for SQLite later).
 * There is deliberately no update or delete API.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { GameEvent, LoggedEvent } from './events.js';

export interface EventStore {
  append(event: GameEvent): LoggedEvent;
  all(): LoggedEvent[];
  length(): number;
}

export class MemoryEventStore implements EventStore {
  private events: LoggedEvent[] = [];
  append(event: GameEvent): LoggedEvent {
    const logged = { index: this.events.length, event };
    this.events.push(logged);
    return logged;
  }
  all(): LoggedEvent[] { return [...this.events]; }
  length(): number { return this.events.length; }
}

export class JsonlEventStore implements EventStore {
  private count: number;
  constructor(private path: string) {
    this.count = existsSync(path)
      ? readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).length
      : 0;
  }
  append(event: GameEvent): LoggedEvent {
    const logged = { index: this.count, event };
    appendFileSync(this.path, JSON.stringify(logged) + '\n');
    this.count++;
    return logged;
  }
  all(): LoggedEvent[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8')
      .split('\n').filter(l => l.trim())
      .map(l => JSON.parse(l) as LoggedEvent);
  }
  length(): number { return this.count; }
}
