/**
 * engine/movement.ts — Module 0 ground movement (core §2.3, §5).
 *
 * Two formulas, one loop:
 *  - CONTACT mode: spend OMP against per-hex terrain costs (road ½, min 1).
 *  - PULSE/WATCH mode: distance budget = OMP × 10 (road) / × 5 (cross-country) hexes
 *    per pulse; terrain costs collapse into the road/cross-country distinction
 *    ("terrain permitting" — impassable hexes still block).
 * Fractional progress toward the next hex is carried on the formation between steps.
 */
import { CLOCK, MOVEMENT, ROAD_MIN_COST, ROAD_COST_FACTOR, TERRAIN } from '../rules.js';
import type { Formation, GroundPos, Hex, Order, TruthState } from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { headingDeg, hexDistance, hexLine } from '../hex/axial.js';
import { hexKey } from '../core/types.js';

const MOVE_KINDS = new Set(['MOVE', 'FORCED_MARCH', 'MOVE_CAUTIOUS']);

/**
 * Where is a STRIKE heading? Toward the latest delivered estimate of its target contact
 * (re-pathing as intel updates), falling back to a fixed targetHex. Null ⇒ no usable
 * intel: the strike stalls (the GM sees a formation with nothing to hit).
 */
export function strikeTargetHex(s: TruthState, order: Order): GroundPos | null {
  if (order.targetContactId) {
    const c = s.contacts[order.targetContactId];
    const est = c?.delivered?.estPos ?? c?.estPos;
    if (est && est.kind === 'ground') return est;
  }
  if (order.targetHex) return order.targetHex;
  return null;
}

/** OMP = slowest Walk/Cruise MP in the formation (core §3). */
export function deriveFormationOmp(units: Array<{ walkOrCruise: number }>): number {
  if (units.length === 0) return 1;
  return Math.max(1, Math.min(...units.map(u => u.walkOrCruise)));
}

export function isWheeled(s: TruthState, f: Formation): boolean {
  return f.unitIds.length > 0 &&
    f.unitIds.every(id => s.units[id]?.tags.includes('WHEELED'));
}

function getHex(s: TruthState, pos: GroundPos): Hex | undefined {
  return s.theaters[pos.theaterId]?.hexes[hexKey(pos.q, pos.r)];
}

/** OMP cost to enter a hex in CONTACT mode; null = impassable for this formation. */
export function hexEntryCost(s: TruthState, f: Formation, hex: Hex): number | null {
  const row = TERRAIN[hex.terrain];
  if (!row) return null;
  let cost = row.ompCost;
  if (cost === null) return null;
  if (row.mechInfantryOnly && isWheeled(s, f)) return null;
  if (hex.infra.includes('ROAD') || hex.infra.includes('RAIL')) {
    return Math.max(ROAD_MIN_COST, cost * ROAD_COST_FACTOR);
  }
  if (isWheeled(s, f) && ['ROUGH', 'WOODS', 'SWAMP'].includes(hex.terrain)) {
    cost *= MOVEMENT.WHEELED_OFFROAD_FACTOR;
  }
  return cost;
}

function speedMult(kind: Order['kind']): number {
  if (kind === 'FORCED_MARCH') return MOVEMENT.FORCED_MARCH_MULT;
  if (kind === 'MOVE_CAUTIOUS') return MOVEMENT.CAUTIOUS_SPEED_FACTOR; // D-006
  return 1;
}

function movedKindOf(kind: Order['kind']): 'NORMAL' | 'CAUTIOUS' | 'FORCED' {
  if (kind === 'FORCED_MARCH') return 'FORCED';
  if (kind === 'MOVE_CAUTIOUS') return 'CAUTIOUS';
  return 'NORMAL';
}

/**
 * Move every formation with an active move order; returns events (caller applies them).
 * `emit` applies each event to the working truth immediately so later subsystems see
 * updated positions.
 */
export function movementPass(
  s: TruthState, dt: number, emit: (e: GameEvent) => void,
): void {
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || !f.currentOrderId) continue;
    const order = s.orders[f.currentOrderId];
    if (!order || order.completed || f.pos.kind !== 'ground') continue;
    if (s.tick < order.effectiveTick) continue;
    const isStrike = order.kind === 'STRIKE';
    if (!isStrike && !MOVE_KINDS.has(order.kind)) continue;

    // STRIKE re-paths toward the live contact estimate; everything else follows its plot.
    let path: GroundPos[];
    let pathIndex: number;
    if (isStrike) {
      const target = strikeTargetHex(s, order);
      const cur = f.pos as GroundPos;
      if (!target || hexDistance(cur, target) === 0) continue; // arrived or blind: hold
      path = hexLine(cur, target).slice(1).map(h => ({ ...cur, q: h.q, r: h.r }));
      pathIndex = 0; // path rebuilt from current position each step
    } else {
      if (!order.path) continue;
      path = order.path.filter((p): p is GroundPos => p.kind === 'ground');
      pathIndex = f.pathIndex ?? 0;
    }
    let progress = f.moveProgress ?? 0;
    const mult = speedMult(order.kind);

    // Available budget for this step:
    //  CONTACT mode: OMP points (1 contact turn's worth × dt ticks)
    //  PULSE/WATCH:  pulses of marching time
    const contactScale = s.clockMode === 'CONTACT';
    let avail = contactScale ? f.omp * mult * dt : dt / CLOCK.TICKS_PER_PULSE;

    let moved = false;
    let forcedPulses = 0;

    while (pathIndex < path.length && avail > 1e-9) {
      const next = path[pathIndex];
      const cur = f.pos as GroundPos;
      if (hexDistance(cur, next) === 0) { pathIndex++; continue; }

      const hex = getHex(s, next);
      if (!hex) break;
      const onRoad = hex.infra.includes('ROAD') || hex.infra.includes('RAIL');

      let hexCost: number; // in the unit of `avail`
      if (contactScale) {
        const c = hexEntryCost(s, f, hex);
        if (c === null) break; // impassable: order stalls, GM sees the stuck counter
        hexCost = c;
      } else {
        const c = hexEntryCost(s, f, hex);
        if (c === null) break;
        const rate = f.omp * (onRoad ? MOVEMENT.PULSE_ROAD_MULT : MOVEMENT.PULSE_CROSS_COUNTRY_MULT) * mult;
        hexCost = 1 / rate; // pulses per hex
      }

      const need = (1 - progress) * hexCost;
      if (avail + 1e-9 >= need) {
        avail -= need;
        if (order.kind === 'FORCED_MARCH' && !contactScale) forcedPulses += need;
        emit({
          type: 'FORMATION_MOVED', formationId: f.id, to: { ...next },
          movedKind: movedKindOf(order.kind), onRoad,
          headingDeg: Math.round(headingDeg(cur, next)), tick: s.tick,
        });
        moved = true;
        progress = 0;
        pathIndex++;
      } else {
        progress += avail / hexCost;
        if (order.kind === 'FORCED_MARCH' && !contactScale) forcedPulses += avail;
        avail = 0;
      }
    }

    if (moved || progress !== (f.moveProgress ?? 0)) {
      emit({ type: 'MOVE_PROGRESS', formationId: f.id, moveProgress: progress, pathIndex });
    }

    // Forced march fatigue: RDY −1 per pulse of marching (core §3.2 / §4.1)
    if (order.kind === 'FORCED_MARCH') {
      const pulsesThisStep = contactScale ? dt / CLOCK.TICKS_PER_PULSE : forcedPulses;
      let acc = (f.forcedMarchPulseAcc ?? 0) + pulsesThisStep;
      while (acc >= 1 - 1e-9) {
        emit({ type: 'RDY_CHANGED', formationId: f.id,
               delta: MOVEMENT.FORCED_MARCH_RDY_PER_PULSE, reason: 'forced march' });
        acc -= 1;
      }
      s.formations[f.id].forcedMarchPulseAcc = acc; // bookkeeping, not event-worthy
    }

    // STRIKE never self-completes here: arrival is resolved by the engagement pass
    // (battle if the enemy is present, completion-with-miss if the estimate was stale).
    if (!isStrike && pathIndex >= path.length) {
      emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
    }
  }
}
