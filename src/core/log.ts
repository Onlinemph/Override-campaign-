/**
 * core/log.ts — append-only event stores (D-001: JSONL first, interface for SQLite later).
 * The normal play path only appends. `truncate` is the single, deliberate exception
 * (D-015): GM time-travel / undo rewinds the log by dropping a suffix, then replays.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { GameEvent, LoggedEvent } from './events.js';

export interface EventStore {
  append(event: GameEvent): LoggedEvent;
  all(): LoggedEvent[];
  length(): number;
  /** Rewind: keep the first `n` events, discard the rest (undo / GM time-travel, D-015). */
  truncate(n: number): void;
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
  truncate(n: number): void { this.events = this.events.slice(0, Math.max(0, n)); }
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
  truncate(n: number): void {
    const kept = this.all().slice(0, Math.max(0, n));
    writeFileSync(this.path, kept.map(e => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''));
    this.count = kept.length;
  }
}
