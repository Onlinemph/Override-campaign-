/**
 * engine/air.ts — SKYWATCH: the flight ledger engine, alert board, chase mode,
 * joker/bingo live calculation, and air detection (Module 1 §§1–6, §11).
 *
 * One iron law: fuel is the gameplay. Every airborne step pays the ledger; thresholds
 * (JOKER warning, BINGO auto-RTB) are recomputed continuously from live position.
 * Air combat is never simulated — interception produces an AIR engagement that freezes
 * the campaign for the tabletop merge (export in handoff/export.ts).
 */
import { ATMO, CLOCK, LADDER, SENSOR_RANGES, SKYWATCH, TERRAIN } from '../rules.js';
import type {
  AirPos, Formation, GroundPos, Id, Order, TruthState,
} from '../core/types.js';
import { hexKey } from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { distanceToPath, hexDistance, hexLine, headingDeg } from '../hex/axial.js';
import { isNight } from './clock.js';
import { computeDetectionTN, registerDetection } from './detection.js';
import { spotFacility } from './net.js';
import { capitalGauntlet, flakGauntlet } from './flak.js';
import { hashPick, rollDice } from '../core/rng.js';

export const AIR_MISSIONS = new Set([
  'CAP', 'ORBITAL_STANDBY', 'STRIKE_AIR', 'CAS', 'SWEEP', 'ESCORT', 'RECON',
  'INTERDICTION', 'FERRY', 'TANKER', 'SAR',
  'LIFT_OFF', 'LAND', // ext: player carrier ops — lift & hold / put down on a hex
  'ASCEND',           // ext: climb the well to the planet's orbit node
]);

// ── Geometry & ledger helpers (pure; unit-tested against the §2 worked baseline) ──

export const airQR = (p: AirPos) => ({ q: p.gridQ, r: p.gridR });

/**
 * The congruent sky (D-037): every ground hex has an air hex directly above it.
 * `airHexByTheater` is the theater's ORIGIN on the global air grid — its air region
 * spans the whole map 1:1 from there. Position in the sky is real: a CAP covers a
 * radius, a raid crosses radar pickets on the way in, and RTB distance is geography.
 */
export function airHexOver(
  s: TruthState, pos: { theaterId: Id; q: number; r: number },
): { q: number; r: number } {
  const o = s.config.airHexByTheater?.[pos.theaterId] ?? { q: 0, r: 0 };
  return { q: o.q + pos.q, r: o.r + pos.r };
}

/** The ground hex under an air hex, if any theater's region contains it. */
export function groundHexUnder(
  s: TruthState, air: { q: number; r: number },
): GroundPos | null {
  for (const tid of Object.keys(s.theaters).sort()) {
    const o = s.config.airHexByTheater?.[tid] ?? { q: 0, r: 0 };
    const q = air.q - o.q, r = air.r - o.r;
    if (s.theaters[tid].hexes[hexKey(q, r)]) return { kind: 'ground', theaterId: tid, q, r };
  }
  return null;
}

/** A representative hex over a theater (its region origin) — prefer airHexOver. */
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

/**
 * Speeds come off the card, per contact turn (D-038, user ruling): dash = Safe Thrust
 * air hexes per 6-minute turn, cruise = half that — a Cheetah outruns a Shilone even
 * loafing, and crossing a continent is an operation, not an afterthought. Fuel is
 * charged per hex, so range in hexes is untouched; endurance in time grows.
 */
export function cruiseHexesPerTick(s: TruthState, f: Formation): number {
  return Math.max(1, Math.floor(minSafeThrust(s, f) / 2));
}
export function dashHexesPerTick(s: TruthState, f: Formation): number {
  return minSafeThrust(s, f);
}

/** A spheroid hull in the formation: the whole flight stands on its drive plume. */
export function isSpheroid(s: TruthState, f: Formation): boolean {
  return f.unitIds.some(uid => s.units[uid]?.tags.includes('SPHEROID'));
}

/**
 * Atmospheric speed in air hexes per tick — the ONE place hull shape matters (ext):
 * a spheroid crawls at SPHEROID_ATMO_HEX_PER_TICK regardless of thrust; everything
 * else flies cruise/dash as before. The fast lane for a spheroid is the orbital hop.
 */
export function atmoHexesPerTick(s: TruthState, f: Formation, speed: 'CRUISE' | 'DASH'): number {
  if (isSpheroid(s, f)) return SKYWATCH.SPHEROID_ATMO_HEX_PER_TICK;
  return speed === 'DASH' ? dashHexesPerTick(s, f) : cruiseHexesPerTick(s, f);
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
    fac.damage !== 'DESTROYED' && // D-052: a cratered runway is VSTOL-only
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
    if (carrier.pos.kind === 'ground') return airHexOver(s, carrier.pos);
  }
  const fac = homeFacility(s, f);
  if (!fac || fac.pos.kind !== 'ground') return null;
  return airHexOver(s, fac.pos);
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

/**
 * D-057: when will a grounded flight lift for this order? A planned mission caps
 * the alert ladder at MISSION_PREP_TICKS (brief + preflight, ~30 min); an
 * INTERCEPT (targetContactId) keeps the full ladder — reacting fast to a live
 * bandit is exactly what the alert states are for.
 */
export function launchTickFor(f: Formation, order: Order): number {
  const ladder = SKYWATCH.ALERT[f.alertState ?? 'STAND_DOWN']?.launchDelayTicks ?? 20;
  const delay = order.targetContactId ? ladder : Math.min(ladder, SKYWATCH.MISSION_PREP_TICKS);
  return order.issuedTick + delay;
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
    launchAt = launchTickFor(f, order); // D-057: missions prep in ~30 min, intercepts scramble
    emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
           patch: { air: { launchAtTick: launchAt } } });
  }
  if (s.tick < launchAt) return;

  const runway = baseHasRunway(s, f);
  const climbLevels = SKYWATCH.CRUISE_ALT_LEVEL; // ground → HIGH band
  const fpPaid = takeoffFp(runway) + climbFp(climbLevels);
  const here = f.pos as GroundPos;
  const hex = airHexOver(s, here); // you climb into the sky over your own base
  const pos: AirPos = {
    kind: 'air', gridQ: hex.q, gridR: hex.r, band: 'HIGH',
    altLevel: SKYWATCH.CRUISE_ALT_LEVEL,
    velocity: (order.airSpeed ?? 'CRUISE') === 'DASH'
      ? minSafeThrust(s, f) : SKYWATCH.ENTRY_VELOCITY_CRUISE,
    vectorDeg: 0,
  };
  emit({ type: 'AIR_LAUNCHED', formationId: f.id, pos, fpPaid, tick: s.tick });
  flakGauntlet(s, emit, f, here, 'climb-out'); // AA under the departure path gets its shot
  capitalGauntlet(s, emit, f, airHexOver(s, here), 'climb-out'); // D-050: the big guns too
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
 * D-038: the lead is only as good as the track — below LOCK the predicted point drifts
 * (CONTACT ±1 hex, SHADOW ±2; deterministic in the seed, so replay is byte-exact).
 * A parked or on-station target needs no lead, and takes no error.
 */
export function predictAirPos(
  s: TruthState, target: Formation, dt: number, trackLevel: number = LADDER.MAX_LEVEL,
): { q: number; r: number } | null {
  if (target.pos.kind !== 'air') return null;
  const cur = airQR(target.pos);
  if (target.air?.phase === 'ON_STATION' || target.air?.phase === 'GROUNDED') return cur;
  const smear = (p: { q: number; r: number }) => {
    const maxErr = SKYWATCH.INTERCEPT_LEAD_ERROR_HEXES[Math.min(LADDER.MAX_LEVEL, trackLevel)] ?? 2;
    if (maxErr <= 0) return p;
    const mag = hashPick(s.seed, ['lead-mag', target.id, s.tick], maxErr + 1);
    if (mag === 0) return p;
    const dir = DIR_BY_SIXTH[hashPick(s.seed, ['lead-dir', target.id, s.tick], 6)];
    return { q: p.q + dir.q * mag, r: p.r + dir.r * mag };
  };
  // resolve the target's speed exactly the way its own movement will (order profile wins)
  const targetOrder = activeAirOrder(s, target);
  if (target.air?.phase === 'RTB' || (!targetOrder && target.air?.phase === 'ENROUTE')) {
    // heading home: predict along its return leg, stopping at the base (or parked if none)
    const home = homeAirHexOf(s, target);
    if (!home) return cur;
    const step = Math.min(atmoHexesPerTick(s, target, 'CRUISE') * dt, hexDistance(cur, home));
    const line = hexLine(cur, home);
    return smear(line[Math.min(step, line.length - 1)]);
  }
  const mode: 'CRUISE' | 'DASH' = targetOrder?.airSpeed ?? target.air?.speed ?? 'CRUISE';
  const speed = atmoHexesPerTick(s, target, mode) * dt;
  const dir = DIR_BY_SIXTH[Math.round(((target.pos.vectorDeg % 360) + 360) % 360 / 60) % 6];
  return smear({ q: cur.q + dir.q * speed, r: cur.r + dir.r * speed });
}

function destAirHex(s: TruthState, f: Formation, order: Order | undefined, dt: number):
    { q: number; r: number } | null {
  // LAND (ext) outranks RTB: putting down NOW is how a bingo ship saves itself —
  // checked first so a fuel-forced RTB can't swallow the order.
  if (order?.kind === 'LAND' && order.targetHex) {
    return airHexOver(s, order.targetHex); // fly to the sky over the LZ, then put down
  }
  if (!order || f.air?.phase === 'RTB') return homeAirHexOf(s, f);
  if (order.targetContactId) {
    const c = s.contacts[order.targetContactId];
    if (!c) return null; // contact gone: caller completes the order
    // live track (≥ SHADOW): pursue the predicted intercept point; otherwise fly to
    // the stale estimate and hope the trail is warm
    if (c.level >= SKYWATCH.MIN_PLOT_INTERCEPT_LEVEL) {
      const target = s.formations[c.targetFormationId];
      const predicted = target && !target.destroyed
        ? predictAirPos(s, target, dt, c.level) : null;
      if (predicted) return predicted;
    }
    const est = c.delivered?.estPos ?? c.estPos;
    if (est?.kind === 'air') return { q: est.gridQ, r: est.gridR };
    if (est?.kind === 'ground') return airHexOver(s, est);
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

/** Which orbit node does an ascending ship arrive at? (See the ASCEND branch above.) */
function ascentNodeFor(s: TruthState, f: Formation, order: Order): Id | null {
  if (order.destinationNodeId && s.system.nodes[order.destinationNodeId]) {
    return order.destinationNodeId;
  }
  const here = f.pos.kind === 'air' ? airQR(f.pos) : null;
  const withTheater = Object.values(s.system.nodes)
    .filter(n => n.theaterId && s.theaters[n.theaterId])
    .sort((a, b) => a.id.localeCompare(b.id));
  if (here) {
    const under = groundHexUnder(s, here); // ascend from wherever you are in the region
    const over = under ? withTheater.find(n => n.theaterId === under.theaterId) : undefined;
    if (over) return over.id;
  }
  return withTheater[0]?.id ?? null;
}

/**
 * D-051: the recon sortie — a flight on a RECON order photographs the corridor it
 * flies: SENSOR_RANGES.RECON_AIR_CORRIDOR_WIDTH ground hexes wide, centered on the
 * track. Terrain under the corridor becomes scouted ground (the same fog layer the
 * ground scouts feed), and every enemy ground formation under it gets one passive-
 * channel look per step — the full signature stack applies, so a column moving on a
 * road is film-ready while a dug-in lance under trees at night is nearly invisible.
 * The photos ride home with the plane: an airborne flight is never on-net, so its
 * reports queue and deliver when it lands back inside the net — and die with it if
 * it doesn't (REPORTS_LOST). Flak, capital batteries, and interception are already
 * waiting along the corridor; that is the price of the picture.
 */
export function reconSweep(
  s: TruthState, emit: (e: GameEvent) => void,
  f: Formation, track: Array<{ q: number; r: number }>,
): void {
  const half = Math.floor(SENSOR_RANGES.RECON_AIR_CORRIDOR_WIDTH / 2);
  const night = isNight(s, s.tick);

  // terrain: everything under the corridor is on the film
  const known = new Set(s.scoutedHexes[f.sideId] ?? []);
  const fresh: string[] = [];
  const theaters = new Set<string>();
  for (const t of track) {
    const under = groundHexUnder(s, t);
    if (!under) continue; // open sky beyond the mapped region
    theaters.add(under.theaterId);
    const theater = s.theaters[under.theaterId];
    for (let dq = -half; dq <= half; dq++) {
      for (let dr = Math.max(-half, -dq - half); dr <= Math.min(half, -dq + half); dr++) {
        const q = under.q + dq, r = under.r + dr;
        if (!theater.hexes[hexKey(q, r)]) continue;
        const key = `${under.theaterId}:${q},${r}`;
        if (!known.has(key)) { known.add(key); fresh.push(key); }
      }
    }
  }
  if (fresh.length) emit({ type: 'HEXES_SCOUTED', sideId: f.sideId, keys: fresh });

  // formations: one passive look per enemy ground formation under the corridor
  for (const target of Object.values(s.formations)) {
    if (target.destroyed || target.mounted || target.sideId === f.sideId) continue;
    if (target.pos.kind !== 'ground' || !theaters.has(target.pos.theaterId)) continue;
    if (distanceToPath(airHexOver(s, target.pos), track) > half) continue;

    const { tn } = computeDetectionTN(s, target, 'PASSIVE_SENSOR', night);
    const r = rollDice(s.seed, s.seedCursor, '2d6');
    emit({ type: 'DIE_ROLLED', roll: {
      id: `roll:${s.seedCursor}`, tick: s.tick,
      purpose: `air recon ${f.name} → ${target.name} (TN ${tn})`,
      dice: '2d6', result: r.result, seedCursor: r.nextCursor - 2 } });
    if (r.result >= tn) {
      registerDetection(s, emit, f.sideId, target, LADDER.CLIMB_PER_SUCCESS,
        { id: f.id, name: f.name, alwaysOnNet: false });
    }
  }

  // D-051.1: fixed installations can't dodge the camera — every enemy facility
  // under the corridor is photographed outright, no roll. The photo still rides
  // home with the plane (spotFacility queues it through the report pipeline).
  for (const fac of Object.values(s.facilities)) {
    if (fac.sideId === f.sideId || fac.pos.kind !== 'ground') continue;
    if (!theaters.has(fac.pos.theaterId)) continue;
    if (distanceToPath(airHexOver(s, fac.pos), track) > half) continue;
    spotFacility(s, emit, f.sideId, fac, { id: f.id, name: f.name, alwaysOnNet: false });
  }
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

  // LIFT_OFF (ext): get airborne and hold at altitude — a standing order that never
  // self-completes. The ship loiters over its position (paying the ledger) until the
  // next order (LAND, FERRY, a drop…) supersedes it.
  if (order?.kind === 'LIFT_OFF' && f.air?.phase !== 'ON_STATION') {
    emit({ type: 'AIR_PHASE', formationId: f.id, phase: 'ON_STATION', tick: s.tick });
    emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
           patch: { air: { loiterTicksRemaining: -1 } } });
    return;
  }

  // ASCEND (ext): climb the well to the planet's orbit node. The burn is anchored on
  // space.atmoEndTick (step size never matters); arrival swaps the ship onto the system
  // map. Destination: an explicit destinationNodeId, else the node embedding the theater
  // this air hex covers, else the first node with a theater — no node ⇒ the order fizzles.
  if (order?.kind === 'ASCEND') {
    const nodeId = ascentNodeFor(s, f, order);
    if (!nodeId) {
      emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
      return;
    }
    const end = f.space?.atmoEndTick;
    if (end == null) {
      emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
             patch: { space: { atmoEndTick: s.tick + ATMO.ASCENT_TICKS } } });
      return;
    }
    if (s.tick < end) return;
    emit({ type: 'ATMO_TRANSIT', formationId: f.id, direction: 'ASCENT',
           pos: { kind: 'node', nodeId }, fpPaid: ATMO.ASCENT_FP, tick: s.tick });
    emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
    return;
  }

  // on station: pay loiter, count down, then egress or RTB (§2, §4).
  // Only when the ACTIVE order is the one holding station — a superseding order
  // (LAND, FERRY…) must fall through to the movement machinery instead of loitering.
  const holdsStation = !!order && (order.kind === 'LIFT_OFF' || !!order.station);
  if (f.air?.phase === 'ON_STATION' && order && holdsStation) {
    const remaining = f.air.loiterTicksRemaining ?? -1;
    const loiterTicks = remaining < 0 ? dt : Math.min(dt, remaining);
    if (loiterTicks > 0) {
      emit({ type: 'FUEL_SPENT', formationId: f.id,
             fpPaid: loiterFpPerTick(s, f, !!f.air.lean) * loiterTicks,
             reason: 'loiter', tick: s.tick });
    }
    // D-051: a recon flight holding station keeps its cameras on the hex below
    if (order.kind === 'RECON') reconSweep(s, emit, f, [airQR(f.pos as AirPos)]);
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

  // D-059: fly LEGS until the step's speed budget runs out — one leg per step
  // discarded the leftover budget at every waypoint, so a hand-drawn route with
  // short legs crawled at 1-2 hexes per step instead of the aircraft's real speed.
  let budget = atmoHexesPerTick(s, f, speed) * dt;
  while (true) {
  const dest = destAirHex(s, f, order, dt);
  if (dest === null) {
    if (order) {
      // chase target evaporated, or no plottable destination: mission over, go home
      emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
    }
    if (f.air?.phase !== 'RTB') {
      emit({ type: 'AIR_PHASE', formationId: f.id, phase: 'RTB', tick: s.tick });
    }
    // no home to fly to (a descended DropShip, a stranded flight): hold here —
    // holding aloft awaiting orders is the design for orderless carriers, and
    // FERRY now lands at its destination, so this is a deliberate hover
    return;
  }

  const cur = airQR(f.pos);
  const dist = hexDistance(cur, dest);
  const hexesFlown = Math.min(budget, dist);

  if (hexesFlown > 0) {
    const line = hexLine(cur, dest);
    const newQR = line[Math.min(hexesFlown, line.length - 1)];
    const pos: AirPos = { ...f.pos as AirPos, gridQ: newQR.q, gridR: newQR.r,
                          velocity: speed === 'DASH' ? minSafeThrust(s, f) : SKYWATCH.ENTRY_VELOCITY_CRUISE,
                          vectorDeg: Math.round(headingDeg(cur, dest)) };
    emit({ type: 'AIR_MOVED', formationId: f.id, pos,
           fpPaid: hexesFlown * transitFpPerHex(s, f, speed), speed, tick: s.tick });
    budget -= hexesFlown;
    // D-051: a recon sortie photographs the leg it just flew — cameras run the
    // whole track, not just the endpoint, so a fast pass can't skip over targets
    if (order?.kind === 'RECON') {
      reconSweep(s, emit, f, line.slice(0, Math.min(hexesFlown, line.length - 1) + 1));
    }
  }

  if (hexesFlown < dist) return; // speed budget exhausted mid-leg: airborne until next step
  {
    // arrived
    // LAND (ext): put down on the plotted hex — no facility needed, any passable ground.
    // Water/impassable terrain refuses the landing: the order completes and the ship
    // stays aloft (holding for new orders).
    if (order?.kind === 'LAND' && order.targetHex) {
      const t = order.targetHex;
      const hex = s.theaters[t.theaterId]?.hexes[hexKey(t.q, t.r)];
      const passable = hex && TERRAIN[hex.terrain]?.ompCost !== null;
      emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
      if (passable) {
        const runway = Object.values(s.facilities).some(fac =>
          fac.sideId === f.sideId && fac.pos.kind === 'ground' &&
          fac.pos.theaterId === t.theaterId && fac.pos.q === t.q && fac.pos.r === t.r &&
          (fac.tags.includes('AIRSTRIP') || fac.tags.includes('SPACEPORT')));
        flakGauntlet(s, emit, f, { ...t }, 'final approach'); // AA around the LZ fires first
        capitalGauntlet(s, emit, f, airHexOver(s, t), 'final approach');
        emit({ type: 'AIR_LANDED', formationId: f.id, pos: { ...t },
               fpPaid: landingFp(runway), tick: s.tick });
      }
      return;
    }
    if (f.air?.phase === 'RTB' || !order) {
      // carrier-based (ext): recover straight into the bay — land, stow, done. A full
      // bay group means a wave-off: the flight holds over the ship until one opens.
      const carrier = f.air?.homeCarrierId ? s.formations[f.air.homeCarrierId] : undefined;
      if (carrier && !carrier.destroyed && carrier.carrier) {
        const aboard = Object.values(s.formations).filter(x =>
          !x.destroyed && x.mounted?.carrierFormationId === carrier.id).length;
        if (aboard < carrier.carrier.bays) {
          if (carrier.pos.kind === 'ground') {
            flakGauntlet(s, emit, f, carrier.pos, 'recovery approach');
            capitalGauntlet(s, emit, f, airHexOver(s, carrier.pos), 'recovery approach');
          }
          emit({ type: 'FUEL_SPENT', formationId: f.id, fpPaid: landingFp(false),
                 reason: 'carrier recovery', tick: s.tick });
          emit({ type: 'AIR_PHASE', formationId: f.id, phase: 'GROUNDED', tick: s.tick });
          emit({ type: 'MOUNT_CHANGED', formationId: f.id, carrierFormationId: carrier.id });
          emit({ type: 'MOUNT_MOVED', formationId: f.id,
                 pos: structuredClone(carrier.pos), tick: s.tick });
        }
        return;
      }
      // descend (free in atmosphere) and land at the home facility
      const fac = homeFacility(s, f);
      if (fac && fac.pos.kind === 'ground') {
        const runway = fac.tags.includes('AIRSTRIP') || fac.tags.includes('SPACEPORT');
        flakGauntlet(s, emit, f, fac.pos, 'final approach');
        capitalGauntlet(s, emit, f, airHexOver(s, fac.pos), 'final approach');
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
    // waypoint route: advance the index; route exhausted ⇒ mission complete
    const wp = (order.path ?? []).filter(p => p.kind === 'air');
    const idx = (f.pathIndex ?? 0) + 1;
    emit({ type: 'MOVE_PROGRESS', formationId: f.id, moveProgress: 0, pathIndex: idx });
    if (idx >= wp.length) {
      emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
      // D-059: FERRY means "fly the route and LAND" — it used to boomerang: the
      // order completed, RTB kicked in, and the ship flew all the way back to its
      // ORIGINAL base (or hovered forever if it had none). Put down at the
      // destination; landing on an own friendly strip rebases the flight there.
      if (order.kind === 'FERRY') {
        const under = groundHexUnder(s, airQR(f.pos as AirPos));
        const uHex = under ? s.theaters[under.theaterId]?.hexes[hexKey(under.q, under.r)] : undefined;
        if (under && uHex && TERRAIN[uHex.terrain]?.ompCost !== null) {
          const strip = Object.values(s.facilities).find(fac =>
            fac.sideId === f.sideId && fac.pos.kind === 'ground' &&
            fac.pos.theaterId === under.theaterId &&
            fac.pos.q === under.q && fac.pos.r === under.r &&
            (fac.tags.includes('AIRSTRIP') || fac.tags.includes('SPACEPORT')) &&
            fac.damage !== 'DESTROYED');
          flakGauntlet(s, emit, f, { ...under }, 'final approach');
          capitalGauntlet(s, emit, f, airQR(f.pos as AirPos), 'final approach');
          emit({ type: 'AIR_LANDED', formationId: f.id,
                 ...(strip ? { facilityId: strip.id } : {}),
                 pos: { ...under }, fpPaid: landingFp(!!strip), tick: s.tick });
          if (strip && !f.air?.homeCarrierId) {
            emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
                   patch: { air: { homeFacilityId: strip.id } } });
          }
          return;
        }
        // water or a wall below the last waypoint: nowhere to put down — head home
      }
      emit({ type: 'AIR_PHASE', formationId: f.id, phase: 'RTB', tick: s.tick });
      return;
    }
    // more route ahead: keep flying this step with the remaining budget
    if (budget <= 0) return;
  }
  } // while (true)
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

/**
 * A stowed flight with an active air mission launches from its carrier's bay (ext):
 * mount cleared, homed on the carrier, out the doors at the carrier's air position
 * (or climbing off its back if the ship is on the ground). Mirrors the tryLaunch gates —
 * turnaround still in progress, grounded crews, and blind intercept plots all hold it.
 */
function scrambleFromBay(s: TruthState, f: Formation, emit: (e: GameEvent) => void): void {
  const order = activeAirOrder(s, f);
  if (!order || s.tick < order.effectiveTick) return;
  if (order.kind === 'LAND' || order.kind === 'LIFT_OFF') return; // nonsense from a bay
  const carrier = s.formations[f.mounted!.carrierFormationId];
  if (!carrier || carrier.destroyed) return; // carrierPass strands it
  if (f.air?.turnaroundReadyTick != null && s.tick < f.air.turnaroundReadyTick) return;
  const fatigues = f.unitIds.flatMap(uid =>
    (s.units[uid]?.pilotIds ?? []).map(pid => s.pilots[pid]?.fatigue ?? 0));
  if (fatigues.some(ft => ft >= SKYWATCH.FATIGUE_GROUNDED_AT)) return;
  if (order.targetContactId) {
    const c = s.contacts[order.targetContactId];
    if ((c?.delivered?.level ?? 0) < SKYWATCH.MIN_PLOT_INTERCEPT_LEVEL) return;
  }

  let hex: { q: number; r: number };
  let altLevel: number;
  let fpPaid: number;
  if (carrier.pos.kind === 'air') {
    hex = airQR(carrier.pos);
    altLevel = carrier.pos.altLevel;
    fpPaid = takeoffFp(false); // already at altitude: just the launch burn
  } else if (carrier.pos.kind === 'ground') {
    hex = airHexOver(s, carrier.pos);
    altLevel = SKYWATCH.CRUISE_ALT_LEVEL;
    fpPaid = takeoffFp(false) + climbFp(SKYWATCH.CRUISE_ALT_LEVEL);
  } else {
    return; // in space: a DEEP SKY sortie, not this pass
  }
  emit({ type: 'MOUNT_CHANGED', formationId: f.id, carrierFormationId: null });
  emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
         patch: { air: { homeCarrierId: carrier.id } } });
  const pos: AirPos = {
    kind: 'air', gridQ: hex.q, gridR: hex.r, band: 'HIGH', altLevel,
    velocity: (order.airSpeed ?? 'CRUISE') === 'DASH'
      ? minSafeThrust(s, f) : SKYWATCH.ENTRY_VELOCITY_CRUISE,
    vectorDeg: 0,
  };
  emit({ type: 'AIR_LAUNCHED', formationId: f.id, pos, fpPaid, tick: s.tick });
  if (carrier.pos.kind === 'ground') {
    flakGauntlet(s, emit, f, carrier.pos, 'deck launch'); // climbing off a grounded ship
    capitalGauntlet(s, emit, f, airHexOver(s, carrier.pos), 'deck launch');
  }
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

export function airPass(s: TruthState, dt: number, emit: (e: GameEvent) => void): void {
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || !isFlight(s, f)) continue;
    if (f.mounted) {
      // stowed in a bay: no ledger, no upkeep — but an active air order scrambles the
      // flight straight off the deck (ext), homed on the carrier for RTB/joker/bingo
      scrambleFromBay(s, f, emit);
      continue;
    }
    alertUpkeep(s, f, dt, emit);
    const order = activeAirOrder(s, f);
    if (f.pos.kind === 'ground') {
      if (order) tryLaunch(s, f, order, emit);
      else if (f.air?.launchAtTick != null) {
        // D-059: the order this prep clock was set for is gone (superseded or
        // cancelled mid-prep). Left in place it pinned the campaign in CONTACT
        // mode forever and let the NEXT order launch instantly, skipping its prep.
        emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
               patch: { air: { launchAtTick: null } } });
      }
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
    if (fac.damage === 'DESTROYED') continue; // D-052: bombed-out radar is off the air
    searchers.push({ id: fac.id, sideId: fac.sideId, name: fac.name,
      airHex: airHexOver(s, fac.pos),
      range: SKYWATCH.RADAR_HORIZON.HIGH_BAND_AIR_HEXES +
             SKYWATCH.RADAR_HORIZON.STATION_HQ_BONUS_AIR_HEXES,
      active: !!fac.activeSweep, alwaysOnNet: true });
  }
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || f.pos.kind !== 'ground' || f.mounted) continue;
    const isHq = f.unitIds.some(uid => s.units[uid]?.tags.includes('HQ'));
    searchers.push({ id: f.id, sideId: f.sideId, name: f.name,
      airHex: airHexOver(s, f.pos),
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
  const due = Object.values(s.orders).find(o =>
    !o.completed && o.formationId === f.id && AIR_MISSIONS.has(o.kind) &&
    o.effectiveTick <= s.tick + 1);
  // D-059: a leftover prep clock with no live order pins nothing — airPass clears
  // it next step; without the `due` gate it held the clock in CONTACT mode forever
  if (!due) return false;
  if (f.air?.launchAtTick != null) return true;
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
