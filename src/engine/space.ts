/**
 * engine/space.ts — DEEP SKY: the system war (Module 2).
 *
 * Node-and-lane geometry, the brachistochrone integrator with burn-day ledgers, the
 * light-lag intelligence layer ("a system map of light-cones, not truths"), watch-
 * cadence space detection, the encounter classifier, and the jump board.
 * Battles are never simulated: the classifier feeds a SPACE engagement and the
 * capital handoff; Strategic Operations takes it from there.
 */
import { ATMO, CLOCK, DEEPSKY, LADDER, SKYWATCH } from '../rules.js';
import type {
  AirPos, Emission, Formation, Id, JumpDrive, LanePos, NodePos, Order, Position, SysLane,
  TruthState,
} from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { rollDice } from '../core/rng.js';
import { registerDetection } from './detection.js';
import { airHexOver } from './air.js';

export const SPACE_ORDERS = new Set([
  'TRANSIT', 'COLD_COAST', 'STATION_KEEP', 'INTERCEPT', 'SKIM_FUEL',
  'RECHARGE_SAIL', 'QUICK_CHARGE', 'JUMP', 'INSPECT', 'BLOCKADE', 'BOARD',
  'DESCEND', // ext: re-enter from a planet/moon node into its theater's air layer
]);

const daysOf = (ticks: number) => ticks / CLOCK.TICKS_PER_DAY;

// ── Brachistochrone math (DEEP SKY §2; spec §1.5) ───────────────────────────

/** Standard profile: 1G to midpoint, flip, brake — T(days) = 2.835 × √(AU ÷ G). */
export function transitDays(dAU: number, g: number): number {
  return DEEPSKY.BRACHISTOCHRONE_COEFF * Math.sqrt(dAU / g);
}

/** No-flip "battering ram": half the time, arrives ballistic — SLASH-only. */
export function noFlipDays(dAU: number, g: number): number {
  return transitDays(dAU, g) / 2;
}

/** ΔV in kps from burning `days` at `g`. */
export function kpsFromBurn(days: number, g: number): number {
  return DEEPSKY.KPS_PER_BURN_DAY_1G * g * days;
}

export function tonsBurned(tonsPerBurnDay: number, g: number, days: number): number {
  return tonsPerBurnDay * g * days;
}

/** Burn-days of endurance left in the bunkers (the fleet's real reach). */
export function burnDaysRemaining(s: TruthState, f: Formation): number {
  const per = f.unitIds.map(uid => {
    const fuel = s.units[uid]?.fuel;
    if (!fuel) return Infinity;
    return fuel.tons / (fuel.tonsPerBurnDay ?? DEEPSKY.TONS_PER_BURN_DAY_DEFAULT);
  });
  const min = Math.min(...per);
  return Number.isFinite(min) ? min : 0;
}

export function maxG(s: TruthState, f: Formation): number {
  // maxThrust on the record sheet, read as the hull's G rating; default 2
  const gs = f.unitIds.map(uid => s.units[uid]?.maxThrust ?? 4);
  return Math.max(1, Math.min(...gs) / 2);
}

// ── System geometry: a metric graph, not a map ──────────────────────────────

function lanesFrom(s: TruthState, nodeId: Id): SysLane[] {
  return Object.values(s.system.lanes).filter(l => l.a === nodeId || l.b === nodeId);
}

/** Shortest distance over the lane graph (small graphs: plain Dijkstra). */
export function nodeDistanceAU(s: TruthState, from: Id, to: Id): number {
  if (from === to) return 0;
  const dist = new Map<Id, number>([[from, 0]]);
  const open = new Set<Id>([from]);
  while (open.size) {
    let cur: Id | null = null;
    for (const n of open) if (cur === null || dist.get(n)! < dist.get(cur)!) cur = n;
    open.delete(cur!);
    if (cur === to) return dist.get(cur!)!;
    for (const lane of lanesFrom(s, cur!)) {
      const next = lane.a === cur ? lane.b : lane.a;
      const d = dist.get(cur!)! + lane.distanceAU;
      if (d < (dist.get(next) ?? Infinity)) { dist.set(next, d); open.add(next); }
    }
  }
  return Infinity;
}

/** Distance in AU between any two space positions, over the lane metric. */
export function positionDistanceAU(s: TruthState, a: Position, b: Position): number {
  const anchors = (p: Position): Array<{ nodeId: Id; offset: number }> => {
    if (p.kind === 'node') return [{ nodeId: p.nodeId, offset: 0 }];
    if (p.kind === 'lane') {
      const lane = s.system.lanes[p.laneId];
      if (!lane) return [];
      return [{ nodeId: lane.a, offset: p.progressAU },
              { nodeId: lane.b, offset: lane.distanceAU - p.progressAU }];
    }
    if (p.kind === 'ground') {
      // a ground position lives on its planet's node
      const node = Object.values(s.system.nodes).find(n => n.theaterId === p.theaterId);
      return node ? [{ nodeId: node.id, offset: 0 }] : [];
    }
    return [];
  };
  const as = anchors(a), bs = anchors(b);
  let best = Infinity;
  for (const x of as) {
    for (const y of bs) {
      // same lane: direct separation along it
      if (a.kind === 'lane' && b.kind === 'lane' && a.laneId === b.laneId) {
        return Math.abs(a.progressAU - b.progressAU);
      }
      best = Math.min(best, x.offset + nodeDistanceAU(s, x.nodeId, y.nodeId) + y.offset);
    }
  }
  return best;
}

// ── The light-lag layer (DEEP SKY §4.2; D-011.1: 8.3 min/AU per §9.1) ───────

export function lightLagMinutes(dAU: number): number {
  return dAU * DEEPSKY.LIGHT_LAG_MIN_PER_AU;
}
export function lightLagTicks(dAU: number): number {
  // rounded to the engine's native grain (the 6-minute tick); never less than 1 tick
  return Math.max(1, Math.round(lightLagMinutes(dAU) / CLOCK.TICK_MINUTES));
}

/** Every node a side can see from: its vessels' positions and its occupied planets. */
export function observerPositions(s: TruthState, sideId: Id): Position[] {
  const out: Position[] = [];
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || f.sideId !== sideId) continue;
    if (f.pos.kind === 'node' || f.pos.kind === 'lane') out.push(f.pos);
  }
  const theaters = new Set<Id>();
  for (const f of Object.values(s.formations)) {
    if (!f.destroyed && f.sideId === sideId && f.pos.kind === 'ground') theaters.add(f.pos.theaterId);
  }
  for (const fac of Object.values(s.facilities)) {
    if (fac.sideId === sideId && fac.pos.kind === 'ground') theaters.add(fac.pos.theaterId);
  }
  for (const t of theaters) {
    const node = Object.values(s.system.nodes).find(n => n.theaterId === t);
    if (node) out.push({ kind: 'node', nodeId: node.id });
  }
  return out;
}

/** Smallest light lag (ticks) from an event position to any of the side's observers. */
export function observerLagTicks(s: TruthState, sideId: Id, eventPos: Position): number {
  let best = Infinity;
  for (const obs of observerPositions(s, sideId)) {
    best = Math.min(best, positionDistanceAU(s, eventPos, obs));
  }
  return Number.isFinite(best) ? lightLagTicks(best) : Infinity;
}

function massClassOf(s: TruthState, f: Formation): string {
  const classes = f.unitIds.map(uid => s.units[uid]?.class).filter(Boolean);
  if (classes.includes('WARSHIP')) return 'capital mass';
  if (classes.includes('JUMPSHIP')) return 'JumpShip-class mass';
  if (classes.includes('DROPSHIP')) {
    const n = classes.filter(c => c === 'DROPSHIP').length;
    return `${n} DropShip mass${n > 1 ? 'es' : ''}`;
  }
  return 'small mass';
}

/** Emit a jump flash: detected automatically, system-wide — after light lag (§4.1). */
export function emitJumpFlash(
  s: TruthState, emit: (e: GameEvent) => void, f: Formation, nodeId: Id,
): void {
  const emission: Emission = {
    id: `emission:flash:${f.id}:${s.tick}`,
    kind: 'JUMP_FLASH', sourceFormationId: f.id, sourceSideId: f.sideId,
    pos: { kind: 'node', nodeId }, tick: s.tick,
    massClass: massClassOf(s, f), observedBy: [],
  };
  emit({ type: 'EMISSION_CREATED', emission });
}

/**
 * Deliver emissions whose light cone has reached an observer: automatic contacts at
 * SHADOW carrying position + mass class, timestamped with when they were TRUE.
 */
export function lightLagPass(s: TruthState, emit: (e: GameEvent) => void): void {
  for (const em of Object.values(s.emissions)) {
    for (const sideId of Object.keys(s.sides)) {
      if (sideId === em.sourceSideId || em.observedBy.includes(sideId)) continue;
      const lag = observerLagTicks(s, sideId, em.pos);
      if (!Number.isFinite(lag) || s.tick < em.tick + lag) continue;
      emit({ type: 'EMISSION_OBSERVED', emissionId: em.id, sideId, tick: s.tick });
      const target = s.formations[em.sourceFormationId];
      if (target && !target.destroyed) {
        registerDetection(s, emit, sideId, target, DEEPSKY.EMISSION_CONTACT_LEVEL,
          { id: `lightcone:${sideId}`, name: em.kind === 'JUMP_FLASH' ? 'K-F flash watch' : 'drive plume watch',
            alwaysOnNet: true },
          { staleAsOfTick: em.tick, setLevel: true,  // light gives a floor, not a climb
            note: `${em.massClass}${em.vectorNote ? ' — ' + em.vectorNote : ''}` });
      }
    }
  }
}

// ── Space movement: the burn (DEEP SKY §2–3) ────────────────────────────────

function activeSpaceOrder(s: TruthState, f: Formation): Order | undefined {
  const o = f.currentOrderId ? s.orders[f.currentOrderId] : undefined;
  return o && !o.completed && SPACE_ORDERS.has(o.kind) ? o : undefined;
}

function crewBurnRdy(
  s: TruthState, f: Formation, g: number, days: number, emit: (e: GameEvent) => void,
): void {
  let perRdyDays: number | null = null;
  if (g >= DEEPSKY.BURN_RDY.HARD_BURN_MIN_G) perRdyDays = DEEPSKY.BURN_RDY.MIL_2G_DAYS_PER_RDY;
  else if (g >= 2) perRdyDays = DEEPSKY.BURN_RDY.MIL_2G_DAYS_PER_RDY;
  else if (g >= 1.5) perRdyDays = DEEPSKY.BURN_RDY.MIL_1_5G_DAYS_PER_RDY;
  if (perRdyDays === null) return;
  let acc = (f.space?.rdyDayAcc ?? 0) + days;
  while (acc >= perRdyDays - 1e-9) {
    emit({ type: 'RDY_CHANGED', formationId: f.id, delta: -1, reason: `${g}G burn fatigue` });
    acc -= perRdyDays;
  }
  emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id, patch: { space: { rdyDayAcc: acc } } });
}

/**
 * Integrate every vessel on a lane. Profile semantics (BurnProfile {g, flipAtAU,
 * coastFromAU}): thrust at g until coastFromAU (if set) ⇒ ballistic coast; otherwise
 * thrust to flipAtAU (default midpoint), flip, brake, arrive at rest. No-flip arrivals
 * keep their velocity (SLASH-only, §2.2).
 */
export function spaceMovementPass(s: TruthState, dt: number, emit: (e: GameEvent) => void): void {
  const days = daysOf(dt);
  for (const f of Object.values(s.formations)) {
    if (f.destroyed) continue;
    if (f.mounted) continue; // embarked: rides the carrier (carrierPass), no self-burn
    const order = activeSpaceOrder(s, f);

    // start a transit: at a node with a TRANSIT/COLD_COAST order ⇒ enter the lane
    if (f.pos.kind === 'node' && order && (order.kind === 'TRANSIT' || order.kind === 'COLD_COAST')
        && order.laneId && s.tick >= order.effectiveTick) {
      const lane = s.system.lanes[order.laneId];
      if (!lane || (lane.a !== f.pos.nodeId && lane.b !== f.pos.nodeId)) continue;
      // sail up = no thrust (§7.2)
      if (f.unitIds.some(uid => s.jumpDrives[uid]?.sail === 'DEPLOYED')) continue;
      const g = order.burnProfile?.g ?? 1;
      const pos: LanePos = {
        kind: 'lane', laneId: lane.id, progressAU: 0, velocityKps: 0,
        burnProfile: order.burnProfile ?? { g: 1, flipAtAU: lane.distanceAU / 2 },
        flipped: false,
      };
      // riding from the far end: progress measures from lane.a — normalize by flipping
      // the lane reference so progress always runs from the origin node (D-011)
      const fromA = lane.a === f.pos.nodeId;
      (pos as LanePos & { fromA?: boolean }).fromA = fromA;
      emit({ type: 'LANE_PROGRESS', formationId: f.id, pos, tick: s.tick });
      emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
             patch: { space: { burnStartTick: g >= DEEPSKY.BURN_DETECT_MIN_G ? s.tick : null } } });
      continue;
    }

    if (f.pos.kind !== 'lane') continue;
    const lane = s.system.lanes[f.pos.laneId];
    if (!lane) continue;
    const prof = f.pos.burnProfile;
    const total = lane.distanceAU;
    const flipAt = prof.flipAtAU ?? total / 2;
    const coastFrom = prof.coastFromAU;

    let { progressAU: x, velocityKps: v } = f.pos;
    let flipped = f.pos.flipped;
    let burningDays = 0;
    const kpsToAUday = DEEPSKY.AU_PER_DAY_PER_KPS;
    const aKps = DEEPSKY.KPS_PER_BURN_DAY_1G * prof.g; // Δv per day
    const aAUday2 = aKps * kpsToAUday;                 // AU/day²

    // integrate in tick-grain substeps so the flip lands where the physics says:
    // the brake begins when remaining distance ≤ stopping distance (v²/2a), never
    // earlier than the plotted flipAtAU. A coarse watch-grain flip overshoots the
    // midpoint and arrives hot, which the standard profile must never do.
    const subDays = 1 / CLOCK.TICKS_PER_DAY;
    for (let i = 0; i < dt && x < total - 1e-9; i++) {
      const stoppingAU = (v * kpsToAUday) ** 2 / (2 * aAUday2);
      let phase: 'ACCEL' | 'COAST' | 'BRAKE';
      if (coastFrom !== undefined) phase = x >= coastFrom ? 'COAST' : 'ACCEL';
      else if (flipped || (x >= flipAt - 1e-9 || total - x <= stoppingAU * 1.0001))
        phase = total - x <= stoppingAU * 1.0001 ? 'BRAKE' : 'ACCEL';
      else phase = 'ACCEL';

      if (phase === 'ACCEL') {
        v += aKps * subDays;
        x += (v - aKps * subDays / 2) * kpsToAUday * subDays;
        burningDays += subDays;
      } else if (phase === 'BRAKE') {
        flipped = true;
        const dv = Math.min(v, aKps * subDays);
        const tBurn = dv / aKps;
        x += (v - dv / 2) * kpsToAUday * tBurn + (v - dv) * kpsToAUday * (subDays - tBurn);
        v -= dv;
        burningDays += tBurn;
        if (v <= 1e-9 && total - x <= 0.1) { x = total; break; } // braked to rest at the door
      } else {
        x += v * kpsToAUday * subDays; // ballistic: near-invisible, near-free
      }
    }

    // fuel & crew for the thrusting fraction
    if (burningDays > 0) {
      const tpd = Math.max(...f.unitIds.map(uid =>
        s.units[uid]?.fuel?.tonsPerBurnDay ?? DEEPSKY.TONS_PER_BURN_DAY_DEFAULT));
      emit({ type: 'TONS_BURNED', formationId: f.id,
             tons: tonsBurned(tpd, prof.g, burningDays), reason: `${prof.g}G burn`, tick: s.tick });
      crewBurnRdy(s, f, prof.g, burningDays, emit);
      if (f.space?.burnStartTick == null && prof.g >= DEEPSKY.BURN_DETECT_MIN_G) {
        emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
               patch: { space: { burnStartTick: s.tick } } });
      }
    } else if (f.space?.burnStartTick != null) {
      emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
             patch: { space: { burnStartTick: null } } });
    }

    // arrival: crossed the far end (ballistic arrivals keep their velocity)
    if (x >= total - 1e-6) {
      x = total;
      const fromA = (f.pos as LanePos & { fromA?: boolean }).fromA ?? true;
      const destNode = fromA ? lane.b : lane.a;
      const pos: NodePos = { kind: 'node', nodeId: destNode };
      emit({ type: 'ARRIVED_AT_NODE', formationId: f.id, pos, tick: s.tick });
      if (v > DEEPSKY.CLASSIFIER.BLOCKADE_REST_KPS) {
        emit({ type: 'GM_NOTE', tick: s.tick,
               text: `${f.name} arrives at ${destNode} ballistic at ${Math.round(v)} kps — cannot stop, cannot land; one slashing pass (DEEP SKY §2.2)` });
      }
      if (order) emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
      continue;
    }

    emit({ type: 'LANE_PROGRESS', formationId: f.id,
           pos: { ...f.pos, progressAU: x, velocityKps: v, flipped }, tick: s.tick });

    // burning at 1G+ is a continuous emission: refresh the light cone (one per step)
    if (burningDays > 0 && prof.g >= DEEPSKY.BURN_DETECT_MIN_G) {
      const emission: Emission = {
        id: `emission:burn:${f.id}:${s.tick}`,
        kind: 'DRIVE_BURN', sourceFormationId: f.id, sourceSideId: f.sideId,
        pos: { ...f.pos, progressAU: x, velocityKps: v, flipped }, tick: s.tick,
        massClass: massClassOf(s, f),
        vectorNote: `burn vector readable: arrival time and destination computable`,
        observedBy: [],
      };
      emit({ type: 'EMISSION_CREATED', emission });
    }
  }
}

// ── Space detection: coasters & station-keepers, per watch per searcher (§4) ─

function spaceTargets(s: TruthState): Formation[] {
  return Object.values(s.formations).filter(f =>
    !f.destroyed && (f.pos.kind === 'node' || f.pos.kind === 'lane'));
}

export function spaceSig(s: TruthState, target: Formation):
    { tn: number; mods: Array<{ label: string; value: number }> } {
  const mods: Array<{ label: string; value: number }> = [];
  let tn: number;
  if (target.pos.kind === 'lane') {
    tn = DEEPSKY.COLD_COAST_SIG;
  } else {
    tn = DEEPSKY.STATION_KEEPING_SIG;
    const node = s.system.nodes[(target.pos as NodePos).nodeId];
    if (node?.type === 'BELT_SECTOR') mods.push({ label: 'belt sector', value: DEEPSKY.BELT_SECTOR_SIG_MOD });
  }
  return { tn: tn + mods.reduce((a, m) => a + m.value, 0), mods };
}

/**
 * Roll cold-coast / station-keeping detection once per watch per searcher side.
 * A picket on ACTIVE emcon resolves targets within PICKET_RANGE_AU of its node at −2.
 */
export function spaceDetectionPass(s: TruthState, emit: (e: GameEvent) => void): void {
  const watch = Math.floor(s.tick / CLOCK.TICKS_PER_WATCH);
  if (watch <= Math.floor(s.system.lastSweepTick / CLOCK.TICKS_PER_WATCH) && s.tick !== 0) return;
  const targets = spaceTargets(s);
  if (targets.length === 0) return;
  emit({ type: 'SPACE_SWEEP', tick: s.tick });

  const searchers = Object.values(s.formations).filter(f =>
    !f.destroyed && (f.pos.kind === 'node' || f.pos.kind === 'lane'));

  for (const target of targets) {
    // thrusting 1G+ targets are handled by the emission layer (automatic)
    if (target.pos.kind === 'lane' && target.space?.burnStartTick != null) continue;
    for (const searcher of searchers) {
      if (searcher.sideId === target.sideId) continue;
      const { tn } = spaceSig(s, target);
      let mod = 0;
      const picketSweep = searcher.emcon === 'ACTIVE' && searcher.pos.kind === 'node' &&
        positionDistanceAU(s, searcher.pos, target.pos) <= DEEPSKY.PICKET_RANGE_AU;
      if (picketSweep) mod = -DEEPSKY.PICKET_ACTIVE_TN_MOD; // −2 TN expressed as +2 to the roll
      // beyond a picket's reach, deep-space passive watching is the long game: the roll
      // still happens (per watch per searcher) at the flat SIG
      const r = rollDice(s.seed, s.seedCursor, '2d6');
      emit({ type: 'DIE_ROLLED', roll: {
        id: `roll:${s.seedCursor}`, tick: s.tick,
        purpose: `space detection ${searcher.name} → ${target.name} (TN ${tn}${picketSweep ? ', picket sweep +2' : ''})`,
        dice: '2d6', result: r.result, seedCursor: r.nextCursor - 2 } });
      if (r.result + mod >= tn) {
        const lag = lightLagTicks(positionDistanceAU(s, searcher.pos, target.pos));
        registerDetection(s, emit, searcher.sideId, target, LADDER.CLIMB_PER_SUCCESS,
          { id: searcher.id, name: searcher.name, alwaysOnNet: true },
          { staleAsOfTick: Math.max(0, s.tick - lag) });
      }
    }
  }
}

// ── The encounter classifier (DEEP SKY §5; spec §3.5) ───────────────────────

export interface Classification {
  type: 'MATCHED' | 'SLASH' | 'STERN_CHASE' | 'BLOCKADE' | 'NO_ENGAGEMENT';
  mm: number;                 // interceptor maneuver margin, 1G-burn-day units of ΔV
  gapBurnDays: number;        // burn-days to null the velocity gap
  marginBurnDays: number;     // MM − 2 × gap (what "with reserve" means)
  overtakeNote?: string;
}

export function crewGLimitFactor(g: number): number {
  // ⚙ a hull rated past sustainable crew tolerance doesn't get full credit
  return g > 2 ? 2 / g : 1;
}

export function classifyEncounter(
  s: TruthState, interceptor: Formation, target: Formation,
): Classification {
  const vOf = (f: Formation) => f.pos.kind === 'lane' ? f.pos.velocityKps : 0;
  const atRest = (f: Formation) => vOf(f) <= DEEPSKY.CLASSIFIER.BLOCKADE_REST_KPS;

  const g = maxG(s, interceptor);
  const mm = burnDaysRemaining(s, interceptor) * g * crewGLimitFactor(g);
  const gapKps = Math.abs(vOf(target) - vOf(interceptor));
  const gap = gapKps / DEEPSKY.KPS_PER_BURN_DAY_1G;
  const margin = mm - DEEPSKY.CLASSIFIER.MATCHED_MM_FACTOR * gap;

  // both effectively at rest at the same node: the defender owns the geometry
  if (atRest(interceptor) && atRest(target) &&
      interceptor.pos.kind === 'node' && target.pos.kind === 'node' &&
      interceptor.pos.nodeId === target.pos.nodeId) {
    return { type: 'BLOCKADE', mm, gapBurnDays: gap, marginBurnDays: margin };
  }
  if (mm >= DEEPSKY.CLASSIFIER.MATCHED_MM_FACTOR * gap) {
    return { type: 'MATCHED', mm, gapBurnDays: gap, marginBurnDays: margin };
  }
  // can reach the path but not match velocity: one screaming pass
  if (mm >= gap / 2) {
    return { type: 'SLASH', mm, gapBurnDays: gap, marginBurnDays: margin };
  }
  // behind on the same lane: battle only when the overtake completes
  if (interceptor.pos.kind === 'lane' && target.pos.kind === 'lane' &&
      interceptor.pos.laneId === target.pos.laneId &&
      interceptor.pos.progressAU < target.pos.progressAU &&
      vOf(interceptor) > vOf(target)) {
    const closingKps = vOf(interceptor) - vOf(target);
    const gapAU = target.pos.progressAU - interceptor.pos.progressAU;
    const days = gapAU / (closingKps * DEEPSKY.AU_PER_DAY_PER_KPS);
    return { type: 'STERN_CHASE', mm, gapBurnDays: gap, marginBurnDays: margin,
             overtakeNote: `overtake in ~${days.toFixed(1)} days` };
  }
  return { type: 'NO_ENGAGEMENT', mm, gapBurnDays: gap, marginBurnDays: margin };
}

// ── The jump board (DEEP SKY §7; spec §3.7) ─────────────────────────────────

/** Sail recharge: chargePct creeps toward 100 while the sail is out. */
export function jumpBoardPass(s: TruthState, dt: number, emit: (e: GameEvent) => void): void {
  for (const d of Object.values(s.jumpDrives)) {
    if (d.sail !== 'DEPLOYED' || d.chargePct >= 100 || d.kfDamage === 'DEAD') continue;
    const hours = dt * CLOCK.TICK_MINUTES / 60;
    const next = Math.min(100, d.chargePct + (hours / d.chargeRateHrsTo100) * 100);
    if (next !== d.chargePct) emit({ type: 'JUMP_CHARGE', unitId: d.vesselUnitId, chargePct: next });
  }
}

/** Gas-giant skimming: 1d6 × 10 tons per watch, with a Piloting check (§3). */
export function skimPass(s: TruthState, dt: number, emit: (e: GameEvent) => void): void {
  const watch = Math.floor(s.tick / CLOCK.TICKS_PER_WATCH);
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || f.pos.kind !== 'node') continue;
    const order = activeSpaceOrder(s, f);
    if (!order || order.kind !== 'SKIM_FUEL') continue;
    const node = s.system.nodes[f.pos.nodeId];
    if (node?.type !== 'GAS_GIANT') continue;
    if (watch <= Math.floor((order.issuedTick - 1) / CLOCK.TICKS_PER_WATCH)) continue;
    if (dt < CLOCK.TICKS_PER_WATCH && s.tick % CLOCK.TICKS_PER_WATCH !== 0) continue;

    const pilot = rollDice(s.seed, s.seedCursor, '2d6');
    emit({ type: 'DIE_ROLLED', roll: { id: `roll:${s.seedCursor}`, tick: s.tick,
      purpose: `skim piloting check ${f.name} (TN ${DEEPSKY.SKIM.PILOTING_TN})`,
      dice: '2d6', result: pilot.result, seedCursor: pilot.nextCursor - 2 } });
    if (pilot.result < DEEPSKY.SKIM.PILOTING_TN) {
      // failure: minor structural damage, try again next watch
      const uid = f.unitIds[0];
      if (uid && s.units[uid] && s.units[uid].damage === 'OK') {
        emit({ type: 'UNIT_STATE_CHANGED', unitId: uid, damage: 'DAMAGED',
               ammoState: s.units[uid].ammoState });
      }
      continue;
    }
    const d6 = rollDice(s.seed, s.seedCursor, '1d6');
    emit({ type: 'DIE_ROLLED', roll: { id: `roll:${s.seedCursor}`, tick: s.tick,
      purpose: `skim yield ${f.name} (×10 tons)`, dice: '1d6',
      result: d6.result, seedCursor: d6.nextCursor - 1 } });
    emit({ type: 'TONS_GAINED', formationId: f.id,
           tons: d6.result * DEEPSKY.SKIM.D6_X_TONS_PER_WATCH,
           reason: 'gas giant skimming', tick: s.tick });
  }
}

/**
 * DESCEND (ext): re-entry from a planet/moon node into its embedded theater's air layer.
 * The transition takes ATMO.DESCENT_TICKS (anchored on space.atmoEndTick so step size
 * never matters) and delivers the vessel to the theater's air hex in the HIGH band —
 * a thrusting DropShip, bright on every radar screen from the moment it arrives.
 */
export function descentPass(s: TruthState, emit: (e: GameEvent) => void): void {
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || f.mounted || f.pos.kind !== 'node') continue;
    const order = activeSpaceOrder(s, f);
    if (!order || order.kind !== 'DESCEND' || s.tick < order.effectiveTick) continue;
    const node = s.system.nodes[f.pos.nodeId];
    const theaterId = node?.theaterId;
    if (!theaterId || !s.theaters[theaterId]) {
      // nothing down there to descend into: the order fizzles
      emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
      continue;
    }
    const end = f.space?.atmoEndTick;
    if (end == null) {
      emit({ type: 'FORMATION_BOOKKEEPING', formationId: f.id,
             patch: { space: { atmoEndTick: s.tick + ATMO.DESCENT_TICKS } } });
      continue;
    }
    if (s.tick < end) continue;
    // D-037 (congruent sky): you come down over the hex you aimed at — a targetHex on
    // the DESCEND order puts you in the sky over the LZ (the spheroid doctrine: cross
    // in space, descend on the spot). No target ⇒ over the theater's center.
    const aim = order.targetHex?.theaterId === theaterId
      ? order.targetHex : theaterCenter(s, theaterId);
    const hex = airHexOver(s, { theaterId, q: aim.q, r: aim.r });
    const pos: AirPos = {
      kind: 'air', gridQ: hex.q, gridR: hex.r, band: 'HIGH',
      altLevel: SKYWATCH.CRUISE_ALT_LEVEL,
      velocity: SKYWATCH.ENTRY_VELOCITY_CRUISE, vectorDeg: 0,
    };
    emit({ type: 'ATMO_TRANSIT', formationId: f.id, direction: 'DESCENT', pos,
           fpPaid: ATMO.DESCENT_FP, tick: s.tick });
    emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
  }
}

function theaterCenter(s: TruthState, theaterId: string): { q: number; r: number } {
  let maxQ = 0, maxR = 0;
  for (const key of Object.keys(s.theaters[theaterId]?.hexes ?? {})) {
    const [q, r] = key.split(',').map(Number);
    maxQ = Math.max(maxQ, q); maxR = Math.max(maxR, r);
  }
  return { q: Math.floor(maxQ / 2), r: Math.floor(maxR / 2) };
}

export function spacePass(s: TruthState, dt: number, emit: (e: GameEvent) => void): void {
  spaceMovementPass(s, dt, emit);
  descentPass(s, emit); // ext: the orbit → air seam
  lightLagPass(s, emit);
  spaceDetectionPass(s, emit);
  jumpBoardPass(s, dt, emit);
  skimPass(s, dt, emit);
}
