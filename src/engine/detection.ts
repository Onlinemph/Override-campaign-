/**
 * engine/detection.ts — detection pass, contact ladder, fade (core §6; spec §3.2).
 * All numbers come from rules.ts; the GM ruling D-006 governs cautious movement & night.
 */
import {
  BASE_SIG, CLOCK, LADDER, LADDER_NAMES, RECON_TRICKS, SATELLITE, SEARCHER_MODS,
  SENSOR_RANGES, SIG_MODS, SIZE_CLASS_NAMES, TERRAIN,
} from '../rules.js';
import type {
  Contact, ContactReport, ContactSnapshot, Facility, Formation, GroundPos, Hex,
  LadderLevel, Satellite, TruthState,
} from '../core/types.js';
import { hexKey } from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { rollDice, hashPick } from '../core/rng.js';
import { AXIAL_DIRECTIONS, distanceToPath, hexDistance, hexLine } from '../hex/axial.js';
import { isNight } from './clock.js';
import { isChainRelay, isFormationOnNet } from './net.js';

// ── Searchers ────────────────────────────────────────────────────────────────

export type SensorChannel = 'ACTIVE_SENSOR' | 'PASSIVE_SENSOR' | 'VISUAL';

export interface Searcher {
  kind: 'formation' | 'facility' | 'satellite';
  id: string;
  sideId: string;
  name: string;
  pos: GroundPos;
  passive: number;
  active: number;       // usable only when emitting (formation EMCON ACTIVE / facility sweep)
  emconActive: boolean;
  patrol: boolean;
  alwaysOnNet: boolean; // facilities & satellites (D-008.9)
}

/** Best sensor suite in the formation (core §3 SNS: "best sensor suite"). */
export function formationSensors(s: TruthState, f: Formation): { passive: number; active: number } {
  let best: { passive: number; active: number } = { ...SENSOR_RANGES.MECH_STANDARD };
  for (const uid of f.unitIds) {
    const u = s.units[uid];
    if (!u) continue;
    const candidates: Array<{ passive: number; active: number }> = [];
    if (u.tags.includes('BEAGLE')) candidates.push(SENSOR_RANGES.BEAGLE);
    if (u.tags.includes('HQ')) candidates.push(SENSOR_RANGES.MOBILE_HQ);
    if (u.tags.includes('RECON') && u.class === 'VTOL') candidates.push(SENSOR_RANGES.RECON_VTOL);
    for (const c of candidates) if (c.passive > best.passive) best = { ...c };
  }
  // formation may carry explicit sns overrides from setup
  if (f.sns.passive > best.passive || f.sns.active > best.active) {
    best = { passive: Math.max(f.sns.passive, best.passive), active: Math.max(f.sns.active, best.active) };
  }
  return best;
}

function gatherSearchers(s: TruthState): Searcher[] {
  const out: Searcher[] = [];
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || f.pos.kind !== 'ground') continue;
    if (f.mounted) continue; // stowed in a carrier bay: no sensor picture from inside a hull
    const sns = formationSensors(s, f);
    const order = f.currentOrderId ? s.orders[f.currentOrderId] : undefined;
    // core §6.1: DARK = passive sensors only at SNS −2 (D-008.13); eyeballs unaffected
    const passive = f.emcon === 'DARK'
      ? Math.max(0, sns.passive + SENSOR_RANGES.DARK_PASSIVE_RANGE_PENALTY)
      : sns.passive;
    out.push({
      kind: 'formation', id: f.id, sideId: f.sideId, name: f.name, pos: f.pos,
      passive, active: sns.active,
      emconActive: f.emcon === 'ACTIVE',
      patrol: order?.kind === 'PATROL' && !order.completed,
      alwaysOnNet: false,
    });
  }
  for (const fac of Object.values(s.facilities)) {
    if (!fac.sensorStation || fac.pos.kind !== 'ground') continue;
    if (fac.damage === 'DESTROYED') continue; // D-052: bombed-out radar sees nothing
    out.push({
      kind: 'facility', id: fac.id, sideId: fac.sideId, name: fac.name, pos: fac.pos,
      passive: fac.sensorStation.passive, active: fac.sensorStation.active,
      emconActive: !!fac.activeSweep, patrol: false, alwaysOnNet: true,
    });
  }
  return out;
}

// ── TN assembly (core §6.3, D-006) ──────────────────────────────────────────

export interface TnBreakdown {
  base: number;
  mods: Array<{ label: string; value: number }>;
  tn: number;
  channel: SensorChannel;
}

export function computeDetectionTN(
  s: TruthState, target: Formation, channel: SensorChannel, night: boolean,
): TnBreakdown {
  const mods: Array<{ label: string; value: number }> = [];
  const add = (label: string, value: number) => { if (value !== 0) mods.push({ label, value }); };

  const pos = target.pos as GroundPos;
  const hex: Hex | undefined = s.theaters[pos.theaterId]?.hexes[hexKey(pos.q, pos.r)];
  const t = target.transient ?? { moved: 'NONE' as const, onRoad: false, fired: false };

  // motion
  if (t.moved === 'NORMAL') add('moving', SIG_MODS.MOVING);
  if (t.moved === 'FORCED') add('forced march', SIG_MODS.FORCED_MARCH);
  if (t.moved === 'SPRINT') add('sprinting', SIG_MODS.SPRINT);
  if (t.moved === 'CAUTIOUS') add('cautious movement', SIG_MODS.MOVE_CAUTIOUS); // D-006
  if (t.moved !== 'NONE' && t.onRoad) add('road movement', SIG_MODS.ROAD_MOVEMENT);
  if (t.fired) add('fired this turn', SIG_MODS.FIRED_THIS_TURN);

  // posture
  if (target.posture === 'HIDE') add('hide', SIG_MODS.HIDE);
  if (target.posture === 'DUG_IN' || target.posture === 'FORTIFIED') add('dug in', SIG_MODS.DUG_IN);

  // EMCON
  if (target.emcon === 'DARK') add('EMCON dark', SIG_MODS.EMCON_DARK);
  if (target.emcon === 'ACTIVE') add('EMCON active', SIG_MODS.EMCON_ACTIVE);
  // D-048: a chained relay is a big radio — direction-finding loves it
  if (isChainRelay(s, target)) add('relaying', SIG_MODS.RELAYING);

  // terrain
  if (hex) {
    const row = TERRAIN[hex.terrain];
    const infantryOnly = target.unitIds.length > 0 &&
      target.unitIds.every(id => s.units[id]?.class === 'INFANTRY');
    if (infantryOnly && row.infantrySigMod !== undefined) {
      add(`${hex.terrain.toLowerCase()} (infantry)`, row.infantrySigMod);
    } else if (row.sigMod) {
      add(hex.terrain.toLowerCase(), row.sigMod);
    }
  }

  // environment — D-006: night +2 vs all passive sensing (visual is passive)
  if (night && channel !== 'ACTIVE_SENSOR') add('night', SIG_MODS.NIGHT_PASSIVE);
  if (s.config.weather !== 'CLEAR') add('rain', SIG_MODS.RAIN);

  // equipment
  const hasAngel = target.unitIds.some(id => s.units[id]?.tags.includes('ANGEL_ECM'));
  const hasGuardian = target.unitIds.some(id => s.units[id]?.tags.includes('ECM'));
  if (hasAngel) add('Angel ECM', SIG_MODS.ECM_ANGEL);
  else if (hasGuardian) add('Guardian ECM', SIG_MODS.ECM_GUARDIAN);
  const stealthSingle = target.unitIds.length === 1 &&
    s.units[target.unitIds[0]]?.tags.includes('STEALTH');
  if (stealthSingle) add('stealth armor', SIG_MODS.STEALTH_ARMOR);

  const base = target.sigBase;
  const tn = base + mods.reduce((a, m) => a + m.value, 0);
  return { base, mods, tn, channel };
}

// ── Pair geometry: which channel can see the target? ────────────────────────

function losBlocked(s: TruthState, a: GroundPos, b: GroundPos): boolean {
  if (a.theaterId !== b.theaterId) return true;
  const line = hexLine(a, b);
  for (let i = 1; i < line.length - 1; i++) {
    const hex = s.theaters[a.theaterId]?.hexes[hexKey(line[i].q, line[i].r)];
    if (hex && TERRAIN[hex.terrain].blocksLos) return true;
  }
  return false;
}

function pickChannel(
  s: TruthState, searcher: Searcher, targetPos: GroundPos, night: boolean,
): SensorChannel | null {
  if (searcher.pos.theaterId !== targetPos.theaterId) return null;
  const d = hexDistance(searcher.pos, targetPos);
  if (searcher.emconActive && d <= searcher.active) return 'ACTIVE_SENSOR';
  if (d <= searcher.passive) return 'PASSIVE_SENSOR';
  const eyeRange = night ? SENSOR_RANGES.EYEBALL.night : SENSOR_RANGES.EYEBALL.day;
  if (searcher.kind === 'formation' && d <= eyeRange && !losBlocked(s, searcher.pos, targetPos)) {
    return 'VISUAL';
  }
  return null;
}

// ── Contact bookkeeping ──────────────────────────────────────────────────────

function contactId(observerSideId: string, targetFormationId: string): string {
  return `contact:${observerSideId}:${targetFormationId}`;
}

function sizeClassName(sigBase: number): string {
  return SIZE_CLASS_NAMES[sigBase] ?? 'unknown';
}

function composition(s: TruthState, f: Formation): string {
  const counts: Record<string, number> = {};
  for (const uid of f.unitIds) {
    const u = s.units[uid];
    if (u) counts[u.class] = (counts[u.class] ?? 0) + 1;
  }
  return Object.entries(counts).map(([k, n]) => `${n}×${k}`).join(', ') || 'unknown';
}

function ghostScatter(s: TruthState, cid: string, tick: number, pos: GroundPos): GroundPos {
  // D-008.4: deterministic hash, 7 outcomes (true hex + 6 neighbors), no cursor spend
  const pick = hashPick(s.seed, ['ghost', cid, tick], 7);
  if (pick === 6) return { ...pos };
  const d = AXIAL_DIRECTIONS[pick];
  return { ...pos, q: pos.q + d.q, r: pos.r + d.r };
}

function buildSnapshot(
  s: TruthState, cid: string, target: Formation, level: LadderLevel, tick: number,
): ContactSnapshot {
  // GHOST scatter applies on the ground grid; air positions are reported as-observed
  // (an air GHOST is vague in identity, not in radar bearing — D-010.6)
  const estPos = target.pos.kind === 'ground'
    ? (level === 1 ? ghostScatter(s, cid, tick, target.pos) : { ...target.pos })
    : structuredClone(target.pos);
  const snap: ContactSnapshot = {
    level,
    estPos,
    posErrorHexes: level === 1 && target.pos.kind === 'ground'
      ? LADDER.GHOST_POS_ERROR_HEXES : 0,
    asOfTick: tick,
  };
  if (level >= 2) {
    snap.estVector = target.lastHeadingDeg;
    // DECOY (ext): inflatable mechs and thermal balloons — the formation reads one size
    // class BIGGER on enemy sensors (lower sigBase = bigger force; floor at battalion)
    const hasDecoy = target.unitIds.some(uid => {
      const u = s.units[uid];
      return u && u.tags.includes('DECOY') && u.damage !== 'DESTROYED' && u.damage !== 'SALVAGE';
    });
    const apparentSig = hasDecoy
      ? Math.max(5, target.sigBase - RECON_TRICKS.DECOY_SIZE_CLASS_BUMP)
      : target.sigBase;
    snap.estSizeClass = sizeClassName(apparentSig);
  }
  if (level >= 3) snap.estComposition = composition(s, target);
  if (level >= 4) {
    snap.toe = target.unitIds.map(uid => {
      const u = s.units[uid];
      return { name: u.name, model: u.model, damage: u.damage,
               ammoState: u.ammoState, emcon: target.emcon };
    });
  }
  return snap;
}

function reportText(snap: ContactSnapshot, sourceName: string, tick: number): string {
  const lvl = LADDER_NAMES[snap.level];
  const p = snap.estPos;
  const where = p.kind === 'ground' ? `hex ${p.q},${p.r}`
    : p.kind === 'air' ? `air hex ${p.gridQ},${p.gridR} ${p.band}`
    : p.kind === 'node' ? `at ${p.nodeId}`
    : p.kind === 'lane' ? `on lane ${p.laneId}, ${p.progressAU.toFixed(2)} AU out, ${Math.round(p.velocityKps)} kps`
    : 'position unknown';
  const bits = [
    `T+${tick} — ${sourceName}: ${lvl}`,
    snap.estSizeClass ? `${snap.estSizeClass}-strength` : 'unidentified return',
    snap.estComposition ? `(${snap.estComposition})` : '',
    `${where}${snap.posErrorHexes ? ` ±${snap.posErrorHexes}` : ''}`,
    snap.estVector !== undefined ? `heading ${snap.estVector}°` : '',
  ].filter(Boolean);
  return bits.join(' ');
}

// ── The pass ─────────────────────────────────────────────────────────────────

/** Deterministic report id: derived from state only, never from module-level counters. */
function nextReportId(s: TruthState, tick: number, cid: string, sourceId: string): string {
  let n = 0;
  while (s.reports[`report:${tick}:${cid}:${sourceId}:${n}`]) n++;
  return `report:${tick}:${cid}:${sourceId}:${n}`;
}

/** Shared by the ground pass, satellites, the air pass (M3), and the light-lag layer (M4). */
export function registerDetection(
  s: TruthState, emit: (e: GameEvent) => void,
  observerSideId: string, target: Formation, by: number,
  source: { id: string; name: string; alwaysOnNet: boolean },
  opts?: {
    staleAsOfTick?: number;  // light lag: when this information was TRUE (DEEP SKY §4.2)
    note?: string;           // narrative payload (mass class, vector readability)
    setLevel?: boolean;      // `by` is a floor (auto-detections), not a ladder climb
  },
): void {
  const cid = contactId(observerSideId, target.id);
  const existing = s.contacts[cid];
  const newLevel = (opts?.setLevel
    ? Math.max(existing?.level ?? 0, Math.min(LADDER.MAX_LEVEL, by))
    : Math.min(LADDER.MAX_LEVEL, (existing?.level ?? 0) + by)) as LadderLevel;
  const asOf = opts?.staleAsOfTick ?? s.tick;
  const snap = buildSnapshot(s, cid, target, newLevel, s.tick);
  snap.asOfTick = asOf;

  const contact: Contact = {
    id: cid, observerSideId, targetFormationId: target.id, kind: 'STANDARD',
    level: newLevel, lastConfirmedTick: s.tick, lastFadeTick: s.tick,
    estPos: snap.estPos, posErrorHexes: snap.posErrorHexes,
    estVector: snap.estVector, estSizeClass: snap.estSizeClass,
    estComposition: snap.estComposition,
    staleAsOfTick: asOf,
    delivered: existing?.delivered,
  };
  emit({ type: 'CONTACT_UPGRADED', contact, tick: s.tick });

  // a report carries NEW information: a ladder climb or a position update.
  // Re-confirmations of a stationary LOCK refresh the ladder silently.
  const levelChanged = newLevel !== (existing?.level ?? 0);
  const posChanged = !existing ||
    JSON.stringify(existing.estPos) !== JSON.stringify(snap.estPos);
  if (!levelChanged && !posChanged) return;

  const report: ContactReport = {
    id: nextReportId(s, s.tick, cid, source.id),
    sideId: observerSideId, generatedTick: s.tick, deliveredTick: null,
    sourceFormationId: source.id, contactId: cid,
    text: reportText(snap, source.name, s.tick) + (opts?.note ? ` — ${opts.note}` : ''),
    snapshot: snap,
  };
  emit({ type: 'REPORT_QUEUED', report });

  // on-net sources feed the player map in real time (core §4.2)
  const onNet = source.alwaysOnNet ||
    (s.formations[source.id] ? isFormationOnNet(s, s.formations[source.id]) : false);
  if (onNet) emit({ type: 'REPORT_DELIVERED', reportId: report.id, tick: s.tick });
}

export function detectionPass(s: TruthState, emit: (e: GameEvent) => void): void {
  const night = isNight(s, s.tick);
  const searchers = gatherSearchers(s);
  // embarked formations are inside a carrier's hull: the CARRIER is the detectable return
  const targets = Object.values(s.formations).filter(
    f => !f.destroyed && f.pos.kind === 'ground' && !f.mounted);

  // same-hex auto LOCK (core §6.4) — mutual
  for (const a of targets) {
    for (const b of targets) {
      if (a.sideId === b.sideId) continue;
      const ap = a.pos as GroundPos, bp = b.pos as GroundPos;
      if (ap.theaterId === bp.theaterId && hexDistance(ap, bp) === 0) {
        const cid = contactId(a.sideId, b.id);
        if ((s.contacts[cid]?.level ?? 0) < LADDER.MAX_LEVEL) {
          registerDetection(s, emit, a.sideId, b, LADDER.MAX_LEVEL, // jump straight to LOCK
            { id: a.id, name: a.name, alwaysOnNet: false });
        }
      }
    }
  }

  for (const searcher of searchers) {
    for (const target of targets) {
      if (target.sideId === searcher.sideId) continue;
      const tPos = target.pos as GroundPos;
      const channel = pickChannel(s, searcher, tPos, night);
      if (!channel) continue;

      const { tn } = computeDetectionTN(s, target, channel, night);
      let mod = 0;
      if (searcher.emconActive) mod += SEARCHER_MODS.EMCON_ACTIVE;
      if (searcher.patrol) mod += SEARCHER_MODS.PATROL_ORDER;

      const r = rollDice(s.seed, s.seedCursor, '2d6');
      emit({
        type: 'DIE_ROLLED',
        roll: { id: `roll:${s.seedCursor}`, tick: s.tick,
                purpose: `detection ${searcher.name} → ${target.name} (TN ${tn}${mod ? `, +${mod}` : ''})`,
                dice: '2d6', result: r.result, seedCursor: r.nextCursor - 2 },
      });

      if (r.result + mod >= tn) {
        registerDetection(s, emit, searcher.sideId, target, LADDER.CLIMB_PER_SUCCESS,
          { id: searcher.id, name: searcher.name, alwaysOnNet: searcher.alwaysOnNet });
      }
    }

    // ECM haze: ACTIVE searchers see a 'haze' anomaly at hostile ECM bubbles (spec §3.2)
    if (searcher.emconActive) {
      for (const target of targets) {
        if (target.sideId === searcher.sideId) continue;
        const hasEcm = target.unitIds.some(id =>
          s.units[id]?.tags.includes('ECM') || s.units[id]?.tags.includes('ANGEL_ECM'));
        if (!hasEcm) continue;
        const tPos = target.pos as GroundPos;
        if (tPos.theaterId !== searcher.pos.theaterId) continue;
        if (hexDistance(searcher.pos, tPos) > searcher.active) continue;
        const cid = `haze:${searcher.sideId}:${target.id}`;
        if (s.contacts[cid]?.lastConfirmedTick === s.tick) continue;
        const isNew = !s.contacts[cid];
        const haze: Contact = {
          id: cid, observerSideId: searcher.sideId, targetFormationId: target.id,
          kind: 'ECM_HAZE', level: 1, lastConfirmedTick: s.tick, lastFadeTick: s.tick,
          estPos: { ...tPos }, posErrorHexes: 0, staleAsOfTick: s.tick,
          estComposition: 'ECM interference',
          delivered: s.contacts[cid]?.delivered,
        };
        emit({ type: 'CONTACT_UPGRADED', contact: haze, tick: s.tick });
        if (!isNew) continue; // report the anomaly once, not every sweep
        const report: ContactReport = {
          id: nextReportId(s, s.tick, cid, searcher.id),
          sideId: searcher.sideId, generatedTick: s.tick, deliveredTick: null,
          sourceFormationId: searcher.id, contactId: cid,
          text: `T+${s.tick} — ${searcher.name}: ECM haze anomaly at hex ${tPos.q},${tPos.r}`,
          snapshot: { level: 1, estPos: { ...tPos }, posErrorHexes: 0,
                      estComposition: 'ECM interference', asOfTick: s.tick },
        };
        emit({ type: 'REPORT_QUEUED', report });
        const onNet = searcher.alwaysOnNet ||
          (s.formations[searcher.id] ? isFormationOnNet(s, s.formations[searcher.id]) : false);
        if (onNet) emit({ type: 'REPORT_DELIVERED', reportId: report.id, tick: s.tick });
      }
    }
  }
}

/** Satellite passes (core §8.6): scan the 10-wide ground track on schedule. */
export function satellitePass(s: TruthState, emit: (e: GameEvent) => void): void {
  const night = isNight(s, s.tick);
  for (const sat of Object.values(s.satellites)) {
    if (!sat.alive || sat.kind !== 'RECON') continue;
    if (s.tick < sat.nextPassTick) continue;

    for (const target of Object.values(s.formations)) {
      if (target.destroyed || target.sideId === sat.sideId || target.mounted) continue;
      if (target.pos.kind !== 'ground' || target.pos.theaterId !== sat.theaterId) continue;
      const within = distanceToPath(target.pos, sat.corridor)
        <= Math.floor(SATELLITE.TRACK_WIDTH_HEXES / 2);
      if (!within) continue;

      // satellite optics are passive sensing — night applies (D-008.10)
      const { tn } = computeDetectionTN(s, target, 'PASSIVE_SENSOR', night);
      const r = rollDice(s.seed, s.seedCursor, '2d6');
      emit({
        type: 'DIE_ROLLED',
        roll: { id: `roll:${s.seedCursor}`, tick: s.tick,
                purpose: `satellite pass ${sat.id} → ${target.name} (TN ${tn})`,
                dice: '2d6', result: r.result, seedCursor: r.nextCursor - 2 },
      });
      if (r.result >= tn) {
        registerDetection(s, emit, sat.sideId, target, LADDER.CLIMB_PER_SUCCESS,
          { id: sat.id, name: `Satellite ${sat.id}`, alwaysOnNet: true });
      }
    }
    emit({ type: 'SAT_PASS', satelliteId: sat.id, tick: s.tick,
           nextPassTick: sat.nextPassTick + sat.periodPulses * CLOCK.TICKS_PER_PULSE });
  }
}

/** Ladder fade: −1 level per pulse without redetect (core §6.4). */
export function fadePass(s: TruthState, emit: (e: GameEvent) => void): void {
  for (const c of Object.values(s.contacts)) {
    let anchor = Math.max(c.lastConfirmedTick, c.lastFadeTick);
    let level = c.level;
    while (level > 0 && s.tick - anchor >= CLOCK.TICKS_PER_PULSE * LADDER.FADE_PER_PULSE) {
      level = (level - 1) as LadderLevel;
      anchor += CLOCK.TICKS_PER_PULSE;
      if (level === 0) {
        emit({ type: 'CONTACT_REMOVED', contactId: c.id, tick: anchor });
        break;
      }
      // tick = the pulse boundary where the fade logically occurred, so the
      // next fade is due one full pulse later regardless of step size
      emit({ type: 'CONTACT_FADED', contactId: c.id, level, tick: anchor });
    }
  }
}
