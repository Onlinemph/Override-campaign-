/**
 * engine/movement.ts — Module 0 ground movement (core §2.3, §5).
 *
 * OMP is hexes per HOUR at the 18 km operational scale. Two formulas, one loop:
 *  - CONTACT mode (6-min turns): budget = OMP/10 per turn, spent against per-hex terrain
 *    costs (road ½, min 1) — so a unit crawls ~3 turns per clear hex near combat.
 *  - PULSE/WATCH mode: budget = OMP hexes per pulse (× ROAD_BONUS on roads); terrain
 *    collapses to the road/off-road distinction (impassable hexes still block).
 * Fractional progress toward the next hex is carried on the formation between steps.
 */
import { CLOCK, MOVEMENT, RECON_TRICKS, ROAD_MIN_COST, ROAD_COST_FACTOR, TERRAIN } from '../rules.js';
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

/**
 * How a formation crosses the map (core §5.3). A formation gets a special motion
 * family only when EVERY unit shares it — mixed columns move like their most
 * restrictive member, the same slowest-common-denominator rule OMP uses for speed.
 */
export type MotionFamily = 'VTOL' | 'NAVAL' | 'HOVER' | 'GROUND';
export function motionFamily(s: TruthState, f: Formation): MotionFamily {
  const units = f.unitIds.map(id => s.units[id]).filter(Boolean);
  if (units.length === 0) return 'GROUND';
  if (units.every(u => u.class === 'VTOL')) return 'VTOL';
  if (units.every(u => u.class === 'NAVAL')) return 'NAVAL';
  if (units.every(u => u.tags.includes('HOVER'))) return 'HOVER';
  return 'GROUND';
}

/** Vehicles of any stripe — what MOUNTAIN's mech/infantry-only rule keeps out. */
function hasGroundVehicles(s: TruthState, f: Formation): boolean {
  return f.unitIds.some(id => {
    const u = s.units[id];
    return u && (u.class === 'VEHICLE' || u.class === 'SUPPORT' || u.class === 'NAVAL');
  });
}

function getHex(s: TruthState, pos: GroundPos): Hex | undefined {
  return s.theaters[pos.theaterId]?.hexes[hexKey(pos.q, pos.r)];
}

/** OMP cost to enter a hex in CONTACT mode; null = impassable for this formation. */
export function hexEntryCost(s: TruthState, f: Formation, hex: Hex): number | null {
  const row = TERRAIN[hex.terrain];
  if (!row) return null;
  const family = motionFamily(s, f);
  // VTOLs overfly the map: every hex at flat cost, roads and rivers alike (core §5.3)
  if (family === 'VTOL') return 1;
  // naval stays in the water
  if (family === 'NAVAL') return hex.terrain === 'WATER' ? 1 : null;
  // hover skims: water & swamp at 1, mountains are a wall (TERRAIN.hoverCost)
  let cost = family === 'HOVER' && row.hoverCost !== undefined ? row.hoverCost : row.ompCost;
  if (cost === null) return null;
  // mountains take mechs and infantry only — no vehicle of any kind (core §5.2)
  if (row.mechInfantryOnly && hasGroundVehicles(s, f)) return null;
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
    if (f.mounted) continue; // embarked: rides the carrier (carrierPass), no self-move
    const order = s.orders[f.currentOrderId];
    if (!order || order.completed || f.pos.kind !== 'ground') continue;
    if (s.tick < order.effectiveTick) continue;
    const isStrike = order.kind === 'STRIKE';
    const isEmbark = order.kind === 'EMBARK';
    const isShadow = order.kind === 'SHADOW';
    if (!isStrike && !isEmbark && !isShadow && !MOVE_KINDS.has(order.kind)) continue;

    // EMBARK (ext): march to the carrier's live position; load when co-located with it
    // landed and holding a free bay. A bad target (not a carrier / wrong side / gone)
    // fizzles the order; a full or airborne carrier makes the column wait at the ramp.
    if (isEmbark) {
      const carrier = order.targetFormationId ? s.formations[order.targetFormationId] : undefined;
      if (!carrier || carrier.destroyed || !carrier.carrier || carrier.sideId !== f.sideId ||
          carrier.id === f.id) {
        emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
        continue;
      }
      if (carrier.pos.kind === 'ground' && hexDistance(f.pos as GroundPos, carrier.pos) === 0 &&
          (f.pos as GroundPos).theaterId === carrier.pos.theaterId) {
        const aboard = Object.values(s.formations).filter(x =>
          !x.destroyed && x.mounted?.carrierFormationId === carrier.id).length;
        if (aboard < carrier.carrier.bays) {
          emit({ type: 'MOUNT_CHANGED', formationId: f.id, carrierFormationId: carrier.id });
          emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
        }
        continue; // loaded — or waiting at the ramp for a bay
      }
      if (carrier.pos.kind !== 'ground') continue; // carrier aloft: wait for it to land
      // fall through to the movement machinery, marching on the carrier's hex
    }

    // STRIKE re-paths toward the live contact estimate; everything else follows its plot.
    const cur0 = f.pos as GroundPos;
    // SHADOW (ext): trail the contact at standoff distance — close when the trail
    // stretches, hold when near, never enter the standoff ring (so no engagement fires).
    // A standing order: it never completes; a faded contact just makes the tail hold.
    const shadowTarget = isShadow ? strikeTargetHex(s, order) : null;
    if (isShadow) {
      if (!shadowTarget ||
          hexDistance(cur0, shadowTarget) <= RECON_TRICKS.SHADOW_STANDOFF_HEXES) {
        continue; // blind or close enough: hold and watch
      }
    }
    let wps: GroundPos[];
    if (isStrike) {
      const target = strikeTargetHex(s, order);
      if (!target || hexDistance(cur0, target) === 0) continue; // arrived or blind: hold
      wps = [target];
    } else if (isShadow) {
      wps = [shadowTarget!];
    } else if (isEmbark) {
      // re-path toward the carrier's current hex every step (own force: always known)
      const carrier = s.formations[order.targetFormationId!];
      wps = [{ ...(carrier.pos as GroundPos) }];
    } else {
      if (!order.path) continue;
      wps = order.path.filter((p): p is GroundPos => p.kind === 'ground');
    }
    let pathIndex = (isStrike || isEmbark || isShadow) ? 0 : (f.pathIndex ?? 0);
    // skip any leading waypoint we're already standing on
    while (pathIndex < wps.length && hexDistance(cur0, wps[pathIndex]) === 0) pathIndex++;

    // Interpolate the EXACT hexes to traverse — from the current position through the
    // remaining waypoints — so the unit follows the drawn route line precisely (this is
    // the same hexLine-through-waypoints the map overlay's routeThrough draws).
    const hops: Array<{ q: number; r: number; wpIndex: number }> = [];
    {
      let cc: { q: number; r: number } = cur0;
      for (let wi = pathIndex; wi < wps.length; wi++) {
        const seg = hexLine(cc, wps[wi]);
        for (let i = 1; i < seg.length; i++) {
          hops.push({ q: seg[i].q, r: seg[i].r, wpIndex: i === seg.length - 1 ? wi : -1 });
        }
        cc = wps[wi];
      }
    }

    let progress = f.moveProgress ?? 0;
    // VTOLs cruise above the ground clutter at ×2 OMP (core §5.3) and take no road
    // bonus — a flight line is already the shortest predictable path.
    const flies = motionFamily(s, f) === 'VTOL';
    const mult = speedMult(order.kind) * (flies ? MOVEMENT.VTOL_OMP_MULT : 1);

    // Available budget for this step:
    //  CONTACT mode: OMP points (1 contact turn's worth × dt ticks)
    //  PULSE/WATCH:  pulses of marching time
    const contactScale = s.clockMode === 'CONTACT';
    // OMP is hexes/hour; a contact tick is one 6-min turn ⇒ OMP/10 of budget per tick.
    let avail = contactScale
      ? f.omp * mult * dt / CLOCK.TICKS_PER_PULSE
      : dt / CLOCK.TICKS_PER_PULSE;

    let moved = false;
    let forcedPulses = 0;
    let hi = 0;

    while (hi < hops.length && avail > 1e-9) {
      const cur = f.pos as GroundPos;
      const next: GroundPos = { ...cur, q: hops[hi].q, r: hops[hi].r };

      // SHADOW never enters the standoff ring — stop one step short of the contact
      if (isShadow && shadowTarget &&
          hexDistance(next, shadowTarget) < RECON_TRICKS.SHADOW_STANDOFF_HEXES) break;

      const hex = getHex(s, next);
      if (!hex) break;
      // a VTOL overflying a road is not "on the road" — no speed bonus, no
      // predictable-column signature penalty for the detection pass
      const onRoad = !flies && (hex.infra.includes('ROAD') || hex.infra.includes('RAIL'));

      const c = hexEntryCost(s, f, hex);
      if (c === null) break; // impassable: order stalls, GM sees the stuck counter
      let hexCost: number; // in the unit of `avail`
      if (contactScale) {
        hexCost = c;
      } else {
        const rate = f.omp * (onRoad ? MOVEMENT.ROAD_BONUS : 1) * mult; // hexes per pulse
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
        if (hops[hi].wpIndex >= 0) pathIndex = hops[hi].wpIndex + 1; // reached a waypoint
        hi++;
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
      if (acc !== (f.forcedMarchPulseAcc ?? 0)) {
        // through the log so replay reproduces the accumulator exactly
        emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
               patch: { forcedMarchPulseAcc: acc } });
      }
    }

    // STRIKE never self-completes here: arrival is resolved by the engagement pass
    // (battle if the enemy is present, completion-with-miss if the estimate was stale).
    // EMBARK completes at the top of the pass, once co-located and actually loaded.
    // SHADOW is a standing order: the tail follows until superseded.
    if (!isStrike && !isEmbark && !isShadow && pathIndex >= wps.length) {
      emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
    }
  }
}
