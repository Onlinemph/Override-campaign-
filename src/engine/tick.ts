/**
 * engine/tick.ts — the tick loop (spec §3.1).
 *
 * step() is the only place the campaign advances. It works on a clone of truth,
 * emits events (each applied immediately so later subsystems see fresh state),
 * and returns the events plus whether anything "interesting" happened (compression).
 */
import type { TruthState } from '../core/types.js';
import { applyEvent, isInterestingEvent, type GameEvent } from '../core/events.js';
import { chooseClockMode, ticksFor } from './clock.js';
import { movementPass } from './movement.js';
import { detectionPass, fadePass, satellitePass } from './detection.js';
import { deliverReportsPass, netPass, scoutPass } from './net.js';

export interface StepResult {
  truth: TruthState;
  events: GameEvent[];
  interesting: boolean;
  dt: number;
}

function applyDueOrders(s: TruthState, emit: (e: GameEvent) => void): void {
  const due = new Map<string, typeof s.orders[string][]>();
  for (const o of Object.values(s.orders)) {
    if (o.completed || s.tick < o.effectiveTick) continue;
    const f = s.formations[o.formationId];
    if (!f || f.destroyed || f.currentOrderId === o.id) continue;
    if (!due.has(o.formationId)) due.set(o.formationId, []);
    due.get(o.formationId)!.push(o);
  }
  for (const [formationId, orders] of due) {
    orders.sort((a, b) => a.effectiveTick - b.effectiveTick || a.issuedTick - b.issuedTick);
    const next = orders[orders.length - 1]; // the most recently plotted plan wins
    const f = s.formations[formationId];
    const cur = f.currentOrderId ? s.orders[f.currentOrderId] : undefined;
    if (cur && !cur.completed) {
      if (next.effectiveTick < cur.effectiveTick) continue; // stale order: ignore
      emit({ type: 'ORDER_SUPERSEDED', orderId: cur.id, formationId, tick: s.tick });
    }
    emit({ type: 'ORDER_ACTIVATED', orderId: next.id, formationId, tick: s.tick });
  }
}

export function step(truth: TruthState): StepResult {
  const work = structuredClone(truth);
  const events: GameEvent[] = [];
  const emit = (e: GameEvent) => { events.push(e); applyEvent(work, e); };

  const mode = chooseClockMode(work);
  const dt = ticksFor(mode);
  emit({ type: 'STEP_BEGAN', tick: work.tick, mode, dt });

  applyDueOrders(work, emit);
  movementPass(work, dt, emit);
  netPass(work, emit);          // positions changed: recompute nets before detection
  detectionPass(work, emit);
  satellitePass(work, emit);
  fadePass(work, emit);
  deliverReportsPass(work, emit);
  scoutPass(work, emit);
  // triggers & engagements: Milestone 2

  emit({ type: 'CLOCK_ADVANCED', dt, tick: work.tick + dt });

  return { truth: work, events, interesting: events.some(isInterestingEvent), dt };
}
