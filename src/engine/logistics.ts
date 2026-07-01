/**
 * engine/logistics.ts — RDY recovery, Dig In, supply & rout upkeep (core §3.2, §4.1, §10).
 *
 * Pulse-rate effects (REST recovery, Dig In progress) apply at PULSE/WATCH scale; daily
 * effects (SP draw, out-of-supply attrition) are driven off each formation's
 * `lastSuppliedTick` so they fire correctly regardless of clock-compression step size.
 */
import { CLOCK, COMBAT, RDY, SUPPLY, TERRAIN } from '../rules.js';
import type { Facility, Formation, GroundPos, Id, TruthState } from '../core/types.js';
import { hexKey } from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { neighbors } from '../hex/axial.js';

function asHex(pos: { kind: string }): GroundPos | null {
  return pos.kind === 'ground' ? (pos as GroundPos) : null;
}

function isEngineer(s: TruthState, f: Formation): boolean {
  return f.unitIds.some(id => s.units[id]?.tags.includes('ENGINEER'));
}

/** A stocked friendly supply source (depot/spaceport/factory, or a convoy with SP). */
interface Source { kind: 'facility' | 'convoy'; id: Id; q: number; r: number; sp: number }
function sourcesFor(s: TruthState, sideId: Id, theaterId: Id): Source[] {
  const out: Source[] = [];
  for (const fac of Object.values(s.facilities)) {
    if (fac.sideId !== sideId || fac.pos.kind !== 'ground') continue;
    if ((fac.pos as GroundPos).theaterId !== theaterId) continue;
    const depot = fac.tags.includes('DEPOT') || fac.tags.includes('SPACEPORT') || fac.tags.includes('FACTORY');
    if (depot && fac.supplyPoints > 0) {
      out.push({ kind: 'facility', id: fac.id, q: fac.pos.q, r: fac.pos.r, sp: fac.supplyPoints });
    }
  }
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || f.sideId !== sideId || f.pos.kind !== 'ground') continue;
    if ((f.pos as GroundPos).theaterId !== theaterId) continue;
    if ((f.carriedSp ?? 0) > 0) {
      out.push({ kind: 'convoy', id: f.id, q: f.pos.q, r: f.pos.r, sp: f.carriedSp! });
    }
  }
  return out;
}

/**
 * Path-based supply (core §10.2): a line of friendly-controlled hexes ≤30 cost connects
 * the formation to a stocked source. Roads cost 1, off-road 2 ("½ off-road"); a hex
 * holding a live enemy formation cuts the line (interdiction). Returns the nearest
 * reachable source, or null.
 */
function reachableSource(s: TruthState, f: Formation): Source | null {
  const here = asHex(f.pos);
  if (!here) return null;
  const theater = s.theaters[here.theaterId];
  if (!theater) return null;
  // a convoy can't ration itself from its own delivery cargo
  const sources = sourcesFor(s, f.sideId, here.theaterId).filter(src => src.id !== f.id);
  if (sources.length === 0) return null;
  const srcAt: Record<string, Source> = {};
  for (const src of sources) srcAt[hexKey(src.q, src.r)] = src;

  const enemy = new Set<string>();
  for (const o of Object.values(s.formations)) {
    if (o.destroyed || o.sideId === f.sideId || o.pos.kind !== 'ground') continue;
    if ((o.pos as GroundPos).theaterId !== here.theaterId) continue;
    enemy.add(hexKey(o.pos.q, o.pos.r));
  }

  // Dijkstra outward from the formation; the goal is the nearest source hex
  const cost: Record<string, number> = { [hexKey(here.q, here.r)]: 0 };
  const open = new Set<string>([hexKey(here.q, here.r)]);
  while (open.size) {
    let cur = ''; let best = Infinity;
    for (const k of open) if (cost[k] < best) { best = cost[k]; cur = k; }
    open.delete(cur);
    if (srcAt[cur]) return srcAt[cur];                 // reached a stocked source
    if (best >= SUPPLY.SUPPLY_LINE_MAX_HEXES) continue; // out of line budget
    const [cq, cr] = cur.split(',').map(Number);
    for (const n of neighbors({ q: cq, r: cr })) {
      const nk = hexKey(n.q, n.r);
      const hex = theater.hexes[nk];
      if (!hex || enemy.has(nk)) continue;             // off-map or interdicted
      const row = TERRAIN[hex.terrain];
      if (row.ompCost === null) continue;              // impassable to ground supply
      const step = (hex.infra.includes('ROAD') || hex.infra.includes('RAIL')) ? 1 : 2;
      const nc = best + step;
      if (nc < (cost[nk] ?? Infinity)) { cost[nk] = nc; open.add(nk); }
    }
  }
  return null;
}

/**
 * The supply envelope for a side in a theater: every hex within line budget of a stocked
 * source (roads 1 / off-road 2, routed around live enemy hexes). Same cost model as
 * reachableSource, flooded outward from all sources — for the map overlay.
 */
export function supplyEnvelope(s: TruthState, sideId: Id, theaterId: Id): string[] {
  const theater = s.theaters[theaterId];
  if (!theater) return [];
  const sources = sourcesFor(s, sideId, theaterId);
  if (!sources.length) return [];
  const enemy = new Set<string>();
  for (const o of Object.values(s.formations)) {
    if (o.destroyed || o.sideId === sideId || o.pos.kind !== 'ground') continue;
    if ((o.pos as GroundPos).theaterId !== theaterId) continue;
    enemy.add(hexKey(o.pos.q, o.pos.r));
  }
  const cost: Record<string, number> = {};
  const open = new Set<string>();
  for (const src of sources) { const k = hexKey(src.q, src.r); cost[k] = 0; open.add(k); }
  while (open.size) {
    let cur = ''; let best = Infinity;
    for (const k of open) if (cost[k] < best) { best = cost[k]; cur = k; }
    open.delete(cur);
    if (best >= SUPPLY.SUPPLY_LINE_MAX_HEXES) continue;
    const [cq, cr] = cur.split(',').map(Number);
    for (const n of neighbors({ q: cq, r: cr })) {
      const nk = hexKey(n.q, n.r);
      const hex = theater.hexes[nk];
      if (!hex || enemy.has(nk)) continue;
      if (TERRAIN[hex.terrain].ompCost === null) continue;
      const step = (hex.infra.includes('ROAD') || hex.infra.includes('RAIL')) ? 1 : 2;
      const nc = best + step;
      if (nc < (cost[nk] ?? Infinity)) { cost[nk] = nc; open.add(nk); }
    }
  }
  return Object.keys(cost);
}

export function maintenancePass(s: TruthState, dt: number, emit: (e: GameEvent) => void): void {
  const pulses = dt / CLOCK.TICKS_PER_PULSE;

  for (const f of Object.values(s.formations)) {
    if (f.destroyed) continue;

    // rout expiry (core §3.2/§7.4): uncommandable window closes
    if (f.routUntilTick != null && s.tick >= f.routUntilTick) {
      emit({ type: 'ROUT_STARTED', formationId: f.id, untilTick: 0, tick: s.tick }); // clear
    }

    const order = f.currentOrderId ? s.orders[f.currentOrderId] : undefined;

    // Dig In → DUG_IN after N pulses (engineers halve), then the order completes (core §4.1)
    if (order && !order.completed && order.kind === 'DIG_IN' && f.posture !== 'DUG_IN') {
      const need = COMBAT.DIG_IN_PULSES * (isEngineer(s, f) ? COMBAT.ENGINEER_DIG_IN_FACTOR : 1);
      const acc = (f.digInPulseAcc ?? 0) + pulses;
      if (acc >= need - 1e-9) {
        emit({ type: 'POSTURE_CHANGED', formationId: f.id, posture: 'DUG_IN', tick: s.tick });
        emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
      }
      // through the log so replay reproduces the accumulator exactly
      emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id, patch: { digInPulseAcc: acc } });
    }

    // REST recovery (core §3.2): +2 RDY/pulse in supply, +1 without
    if (order && !order.completed && order.kind === 'REST' && pulses >= 1 && f.rdy < RDY.START) {
      const rate = f.supply.inSupply ? RDY.REST_RECOVERY_PER_PULSE : RDY.REST_RECOVERY_UNSUPPLIED;
      emit({ type: 'RDY_CHANGED', formationId: f.id,
             delta: Math.round(rate * pulses), reason: 'rest' });
    }

    // RESUPPLY: a convoy co-located with a friendly depot pours its SP into the farm
    // (the convoy pipeline — core §10.1). Runs immediately, not on a daily anchor.
    if (order && !order.completed && order.kind === 'RESUPPLY' && (f.carriedSp ?? 0) > 0
        && f.pos.kind === 'ground') {
      const here = f.pos as GroundPos;
      const depot = Object.values(s.facilities).find(fac => fac.sideId === f.sideId &&
        fac.pos.kind === 'ground' && (fac.pos as GroundPos).theaterId === here.theaterId &&
        fac.pos.q === here.q && fac.pos.r === here.r &&
        (fac.tags.includes('DEPOT') || fac.tags.includes('SPACEPORT') || fac.tags.includes('FACTORY')));
      if (depot) {
        emit({ type: 'SP_CHANGED', facilityId: depot.id, delta: f.carriedSp!, reason: `convoy ${f.name} delivery` });
        emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id, patch: { carriedSp: 0 } });
        emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
      }
    }

    // daily supply tick — anchored on lastSuppliedTick so step size doesn't matter
    const sinceSupply = s.tick - f.supply.lastSuppliedTick;
    if (sinceSupply >= CLOCK.TICKS_PER_DAY) {
      // embarked in a carrier's bay: sustained by the ship's stores — no ground line
      // needed, no SP draw, and no starvation while riding through transit
      if (f.mounted) {
        emit({ type: 'SUPPLY_CHANGED', formationId: f.id, inSupply: true,
               lastSuppliedTick: f.supply.lastSuppliedTick + CLOCK.TICKS_PER_DAY });
        continue;
      }
      const src = reachableSource(s, f);
      // a fighting/forced-marching day costs double (core §10.1)
      const fought = f.lastBattleTick !== undefined && s.tick - f.lastBattleTick < CLOCK.TICKS_PER_DAY;
      const demand = SUPPLY.SP_PER_FORMATION_PER_DAY * (fought ? SUPPLY.COMBAT_OR_FORCED_MARCH_MULT : 1);
      const supplied = !!src && src.sp >= demand;
      if (supplied) {
        if (src!.kind === 'facility') {
          emit({ type: 'SP_CHANGED', facilityId: src!.id, delta: -demand, reason: `supplies ${f.name}` });
        } else {
          emit({ type: 'FORMATION_BOOKKEEPING', formationId: src!.id,
                 patch: { carriedSp: src!.sp - demand } });
        }
      }
      emit({ type: 'SUPPLY_CHANGED', formationId: f.id, inSupply: supplied,
             lastSuppliedTick: f.supply.lastSuppliedTick + CLOCK.TICKS_PER_DAY });
      if (!supplied) {
        emit({ type: 'RDY_CHANGED', formationId: f.id,
               delta: RDY.PER_DAY_UNSUPPLIED, reason: 'out of supply' });
      }
    }
  }
}
