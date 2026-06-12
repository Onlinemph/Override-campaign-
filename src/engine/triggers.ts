/**
 * engine/triggers.ts — conditional order triggers (spec §2.6, §3.3).
 *
 * Conditionals ride on a formation's active order and fire even when the formation is
 * OFF-NET ("conditionals keep running", spec §3.3) — that is the whole point: a plotted
 * fallback executes without the player present. A fired conditional spawns its embedded
 * `thenOrder` (fresh id, effective next tick); the normal order-activation path then
 * supersedes the current order.
 */
import type { GroundPos, Id, Order, TruthState, Trigger } from '../core/types.js';
import { hexKey } from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { hexDistance } from '../hex/axial.js';

function asHex(pos: { kind: string }): GroundPos | null {
  return pos.kind === 'ground' ? (pos as GroundPos) : null;
}

/** Highest ladder level any enemy of `sideId` holds on `formationId`. */
function enemyLadderOn(s: TruthState, sideId: Id, formationId: Id): number {
  let best = 0;
  for (const c of Object.values(s.contacts)) {
    if (c.targetFormationId === formationId && c.observerSideId !== sideId) {
      best = Math.max(best, c.level);
    }
  }
  return best;
}

/** Nearest own-side contact (level ≥1) to `from`, in hexes; Infinity if none. */
function nearestOwnContactDist(s: TruthState, sideId: Id, from: GroundPos): number {
  let best = Infinity;
  for (const c of Object.values(s.contacts)) {
    if (c.observerSideId !== sideId || c.level < 1) continue;
    const h = asHex(c.estPos);
    if (h && h.theaterId === from.theaterId) best = Math.min(best, hexDistance(from, h));
  }
  return best;
}

export function evalTrigger(
  s: TruthState, formationId: Id, sideId: Id, trigger: Trigger,
): boolean {
  const f = s.formations[formationId];
  const here = asHex(f.pos);
  switch (trigger.when) {
    case 'TICK_REACHED':
      return s.tick >= Number(trigger.param);
    case 'RDY_BELOW':
      return f.rdy < Number(trigger.param);
    case 'HEX_REACHED': {
      if (!here) return false;
      // param "q,r"
      return hexKey(here.q, here.r) === String(trigger.param);
    }
    case 'CONTACT_WITHIN':
      return here ? nearestOwnContactDist(s, sideId, here) <= Number(trigger.param) : false;
    case 'DETECTED_SELF':
      // enemy holds ladder ≥ param on this formation (param defaults to 1 = any sighting)
      return enemyLadderOn(s, sideId, formationId) >= (Number(trigger.param) || 1);
    case 'ALLY_ENGAGED': {
      if (!here) return false;
      const radius = Number(trigger.param);
      for (const eng of Object.values(s.engagements)) {
        if (eng.status === 'RESOLVED' || eng.status === 'EVADED') continue;
        if (eng.attackerSideId !== sideId && eng.defenderSideId !== sideId) continue;
        if (hexDistance(here, eng.hex) <= radius) return true;
      }
      return false;
    }
    case 'FUEL_BELOW':
      return false; // parked until M3 (flight ledgers)
    default:
      return false;
  }
}

export function triggerPass(s: TruthState, emit: (e: GameEvent) => void): void {
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || !f.currentOrderId) continue;
    const order = s.orders[f.currentOrderId];
    if (!order || order.completed || !order.conditionals?.length) continue;

    for (let i = 0; i < order.conditionals.length; i++) {
      const cond = order.conditionals[i];
      if (cond.fired) continue;
      if (!evalTrigger(s, f.id, f.sideId, cond.trigger)) continue;

      const newOrder: Order = {
        ...cond.thenOrder,
        id: `cond:${order.id}:${i}:${s.tick}`,
        formationId: f.id,
        sideId: f.sideId,
        issuedTick: s.tick,
        effectiveTick: s.tick + 1, // activates next step, supersedes current order
        conditionals: [],
      };
      emit({ type: 'TRIGGER_FIRED', orderId: order.id, formationId: f.id,
             triggerIndex: i, newOrder, tick: s.tick });
    }
  }
}
