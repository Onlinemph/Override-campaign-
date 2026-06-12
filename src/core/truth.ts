/**
 * core/truth.ts — campaign lifecycle: genesis, replay, the run loop with compression.
 */
import type { Id, Order, TruthState } from './types.js';
import { applyEvent, type GameEvent, type LoggedEvent } from './events.js';
import type { EventStore } from './log.js';
import { MemoryEventStore } from './log.js';
import { step } from '../engine/tick.js';
import { isFormationOnNet, netPass, scoutPass } from '../engine/net.js';
import { CLOCK } from '../rules.js';

/** Rebuild truth purely from the log: truth = fold(applyEvent, genesis, events). */
export function replay(events: LoggedEvent[]): TruthState {
  const genesis = events[0];
  if (!genesis || genesis.event.type !== 'CAMPAIGN_INIT') {
    throw new Error('log must begin with CAMPAIGN_INIT');
  }
  const truth = structuredClone(genesis.event.state);
  for (const { event } of events.slice(1)) applyEvent(truth, event);
  return truth;
}

export class Campaign {
  truth: TruthState;
  constructor(public store: EventStore, truth?: TruthState) {
    this.truth = truth ?? replay(store.all());
  }

  static create(initial: TruthState, store: EventStore = new MemoryEventStore()): Campaign {
    if (store.length() > 0) throw new Error('store is not empty');
    store.append({ type: 'CAMPAIGN_INIT', state: structuredClone(initial) });
    const campaign = new Campaign(store, structuredClone(initial));
    // initialize nets & scouted terrain at tick 0, through the log like everything else
    const init: GameEvent[] = [];
    const emit = (e: GameEvent) => { init.push(e); applyEvent(campaign.truth, e); };
    netPass(campaign.truth, emit);
    scoutPass(campaign.truth, emit);
    for (const e of init) store.append(e);
    return campaign;
  }

  static fromStore(store: EventStore): Campaign {
    return new Campaign(store);
  }

  /** One engine step. Returns the emitted events. */
  step(): GameEvent[] {
    const r = step(this.truth);
    for (const e of r.events) this.store.append(e);
    this.truth = r.truth;
    return r.events;
  }

  /** Compression loop: run until something happens for someone, or the tick cap. */
  runUntilEvent(maxTicks = CLOCK.TICKS_PER_DAY): GameEvent[] {
    const startTick = this.truth.tick;
    const collected: GameEvent[] = [];
    while (this.truth.tick - startTick < maxTicks) {
      const r = step(this.truth);
      for (const e of r.events) this.store.append(e);
      this.truth = r.truth;
      collected.push(...r.events);
      if (r.interesting) break;
    }
    return collected;
  }

  /**
   * Order entry. On-net formations get the order effective next tick; off-net
   * formations cannot be reached at all (spec §3.3) — conditionals/standing orders
   * are the only way to influence them. Genesis orders bypass this (pre-plotted ops).
   */
  issueOrder(order: Order): { ok: true } | { ok: false; reason: string } {
    const f = this.truth.formations[order.formationId];
    if (!f || f.destroyed) return { ok: false, reason: 'no such formation' };
    if (!isFormationOnNet(this.truth, f)) {
      return { ok: false, reason: 'formation is off-net: order undeliverable (core 4.2)' };
    }
    const stamped: Order = { ...order, issuedTick: this.truth.tick,
                             effectiveTick: this.truth.tick + 1 };
    const e: GameEvent = { type: 'ORDER_ISSUED', order: stamped };
    this.store.append(e);
    applyEvent(this.truth, e);
    return { ok: true };
  }

  /** GM controls. */
  inject(e: GameEvent): void {
    this.store.append(e);
    applyEvent(this.truth, e);
  }

  destroyFormation(formationId: Id, reason: string): void {
    this.inject({ type: 'FORMATION_DESTROYED', formationId, reason, tick: this.truth.tick });
  }
}
