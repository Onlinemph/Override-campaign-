/**
 * engine/tick.ts — the tick loop (spec §3.1).
 *
 * step() is the only place the campaign advances. It works on a clone of truth,
 * emits events (each applied immediately so later subsystems see fresh state),
 * and returns the events plus whether anything "interesting" happened (compression).
 */
import type { ClockMode, GroundPos, TruthState } from '../core/types.js';
import { applyEvent, isInterestingEvent, type GameEvent } from '../core/events.js';
import { chooseClockMode, ticksFor } from './clock.js';
import { movementPass } from './movement.js';
import { detectionPass, fadePass, satellitePass } from './detection.js';
import { deliverReportsPass, netPass, scoutPass } from './net.js';
import { triggerPass } from './triggers.js';
import { engagementPass } from './engagement.js';
import { maintenancePass } from './logistics.js';
import { airDetectionPass, airPass } from './air.js';
import { spacePass } from './space.js';
import { carrierPass } from './carrier.js';
import { careerPass } from './career.js';
import { scoringPass } from './scoring.js';
import { firesPass } from './fires.js';
import { engineeringPass } from './engineering.js';
import { capitalDenialPass } from './flak.js';

export interface StepResult {
  truth: TruthState;
  events: GameEvent[];
  interesting: boolean;
  dt: number;
  paused: boolean; // true ⇒ campaign frozen awaiting GM resolution of a pending engagement
}

function applyDueOrders(s: TruthState, emit: (e: GameEvent) => void): void {
  const due = new Map<string, typeof s.orders[string][]>();
  for (const o of Object.values(s.orders)) {
    if (o.completed || s.tick < o.effectiveTick) continue;
    // D-049: a plan step waits for its predecessor to finish
    if (o.afterOrderId && !s.orders[o.afterOrderId]?.completed) continue;
    const f = s.formations[o.formationId];
    if (!f || f.destroyed || f.currentOrderId === o.id) continue;
    // routed formations are uncommandable for the rout window (core §3.2/§7.4)
    if (f.routUntilTick != null && s.tick < f.routUntilTick) continue;
    if (!due.has(o.formationId)) due.set(o.formationId, []);
    due.get(o.formationId)!.push(o);
  }
  for (const [formationId, orders] of due) {
    orders.sort((a, b) => a.effectiveTick - b.effectiveTick || a.issuedTick - b.issuedTick);
    const next = orders[orders.length - 1]; // the most recently plotted plan wins
    const f = s.formations[formationId];
    const cur = f.currentOrderId ? s.orders[f.currentOrderId] : undefined;
    if (cur && !cur.completed && next.effectiveTick < cur.effectiveTick) {
      // every due order predates the one already running: all stale, all dead
      for (const o of orders) {
        emit({ type: 'ORDER_CANCELLED', orderId: o.id, formationId, tick: s.tick });
      }
      continue;
    }
    // D-059: the LOSERS of this race must die too. They used to linger un-completed
    // in s.orders, come due again the moment the winner finished, and march the unit
    // back along a path the player had already corrected away from.
    for (const o of orders) {
      if (o.id !== next.id) {
        emit({ type: 'ORDER_CANCELLED', orderId: o.id, formationId, tick: s.tick });
      }
    }
    if (cur && !cur.completed) {
      emit({ type: 'ORDER_SUPERSEDED', orderId: cur.id, formationId, tick: s.tick });
    }
    // D-049: activating a NEWER instruction abandons the old plan — its still-
    // pending steps are cancelled so a finished new order can't resurrect them.
    // Steps of the plan being activated share next.issuedTick and survive.
    for (const o of Object.values(s.orders)) {
      if (o.formationId !== formationId || o.completed || o.id === next.id) continue;
      if (o.afterOrderId && o.issuedTick < next.issuedTick) {
        emit({ type: 'ORDER_CANCELLED', orderId: o.id, formationId, tick: s.tick });
      }
    }
    emit({ type: 'ORDER_ACTIVATED', orderId: next.id, formationId, tick: s.tick });
  }
}

export function step(truth: TruthState, forceMode?: ClockMode): StepResult {
  // Frozen on a pending engagement (spec §3.1): the campaign does not advance until the
  // GM exports the handoff and ingests a result. step() is a no-op while paused.
  // Likewise once the campaign has ended (core §12.2).
  if (truth.pendingEngagementId || truth.ended) {
    return { truth, events: [], interesting: false, dt: 0, paused: true };
  }

  const work = structuredClone(truth);
  const events: GameEvent[] = [];
  const emit = (e: GameEvent) => { events.push(e); applyEvent(work, e); };

  const mode = forceMode ?? chooseClockMode(work);
  const dt = ticksFor(mode);
  emit({ type: 'STEP_BEGAN', tick: work.tick, mode, dt });

  applyDueOrders(work, emit);
  movementPass(work, dt, emit);
  engineeringPass(work, dt, emit); // minefield bites on movers + engineer toolkit (M7)
  airPass(work, dt, emit);      // flight ledgers, launches, chases, thresholds (M3)
  capitalDenialPass(work, emit); // D-050: anti-capital umbrellas engage overflights
  spacePass(work, dt, emit);    // lanes, light lag, jump board, skimming (M4)
  carrierPass(work, emit);      // embarked units ride their carrier to its final position
  netPass(work, emit);          // positions changed: recompute nets before detection
  firesPass(work, emit);        // artillery shoots, counter-battery reveals it (M7)
  detectionPass(work, emit);
  airDetectionPass(work, emit); // radar horizon + air-to-air (M3)
  satellitePass(work, emit);
  fadePass(work, emit);
  deliverReportsPass(work, emit);
  // D-059: sweep the hexes each formation moved THROUGH this step, not just where
  // it ended up — a fast column used to leave dark stripes along its own path
  const visited = new Map<string, GroundPos[]>();
  for (const e of events) {
    if (e.type === 'FORMATION_MOVED' && e.to.kind === 'ground') {
      const list = visited.get(e.formationId) ?? [];
      list.push(e.to);
      visited.set(e.formationId, list);
    }
  }
  scoutPass(work, emit, visited);
  maintenancePass(work, dt, emit);
  careerPass(work, emit);       // pilots heal, repairs finish, refits deliver (ext)
  scoringPass(work, emit);      // objective control, daily VP, endings (M6)
  triggerPass(work, emit);      // conditionals react to this step's contacts/positions
  engagementPass(work, emit);   // may freeze the campaign (sets pendingEngagementId)

  emit({ type: 'CLOCK_ADVANCED', dt, tick: work.tick + dt });

  return {
    truth: work, events, dt,
    interesting: events.some(isInterestingEvent),
    paused: !!work.pendingEngagementId || !!work.ended,
  };
}
