/**
 * engine/air.ts — SKYWATCH: the flight ledger engine, alert board, chase mode,
 * joker/bingo live calculation, and air detection (Module 1 §§1–6, §11).
 *
 * One iron law: fuel is the gameplay. Every airborne step pays the ledger; thresholds
 * (JOKER warning, BINGO auto-RTB) are recomputed continuously from live position.
 * Air combat is never simulated — interception produces an AIR engagement that freezes
 * the campaign for the tabletop merge (export in handoff/export.ts).
 */
import { CLOCK, LADDER, SKYWATCH } from '../rules.js';
import type {
  AirPos, Formation, GroundPos, Id, Order, TruthState,
} from '../core/types.js';
import { hexKey } from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { hexDistance, hexLine, headingDeg } from '../hex/axial.js';
import { isNight } from './clock.js';
import { registerDetection } from './detection.js';
import { rollDice } from '../core/rng.js';

export const AIR_MISSIONS = new Set([
  'CAP', 'ORBITAL_STANDBY', 'STRIKE_AIR', 'CAS', 'SWEEP', 'ESCORT', 'RECON',
  'INTERDICTION', 'FERRY', 'TANKER', 'SAR',
]);

// ── Geometry & ledger helpers (pure; unit-tested against the §2 worked baseline) ──

export const airQR = (p: AirPos) => ({ q: p.gridQ, r: p.gridR });

export function theaterAirHex(s: TruthState, theaterId: Id): { q: number; r: number } {
  return s.config.airHexByTheater?.[theaterId] ?? { q: 0, r: 0 };
}

export function isConvFlight(s: TruthState, f: Formation): boolean {
  return f.unitIds.length > 0 &&
    f.unitIds.every(uid => s.units[uid]?.class === 'CONV_FIGHTER');
}

export function isFlight(s: TruthState, f: Formation): boolean {
  return !!f.air || f.unitIds.some(uid =>
    ['ASF', 'CONV_FIGHTER'].includes(s.units[uid]?.class ?? ''));
}

export function minSafeThrust(s: TruthState, f: Formation): number {
  const sts = f.unitIds.map(uid => s.units[uid]?.safeThrust ?? 4);
  return Math.max(1, Math.min(...sts));
}

/** Conventional fighters halve transit/loiter; takeoff/climb/landing full (D-010.4). */
function convFactor(s: TruthState, f: Formation): number {
  return isConvFlight(s, f) ? SKYWATCH.CONV_FIGHTER_COST_FACTOR : 1;
}

export function cruiseHexesPerTick(): number {
  return SKYWATCH.CRUISE_HEX_PER_MIN * CLOCK.TICK_MINUTES; // 12
}
export function dashHexesPerTick(s: TruthState, f: Formation): number {
  return minSafeThrust(s, f) * CLOCK.TICK_MINUTES;
}
export function transitFpPerHex(s: TruthState, f: Formation, speed: 'CRUISE' | 'DASH'): number {
  const base = speed === 'DASH' ? SKYWATCH.DASH_FP_PER_HEX : SKYWATCH.CRUISE_FP_PER_HEX;
  return base * convFactor(s, f);
}
export function loiterFpPerTick(s: TruthState, f: Formation, lean: boolean): number {
  const perMin = lean ? SKYWATCH.LEAN_LOITER_FP_PER_MIN : SKYWATCH.LOITER_FP_PER_MIN;
  return perMin * CLOCK.TICK_MINUTES * convFactor(s, f);
}
export function climbFp(levels: number): number {
  return SKYWATCH.CLIMB_FP_PER_LEVEL * Math.max(0, levels);
}

function baseHasRunway(s: TruthState, f: Formation): boolean {
  if (f.pos.kind !== 'ground') return false;
  const here = f.pos;
  return Object.values(s.facilities).some(fac =>
    fac.sideId === f.sideId && fac.pos.kind === 'ground' &&
    fac.pos.theaterId === here.theaterId && fac.pos.q === here.q && fac.pos.r === here.r &&
    (fac.tags.includes('AIRSTRIP') || fac.tags.includes('SPACEPORT')));
}

export function takeoffFp(runway: boolean): number {
  return runway ? SKYWATCH.TAKEOFF_RUNWAY_FP : SKYWATCH.TAKEOFF_VSTOL_FP;
}
export function landingFp(runway: boolean): number {
  return runway ? SKYWATCH.LANDING_RUNWAY_FP : SKYWATCH.LANDING_VSTOL_FP;
}

function homeFacility(s: TruthState, f: Formation) {
  const id = f.air?.homeFacilityId;
  return id ? s.facilities[id] : undefined;
}

function homeAirHexOf(s: TruthState, f: Formation): { q: number; r: number } | null {
  // Carrier ops (SKYWATCH): a DropShip carrier is a mobile home — RTB tracks it as it
  // moves. Airborne carrier → its air grid hex; on the ground → the air hex over its
  // theater (one high-altitude hex covers a theater map).
  const carrierId = f.air?.homeCarrierId;
  const carrier = carrierId ? s.formations[carrierId] : undefined;
  if (carrier && !carrier.destroyed) {
    if (carrier.pos.kind === 'air') return airQR(carrier.pos);
    if (carrier.pos.kind === 'ground') return theaterAirHex(s, carrier.pos.theaterId);
  }
  const fac = homeFacility(s, f);
  if (!fac || fac.pos.kind !== 'ground') return null;
  return theaterAirHex(s, fac.pos.theaterId);
}

/** RTB transit distance in air hexes from the flight's current air position to home. */
export function rtbDistance(s: TruthState, f: Formation): number {
  if (f.pos.kind !== 'air') return 0;
  const home = homeAirHexOf(s, f);
  return home ? hexDistance(airQR(f.pos), home) : 0;
}

/**
 * JOKER = RTB-at-dash transit cost × 1.25 (a warning); BINGO = RTB-at-cruise × 1.10
 * (must disengage). Transit-only — §12: 36 hexes home ⇒ JOKER 90 (D-010.5).
 */
export function jokerBingo(s: TruthState, f: Formation, distanceHexes?: number) {
  const d = distanceHexes ?? rtbDistance(s, f);
  return {
    joker: d * transitFpPerHex(s, f, 'DASH') * SKYWATCH.JOKER_MULT,
    bingo: d * transitFpPerHex(s, f, 'CRUISE') * SKYWATCH.BINGO_MULT,
  };
}

export function minFp(s: TruthState, f: Formation): number {
  const fps = f.unitIds.map(uid => s.units[uid]?.fuel?.fp ?? 0);
  return fps.length ? Math.min(...fps) : 0;
}

// ── The air pass ─────────────────────────────────────────────────────────────

function activeAirOrder(s: TruthState, f: Formation): Order | undefined {
  const o = f.currentOrderId ? s.orders[f.currentOrderId] : undefined;
  return o && !o.completed && AIR_MISSIONS.has(o.kind) ? o : undefined;
}

/**
 * Alert-board upkeep: fatigue accrual, ALERT-5 idle burn, stand-down recovery
 * (§3.1/§11). Accrues against the step's full horizon (tick + dt) so coarse
 * WATCH/PULSE steps charge exactly the time they consume.
 */
function alertUpkeep(s: TruthState, f: Formation, dt: number, emit: (e: GameEvent) => void): void {
  if (f.pos.kind !== 'ground' || !f.alertState) return;
  const profile = SKYWATCH.ALERT[f.alertState];
  if (!profile) return;
  let anchor = f.air?.alertAnchorTick ?? s.tick;
  const horizon = s.tick + dt;
  const stride = f.alertState === 'STAND_DOWN'
    ? (CLOCK.TICKS_PER_DAY / SKYWATCH.STAND_DOWN_DAY_CLEARS)   // −1 per 60 ticks
    : CLOCK.TICKS_PER_PULSE;
  let changed = false;
  while (horizon - anchor >= stride) {
    anchor += stride;
    changed = true;
    if (f.alertState === 'STAND_DOWN') {
      for (const uid of f.unitIds) {
        for (const pid of s.units[uid]?.pilotIds ?? []) {
          if ((s.pilots[pid]?.fatigue ?? 0) > 0) {
            emit({ type: 'PILOT_FATIGUE', pilotId: pid, delta: -1 });
          }
        }
      }
    } else {
      if (profile.fatiguePerPulse > 0) {
        for (const uid of f.unitIds) {
          for (const pid of s.units[uid]?.pilotIds ?? []) {
            emit({ type: 'PILOT_FATIGUE', pilotId: pid, delta: profile.fatiguePerPulse });
          }
        }
      }
      if (profile.idleFpPerPulse > 0) {
        emit({ type: 'FUEL_SPENT', formationId: f.id, fpPaid: profile.idleFpPerPulse,
               reason: `${f.alertState} idle burn`, tick: s.tick });
      }
    }
  }
  if (changed || f.air?.alertAnchorTick === undefined) {
    emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
           patch: { air: { alertAnchorTick: anchor } } });
  }
}

function tryLaunch(s: TruthState, f: Formation, order: Order, emit: (e: GameEvent) => void): void {
  // turnaround crews still working?
  if (f.air?.turnaroundReadyTick != null && s.tick < f.air.turnaroundReadyTick) return;
  // grounded crews stay grounded (§11)
  const fatigues = f.unitIds.flatMap(uid =>
    (s.units[uid]?.pilotIds ?? []).map(pid => s.pilots[pid]?.fatigue ?? 0));
  if (fatigues.some(ft => ft >= SKYWATCH.FATIGUE_GROUNDED_AT)) return;
  // you cannot plot an interception against less than SHADOW (§5)
  if (order.targetContactId) {
    const c = s.contacts[order.targetContactId];
    if ((c?.delivered?.level ?? 0) < SKYWATCH.MIN_PLOT_INTERCEPT_LEVEL) return;
  }

  let launchAt = f.air?.launchAtTick;
  if (launchAt == null) {
    const delay = SKYWATCH.ALERT[f.alertState ?? 'STAND_DOWN']?.launchDelayTicks ?? 20;
    launchAt = order.issuedTick + delay;
    emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
           patch: { air: { launchAtTick: launchAt } } });
  }
  if (s.tick < launchAt) return;

  const runway = baseHasRunway(s, f);
  const climbLevels = SKYWATCH.CRUISE_ALT_LEVEL; // ground → HIGH band
  const fpPaid = takeoffFp(runway) + climbFp(climbLevels);
  const here = f.pos as GroundPos;
  const hex = theaterAirHex(s, here.theaterId);
  const pos: AirPos = {
    kind: 'air', gridQ: hex.q, gridR: hex.r, band: 'HIGH',
    altLevel: SKYWATCH.CRUISE_ALT_LEVEL,
    velocity: (order.airSpeed ?? 'CRUISE') === 'DASH'
      ? minSafeThrust(s, f) : SKYWATCH.ENTRY_VELOCITY_CRUISE,
    vectorDeg: 0,
  };
  emit({ type: 'AIR_LAUNCHED', formationId: f.id, pos, fpPaid, tick: s.tick });
  emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
         patch: { air: { speed: order.airSpeed ?? 'CRUISE', lean: order.lean ?? false,
                         jokerWarned: false, bingoCalled: false,
                         loiterTicksRemaining: order.loiterTicks } } });
  for (const uid of f.unitIds) {
    for (const pid of s.units[uid]?.pilotIds ?? []) {
      emit({ type: 'PILOT_FATIGUE', pilotId: pid, delta: SKYWATCH.FATIGUE_PER_SORTIE });
    }
  }
}

// the six axial directions by heading (pointy-top: 0°=+q, 60°=+r, …)
const DIR_BY_SIXTH: Array<{ q: number; r: number }> = [
  { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
  { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
];

/**
 * Where will an airborne target be at the end of this contact turn? The chase computes
 * its intercept "ahead of the bandit's plot" (§6/§12) from the tracked vector & speed.
 */
function predictAirPos(s: TruthState, target: Formation, dt: number): { q: number; r: number } | null {
  if (target.pos.kind !== 'air') return null;
  const cur = airQR(target.pos);
  if (target.air?.phase === 'ON_STATION' || target.air?.phase === 'GROUNDED') return cur;
  // resolve the target's speed exactly the way its own movement will (order profile wins)
  const targetOrder = activeAirOrder(s, target);
  if (target.air?.phase === 'RTB' || (!targetOrder && target.air?.phase === 'ENROUTE')) {
    // heading home: predict along its return leg, stopping at the base (or parked if none)
    const home = homeAirHexOf(s, target);
    if (!home) return cur;
    const step = Math.min(cruiseHexesPerTick() * dt, hexDistance(cur, home));
    const line = hexLine(cur, home);
    return line[Math.min(step, line.length - 1)];
  }
  const mode: 'CRUISE' | 'DASH' = targetOrder?.airSpeed ?? target.air?.speed ?? 'CRUISE';
  const speed = (mode === 'DASH' ? dashHexesPerTick(s, target) : cruiseHexesPerTick()) * dt;
  const dir = DIR_BY_SIXTH[Math.round(((target.pos.vectorDeg % 360) + 360) % 360 / 60) % 6];
  return { q: cur.q + dir.q * speed, r: cur.r + dir.r * speed };
}

function destAirHex(s: TruthState, f: Formation, order: Order | undefined, dt: number):
    { q: number; r: number } | null {
  if (!order || f.air?.phase === 'RTB') return homeAirHexOf(s, f);
  if (order.targetContactId) {
    const c = s.contacts[order.targetContactId];
    if (!c) return null; // contact gone: caller completes the order
    // live track (≥ SHADOW): pursue the predicted intercept point; otherwise fly to
    // the stale estimate and hope the trail is warm
    if (c.level >= SKYWATCH.MIN_PLOT_INTERCEPT_LEVEL) {
      const target = s.formations[c.targetFormationId];
      const predicted = target && !target.destroyed ? predictAirPos(s, target, dt) : null;
      if (predicted) return predicted;
    }
    const est = c.delivered?.estPos ?? c.estPos;
    if (est?.kind === 'air') return { q: est.gridQ, r: est.gridR };
    if (est?.kind === 'ground') return theaterAirHex(s, est.theaterId);
    return null;
  }
  // the station leg is consumed once its loiter clock has run out (=== 0); the
  // egress path (if any) takes over from there
  const stationDone = f.air?.loiterTicksRemaining === 0;
  if (order.station?.kind === 'air' && !stationDone) {
    return { q: order.station.gridQ, r: order.station.gridR };
  }
  const wp = (order.path ?? []).filter((p): p is AirPos => p.kind === 'air');
  const idx = f.pathIndex ?? 0;
  if (idx < wp.length) return { q: wp[idx].gridQ, r: wp[idx].gridR };
  return null;
}

function flyStep(
  s: TruthState, f: Formation, order: Order | undefined, dt: number,
  emit: (e: GameEvent) => void,
): void {
  if (f.pos.kind !== 'air') return;
  const speed: 'CRUISE' | 'DASH' = f.air?.phase === 'RTB'
    ? 'CRUISE' : (order?.airSpeed ?? f.air?.speed ?? 'CRUISE');
  if (f.air?.speed !== speed) {
    // keep the flown profile on the formation: SIG (dash burn), energy at the merge,
    // and pursuit prediction all read it
    emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id, patch: { air: { speed } } });
  }

  // on station: pay loiter, count down, then egress or RTB (§2, §4)
  if (f.air?.phase === 'ON_STATION' && order) {
    const remaining = f.air.loiterTicksRemaining ?? -1;
    const loiterTicks = remaining < 0 ? dt : Math.min(dt, remaining);
    if (loiterTicks > 0) {
      emit({ type: 'FUEL_SPENT', formationId: f.id,
             fpPaid: loiterFpPerTick(s, f, !!f.air.lean) * loiterTicks,
             reason: 'loiter', tick: s.tick });
    }
    if (remaining >= 0) {
      const left = remaining - loiterTicks;
      emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
             patch: { air: { loiterTicksRemaining: left } } });
      if (left <= 0) {
        const hasEgress = (order.path ?? []).some(p => p.kind === 'air');
        if (hasEgress) {
          emit({ type: 'AIR_PHASE', formationId: f.id, phase: 'ENROUTE', tick: s.tick });
        } else {
          emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
          emit({ type: 'AIR_PHASE', formationId: f.id, phase: 'RTB', tick: s.tick });
        }
      }
    }
    return;
  }

  const dest = destAirHex(s, f, order, dt);
  if (dest === null) {
    if (order) {
      // chase target evaporated, or no plottable destination: mission over, go home
      emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
    }
    if (f.air?.phase !== 'RTB') {
      emit({ type: 'AIR_PHASE', formationId: f.id, phase: 'RTB', tick: s.tick });
    }
    return;
  }

  const cur = airQR(f.pos);
  let budget = (speed === 'DASH' ? dashHexesPerTick(s, f) : cruiseHexesPerTick()) * dt;
  const dist = hexDistance(cur, dest);
  const hexesFlown = Math.min(budget, dist);

  if (hexesFlown > 0) {
    const line = hexLine(cur, dest);
    const newQR = line[Math.min(hexesFlown, line.length - 1)];
    const pos: AirPos = { ...f.pos, gridQ: newQR.q, gridR: newQR.r,
                          velocity: speed === 'DASH' ? minSafeThrust(s, f) : SKYWATCH.ENTRY_VELOCITY_CRUISE,
                          vectorDeg: Math.round(headingDeg(cur, dest)) };
    emit({ type: 'AIR_MOVED', formationId: f.id, pos,
           fpPaid: hexesFlown * transitFpPerHex(s, f, speed), speed, tick: s.tick });
  }

  if (hexesFlown >= dist) {
    // arrived
    if (f.air?.phase === 'RTB' || !order) {
      // descend (free in atmosphere) and land at the home facility
      const fac = homeFacility(s, f);
      if (fac && fac.pos.kind === 'ground') {
        const runway = fac.tags.includes('AIRSTRIP') || fac.tags.includes('SPACEPORT');
        emit({ type: 'AIR_LANDED', formationId: f.id, facilityId: fac.id,
               pos: { ...fac.pos }, fpPaid: landingFp(runway), tick: s.tick });
      }
      return;
    }
    if (order.targetContactId) {
      // chase: interception is the engagement pass's call — but a cold trail
      // (track faded below SHADOW, nobody here) means the bandit shook us (§6)
      const c = s.contacts[order.targetContactId];
      const target = c ? s.formations[c.targetFormationId] : undefined;
      const here = airQR(f.pos as AirPos);
      const targetHere = target?.pos.kind === 'air' &&
        hexDistance(airQR(target.pos), here) === 0;
      if (!targetHere && (c?.level ?? 0) < SKYWATCH.MIN_PLOT_INTERCEPT_LEVEL) {
        emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
        emit({ type: 'AIR_PHASE', formationId: f.id, phase: 'RTB', tick: s.tick });
      }
      return;
    }
    if (order.station?.kind === 'air' && f.air?.loiterTicksRemaining !== 0) {
      emit({ type: 'AIR_PHASE', formationId: f.id, phase: 'ON_STATION', tick: s.tick });
      emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
             patch: { air: { loiterTicksRemaining: order.loiterTicks ?? -1 } } });
      return;
    }
    // waypoint route: advance the index; route exhausted ⇒ mission complete, RTB
    const wp = (order.path ?? []).filter(p => p.kind === 'air');
    const idx = (f.pathIndex ?? 0) + 1;
    emit({ type: 'MOVE_PROGRESS', formationId: f.id, moveProgress: 0, pathIndex: idx });
    if (idx >= wp.length) {
      emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
      emit({ type: 'AIR_PHASE', formationId: f.id, phase: 'RTB', tick: s.tick });
    }
  }
}

/** JOKER warning / BINGO auto-RTB, recomputed continuously from live position (§7.4). */
function thresholds(s: TruthState, f: Formation, emit: (e: GameEvent) => void): void {
  if (f.pos.kind !== 'air') return;
  const { joker, bingo } = jokerBingo(s, f);
  const fp = minFp(s, f);
  if (!f.air?.jokerWarned && fp <= joker) {
    emit({ type: 'FUEL_THRESHOLD', formationId: f.id, threshold: 'JOKER', fpMin: fp, tick: s.tick });
  }
  if (!f.air?.bingoCalled && fp <= bingo) {
    emit({ type: 'FUEL_THRESHOLD', formationId: f.id, threshold: 'BINGO', fpMin: fp, tick: s.tick });
    const order = activeAirOrder(s, f);
    if (order) emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
    if (f.air?.phase !== 'RTB') emit({ type: 'AIR_PHASE', formationId: f.id, phase: 'RTB', tick: s.tick });
  }
}

export function airPass(s: TruthState, dt: number, emit: (e: GameEvent) => void): void {
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || !isFlight(s, f)) continue;
    if (f.mounted) continue; // stowed in a carrier bay: no ledger, no flight (carrierPass)
    alertUpkeep(s, f, dt, emit);
    const order = activeAirOrder(s, f);
    if (f.pos.kind === 'ground') {
      if (order) tryLaunch(s, f, order, emit);
    } else if (f.pos.kind === 'air') {
      flyStep(s, f, order, dt, emit);
      thresholds(s, f, emit);
    }
  }
}

// ── Seeing the sky (§5) ──────────────────────────────────────────────────────

export interface AirTnBreakdown {
  base: number; mods: Array<{ label: string; value: number }>; tn: number;
}

export function computeAirSig(s: TruthState, target: Formation, night: boolean,
                              activeSearcher: boolean): AirTnBreakdown {
  const mods: Array<{ label: string; value: number }> = [];
  const add = (label: string, value: number) => { if (value !== 0) mods.push({ label, value }); };
  const alive = target.unitIds.filter(uid => s.units[uid]?.damage !== 'DESTROYED');
  const thrustingDropship = alive.some(uid => s.units[uid]?.class === 'DROPSHIP');

  let base: number;
  if (thrustingDropship) base = SKYWATCH.AIR_SIG.DROPSHIP_THRUST;       // a torch in the sky
  else if (alive.length >= 3) base = SKYWATCH.AIR_SIG.FLIGHT_3_6;
  else if (alive.length === 2) base = SKYWATCH.AIR_SIG.PAIR;
  else base = SKYWATCH.AIR_SIG.SINGLE;

  const climbing = target.air?.lastLaunchTick === s.tick; // launch climb: bright burn
  const dashing = target.air?.speed === 'DASH' &&
    (target.air?.phase === 'ENROUTE' || target.air?.phase === 'RTB');
  if (climbing || dashing) {
    add(climbing ? 'climb burn' : 'dash burn', SKYWATCH.AIR_SIG_MODS.DASH_OR_CLIMB);
  }
  if (target.air?.phase === 'ON_STATION' && target.air.lean) {
    add('lean loiter', SKYWATCH.AIR_SIG_MODS.LEAN_LOITER);
  }
  if (night && !activeSearcher) add('night', 2); // D-006 applies to the sky too (D-010.8)

  const tn = base + mods.reduce((a, m) => a + m.value, 0);
  return { base, mods, tn };
}

/**
 * Air detection pass: radar-horizon searches from the ground (§5) plus air-to-air
 * resolution in own + adjacent air hex (D-010.6). Reuses the core ladder machinery.
 */
export function airDetectionPass(s: TruthState, emit: (e: GameEvent) => void): void {
  const night = isNight(s, s.tick);
  // stowed-in-a-bay flights (mounted) are inside the carrier's return, not their own
  const airborne = Object.values(s.formations).filter(
    f => !f.destroyed && f.pos.kind === 'air' && !f.mounted);
  if (airborne.length === 0) return;

  interface AirSearcher { id: Id; sideId: Id; name: string; airHex: { q: number; r: number };
                          range: number; active: boolean; alwaysOnNet: boolean }
  const searchers: AirSearcher[] = [];

  // ground-based radar horizon: searchers project to their theater's air hex
  for (const fac of Object.values(s.facilities)) {
    if (fac.pos.kind !== 'ground' || !fac.sensorStation) continue;
    searchers.push({ id: fac.id, sideId: fac.sideId, name: fac.name,
      airHex: theaterAirHex(s, fac.pos.theaterId),
      range: SKYWATCH.RADAR_HORIZON.HIGH_BAND_AIR_HEXES +
             SKYWATCH.RADAR_HORIZON.STATION_HQ_BONUS_AIR_HEXES,
      active: !!fac.activeSweep, alwaysOnNet: true });
  }
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || f.pos.kind !== 'ground' || f.mounted) continue;
    const isHq = f.unitIds.some(uid => s.units[uid]?.tags.includes('HQ'));
    searchers.push({ id: f.id, sideId: f.sideId, name: f.name,
      airHex: theaterAirHex(s, f.pos.theaterId),
      range: SKYWATCH.RADAR_HORIZON.HIGH_BAND_AIR_HEXES +
             (isHq ? SKYWATCH.RADAR_HORIZON.STATION_HQ_BONUS_AIR_HEXES : 0),
      active: f.emcon === 'ACTIVE', alwaysOnNet: false });
  }
  // air-to-air: own + adjacent air hex
  for (const f of airborne) {
    searchers.push({ id: f.id, sideId: f.sideId, name: f.name,
      airHex: airQR(f.pos as AirPos), range: SKYWATCH.AIR_TO_AIR_DETECT_AIR_HEXES,
      active: f.emcon === 'ACTIVE', alwaysOnNet: false });
  }

  for (const target of airborne) {
    const tPos = target.pos as AirPos;
    // DECK is terrain-masked from the general radar picture (§5) — GM territory in M3
    if (tPos.band === 'DECK') continue;
    for (const searcher of searchers) {
      if (searcher.sideId === target.sideId) continue;
      if (hexDistance(searcher.airHex, airQR(tPos)) > searcher.range) continue;

      const { tn } = computeAirSig(s, target, night, searcher.active);
      const mod = searcher.active ? 2 : 0;
      const r = rollDice(s.seed, s.seedCursor, '2d6');
      emit({ type: 'DIE_ROLLED', roll: {
        id: `roll:${s.seedCursor}`, tick: s.tick,
        purpose: `air detection ${searcher.name} → ${target.name} (TN ${tn}${mod ? `, +${mod}` : ''})`,
        dice: '2d6', result: r.result, seedCursor: r.nextCursor - 2 } });
      if (r.result + mod >= tn) {
        registerDetection(s, emit, searcher.sideId, target, LADDER.CLIMB_PER_SUCCESS,
          { id: searcher.id, name: searcher.name, alwaysOnNet: searcher.alwaysOnNet });
      }
    }
  }
}

/**
 * Is a grounded flight about to launch? (Used by the clock: scrambles run in contact
 * turns, SKYWATCH §6.) True when a due air order exists and no gate blocks the launch.
 */
export function isLaunchPending(s: TruthState, f: Formation): boolean {
  if (f.destroyed || f.pos.kind !== 'ground' || !isFlight(s, f)) return false;
  if (f.air?.launchAtTick != null) return true;
  const due = Object.values(s.orders).find(o =>
    !o.completed && o.formationId === f.id && AIR_MISSIONS.has(o.kind) &&
    o.effectiveTick <= s.tick + 1);
  if (!due) return false;
  if (f.air?.turnaroundReadyTick != null && s.tick < f.air.turnaroundReadyTick) return false;
  const fatigues = f.unitIds.flatMap(uid =>
    (s.units[uid]?.pilotIds ?? []).map(pid => s.pilots[pid]?.fatigue ?? 0));
  if (fatigues.some(ft => ft >= SKYWATCH.FATIGUE_GROUNDED_AT)) return false;
  if (due.targetContactId) {
    const c = s.contacts[due.targetContactId];
    if ((c?.delivered?.level ?? 0) < SKYWATCH.MIN_PLOT_INTERCEPT_LEVEL) return false;
  }
  return true;
}

/**
 * Air interception (§6): the pursuer ends a contact turn in the target's air hex while
 * holding ≥ SHADOW, with intercept intent (a chase order on it, or a committed CAP/SWEEP).
 */
export function airEngagementCandidates(s: TruthState):
    Array<{ pursuer: Formation; target: Formation; pos: AirPos }> {
  if (s.pendingEngagementId) return [];
  const out: Array<{ pursuer: Formation; target: Formation; pos: AirPos }> = [];
  const airborne = Object.values(s.formations).filter(
    f => !f.destroyed && f.pos.kind === 'air' && !f.mounted); // bays are not merges

  for (const pursuer of airborne) {
    const order = activeAirOrder(s, pursuer);
    if (!order) continue;
    for (const target of airborne) {
      if (target.sideId === pursuer.sideId) continue;
      if (hexDistance(airQR(pursuer.pos as AirPos), airQR(target.pos as AirPos)) !== 0) continue;
      const ladder = s.contacts[`contact:${pursuer.sideId}:${target.id}`]?.level ?? 0;
      if (ladder < SKYWATCH.MIN_PLOT_INTERCEPT_LEVEL) continue;
      const intends =
        order.targetContactId === `contact:${pursuer.sideId}:${target.id}` ||
        ['CAP', 'SWEEP'].includes(order.kind);
      if (!intends) continue;
      out.push({ pursuer, target, pos: pursuer.pos as AirPos });
    }
  }
  out.sort((a, b) => (a.pursuer.id + a.target.id).localeCompare(b.pursuer.id + b.target.id));
  return out;
}
