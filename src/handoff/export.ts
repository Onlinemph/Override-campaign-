/**
 * handoff/export.ts — build a HandoffPackage from a pending engagement (core §7.2; spec §3.6).
 *
 * The operational state dictates the tabletop setup: map from terrain, entry edges from
 * approach vectors, intel→initiative, posture→hidden/fortified, RDY→TN penalty, plus
 * in-range off-board artillery and on-net reinforcements. No combat is computed here.
 */
import {
  ARTILLERY_TAG_RANGE, COMBAT, DEEPSKY, ENGAGEMENT, RDY, RECON_TRICKS, SKYWATCH,
} from '../rules.js';
import type {
  AirPos, Engagement, Formation, GroundPos, HandoffPackage, Id, TruthState,
} from '../core/types.js';
import { hexKey } from '../core/types.js';
import { hexDistance, neighbors } from '../hex/axial.js';
import { jokerBingo, minFp, minSafeThrust } from '../engine/air.js';

const EDGES = ['E', 'NE', 'NW', 'W', 'SW', 'SE'] as const;
// map a heading (0°=+q/E, CCW) to one of six entry edges
function edgeFromHeading(deg: number | undefined): HandoffPackage['perSide'][number]['entryEdge'] {
  if (deg === undefined) return 'ANY_HALF';
  const sixth = Math.round(((deg % 360) / 60)) % 6;
  const e = EDGES[sixth];
  // collapse the renderer's 6 compass spokes onto the package's N/NE/SE/S/SW/NW vocab
  const map: Record<string, HandoffPackage['perSide'][number]['entryEdge']> = {
    E: 'SE', NE: 'NE', NW: 'NW', W: 'SW', SW: 'SW', SE: 'SE',
  };
  return map[e] ?? 'ANY_HALF';
}

function rdyPenalty(rdy: number): 0 | 1 | 2 {
  const band = RDY.BANDS.find(b => rdy >= b.min && rdy <= b.max);
  return (band?.tnPenalty ?? 0) as 0 | 1 | 2;
}

function bestLadder(s: TruthState, sideId: Id, enemyFormationIds: Id[]): number {
  let best = 0;
  for (const c of Object.values(s.contacts)) {
    if (c.observerSideId === sideId && enemyFormationIds.includes(c.targetFormationId)) {
      best = Math.max(best, c.level);
    }
  }
  return best;
}

function pilotSkills(s: TruthState, unitId: Id): [number, number] {
  const u = s.units[unitId];
  const pilot = u?.pilotIds.map(id => s.pilots[id]).find(Boolean);
  return pilot
    ? [pilot.gunnery, pilot.piloting]
    : [COMBAT.PILOT_DEFAULT_GUNNERY, COMBAT.PILOT_DEFAULT_PILOTING];
}

function avgHeading(s: TruthState, formationIds: Id[]): number | undefined {
  const hs = formationIds.map(id => s.formations[id]?.lastHeadingDeg).filter(
    (h): h is number => h !== undefined);
  if (hs.length === 0) return undefined;
  return hs[0]; // representative spearhead heading
}

function sideBlock(
  s: TruthState, hex: GroundPos, ownIds: Id[], enemyIds: Id[],
  sideId: Id, deploysFirst: boolean, initiativeBonus: number,
): HandoffPackage['perSide'][number] {
  const formations = ownIds.map(id => s.formations[id]).filter(Boolean);
  const units = formations.flatMap(f => f.unitIds.map(uid => {
    const u = s.units[uid];
    return {
      unitId: uid, ammoState: u.ammoState, damage: u.damage,
      pilotSkills: pilotSkills(s, uid),
    };
  }));

  const hidden = formations.some(f => f.posture === 'HIDE');
  const fortified = formations.some(f => f.posture === 'DUG_IN' || f.posture === 'FORTIFIED');
  const worstRdy = Math.min(10, ...formations.map(f => f.rdy));
  // a live C3 master on the table: the network is worth initiative (ext)
  const c3Bonus = formations.some(f => f.unitIds.some(uid => {
    const u = s.units[uid];
    return u && u.tags.includes('C3M') && u.damage !== 'DESTROYED' && u.damage !== 'SALVAGE';
  })) ? RECON_TRICKS.C3_INITIATIVE_BONUS : 0;
  initiativeBonus += c3Bonus;

  // off-board artillery: friendly arty units (any side formation) in range of the hex
  const artillery: Array<{ unitId: Id; rangeHexesRemaining: number }> = [];
  // reinforcements: friendly on-net formations not already in the battle, within range
  const reinforcements: Array<{ formationId: Id; arrivesTurn: number; edge: string }> = [];
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || f.sideId !== sideId || f.pos.kind !== 'ground') continue;
    if (f.pos.theaterId !== hex.theaterId) continue;
    const d = hexDistance(f.pos, hex);
    if (!ownIds.includes(f.id) && f.onNet && d > 0) {
      reinforcements.push({ formationId: f.id, arrivesTurn: d * ENGAGEMENT.REINFORCE_TURNS_PER_HEX,
                            edge: 'ANY_HALF' });
    }
    for (const uid of f.unitIds) {
      const u = s.units[uid];
      if (!u) continue;
      for (const tag of u.tags) {
        const range = ARTILLERY_TAG_RANGE[tag];
        if (range !== undefined && d <= range) {
          artillery.push({ unitId: uid, rangeHexesRemaining: range - d });
        }
      }
    }
  }

  // off-board air (ext): friendly flights holding a ground-attack mission within call
  // range of the battle theater's air hex. arrivesTurn 0 = already overhead.
  const airOnStation: Array<{ formationId: Id; arrivesTurn: number; fpOnStation: number }> = [];
  const battleAirHex = s.config.airHexByTheater?.[hex.theaterId] ?? { q: 0, r: 0 };
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || f.sideId !== sideId || f.pos.kind !== 'air') continue;
    const o = f.currentOrderId ? s.orders[f.currentOrderId] : undefined;
    if (!o || o.completed || (o.kind !== 'CAS' && o.kind !== 'STRIKE_AIR')) continue;
    const d = hexDistance({ q: f.pos.gridQ, r: f.pos.gridR }, battleAirHex);
    if (d > SKYWATCH.CAS_ON_CALL.MAX_AIR_HEXES) continue;
    airOnStation.push({
      formationId: f.id,
      arrivesTurn: Math.ceil(d / SKYWATCH.CAS_ON_CALL.HEXES_PER_TURN),
      fpOnStation: minFp(s, f),
    });
  }
  airOnStation.sort((a, b) => a.formationId.localeCompare(b.formationId));

  return {
    sideId,
    entryEdge: edgeFromHeading(avgHeading(s, ownIds)),
    deploysFirst,
    initiativeBonus,
    initiativeBonusTurns: initiativeBonus > 0 ? ENGAGEMENT.INTEL_INITIATIVE_TURNS : 0,
    hiddenSetup: hidden,
    fortified,
    rdyTnPenalty: rdyPenalty(worstRdy),
    units,
    offboard: { artillery, airOnStation, reinforcements },
  };
}

export function buildHandoff(s: TruthState, eng: Engagement): HandoffPackage {
  if (eng.domain === 'AIR') return buildAirHandoff(s, eng);
  if (eng.domain === 'SPACE') return buildSpaceHandoff(s, eng);
  const hex = eng.hex!;
  const terrain = s.theaters[hex.theaterId]?.hexes[hexKey(hex.q, hex.r)]?.terrain ?? 'CLEAR';
  const neighborTerrain = neighbors(hex)
    .map(h => s.theaters[hex.theaterId]?.hexes[hexKey(h.q, h.r)]?.terrain)
    .filter((t): t is NonNullable<typeof t> => !!t);
  const sheetsHint = [...new Set([terrain, ...neighborTerrain])];

  // intel = initiative (core §7.2.3): each level of advantage = +1 init for 3 turns,
  // disadvantaged side deploys first
  const attackerLadder = bestLadder(s, eng.attackerSideId, eng.defenderFormationIds);
  const defenderLadder = bestLadder(s, eng.defenderSideId, eng.attackerFormationIds);
  const attackerBonus = Math.max(0, attackerLadder - defenderLadder) * ENGAGEMENT.INTEL_INITIATIVE_PER_LEVEL;
  const defenderBonus = Math.max(0, defenderLadder - attackerLadder) * ENGAGEMENT.INTEL_INITIATIVE_PER_LEVEL;

  const specialRules: string[] = [];
  if (eng.trigger === 'STRIKE') specialRules.push('STRIKE');
  if (eng.trigger === 'SCREEN') specialRules.push('SCREEN_INTERCEPT');

  const pkg: HandoffPackage = {
    id: `handoff:${eng.id}`,
    tick: s.tick,
    table: 'GROUND',
    mapSpec: { sheetsHint },
    perSide: [
      sideBlock(s, hex, eng.attackerFormationIds, eng.defenderFormationIds,
        eng.attackerSideId, defenderBonus > 0, attackerBonus),
      sideBlock(s, hex, eng.defenderFormationIds, eng.attackerFormationIds,
        eng.defenderSideId, attackerBonus > 0, defenderBonus),
    ],
    specialRules,
  };
  // ambush/fortified flavor onto specialRules from the resolved side blocks
  if (pkg.perSide.some(p => p.hiddenSetup)) pkg.specialRules.push('HIDDEN_SETUP');
  if (pkg.perSide.some(p => p.fortified)) pkg.specialRules.push('FORTIFIED');
  return pkg;
}

// ════════════════════════════════════════════════════════════════════════════
// THE MERGE — air handoff (SKYWATCH §7)
// Map, vectors, energy, and fuel; then the table takes over.
// ════════════════════════════════════════════════════════════════════════════

function mergeTable(band: AirPos['band']): HandoffPackage['table'] {
  if (band === 'ORBIT' || band === 'SUBORBITAL') return 'SPACE';
  if (band === 'DECK') return 'GROUND_WITH_AIR';
  return 'LOW_ALT_ATMO'; // HIGH / LOW: low-altitude map with atmospheric rules
}

/** Starting velocity = transit mode (§7.2): cruise 2, dash = Safe Thrust. */
function entryVelocity(s: TruthState, f: Formation): number {
  return f.air?.speed === 'DASH' ? minSafeThrust(s, f) : SKYWATCH.ENTRY_VELOCITY_CRUISE;
}

function airSideBlock(
  s: TruthState, formationIds: Id[], sideId: Id, deploysFirst: boolean,
): HandoffPackage['perSide'][number] {
  const formations = formationIds.map(id => s.formations[id]).filter(Boolean);
  const units = formations.flatMap(f => {
    const { joker, bingo } = jokerBingo(s, f);
    const vel = entryVelocity(s, f);
    const alt = f.pos.kind === 'air' ? f.pos.altLevel : 0;
    return f.unitIds.map(uid => {
      const u = s.units[uid];
      return {
        unitId: uid,
        velocity: vel,
        altLevel: alt,
        // ledger FP rides onto the table 1:1 (D-010.3 — the §12 worked day is the law);
        // the ×2/÷2 constants exist for mid-battle map transitions
        fpOnTable: u.fuel?.fp,
        jokerFp: Math.round(joker * 100) / 100,
        bingoFp: Math.round(bingo * 100) / 100,
        ammoState: u.ammoState, damage: u.damage,
        pilotSkills: pilotSkills(s, uid),
      };
    });
  });
  const heading = formations[0]?.pos.kind === 'air'
    ? (formations[0].pos as AirPos).vectorDeg : undefined;
  const worstRdy = Math.min(10, ...formations.map(f => f.rdy));
  return {
    sideId,
    entryEdge: deploysFirst ? edgeFromHeading(heading) : 'ANY_HALF', // bounced side is pinned
    deploysFirst,
    initiativeBonus: 0, // in the air, energy is initiative (§7.3), not the intel ladder
    initiativeBonusTurns: 0,
    hiddenSetup: false, fortified: false,
    rdyTnPenalty: rdyPenalty(worstRdy),
    units,
    offboard: { artillery: [], airOnStation: [], reinforcements: [] },
  };
}

export function buildAirHandoff(s: TruthState, eng: Engagement): HandoffPackage {
  const pos = eng.airPos!;
  const atkLadder = bestLadder(s, eng.attackerSideId, eng.defenderFormationIds);
  const defLadder = bestLadder(s, eng.defenderSideId, eng.attackerFormationIds);
  // surprise (§7.2): CONTACT+ versus ≤GHOST ⇒ the blind side sets up first and the
  // sighted side enters anywhere on its half's edges after seeing that deployment
  const atkBounced = defLadder >= 3 && atkLadder <= 1;
  const defBounced = atkLadder >= 3 && defLadder <= 1;

  const sides = [
    airSideBlock(s, eng.attackerFormationIds, eng.attackerSideId, atkBounced),
    airSideBlock(s, eng.defenderFormationIds, eng.defenderSideId, defBounced),
  ];

  // Energy State = starting velocity + altitude (§7.3): higher wins init ties for the
  // first 3 turns and may decline the first head-to-head pass.
  const energyOf = (ids: Id[]) => Math.max(0, ...ids.map(id => {
    const f = s.formations[id];
    return entryVelocity(s, f) + (f.pos.kind === 'air' ? f.pos.altLevel : 0);
  }));
  const atkEnergy = energyOf(eng.attackerFormationIds);
  const defEnergy = energyOf(eng.defenderFormationIds);

  const specialRules = [
    `ENERGY:${eng.attackerSideId}=${atkEnergy}`,
    `ENERGY:${eng.defenderSideId}=${defEnergy}`,
  ];
  if (atkEnergy !== defEnergy) {
    const higher = atkEnergy > defEnergy ? eng.attackerSideId : eng.defenderSideId;
    specialRules.push(
      `HIGHER_ENERGY:${higher} (wins init ties ${SKYWATCH.ENERGY_INIT_TIE_TURNS} turns, may decline first pass)`);
  }
  if (atkBounced || defBounced) {
    specialRules.push(`BOUNCE:${atkBounced ? eng.attackerSideId : eng.defenderSideId} deploys first`);
  }
  // ace callsigns are psychological warfare (§8.3)
  for (const fid of [...eng.attackerFormationIds, ...eng.defenderFormationIds]) {
    const f = s.formations[fid];
    for (const uid of f?.unitIds ?? []) {
      for (const pid of s.units[uid]?.pilotIds ?? []) {
        const p = s.pilots[pid];
        if (p?.ace) specialRules.push(`ACE:${f.sideId}:${p.name}`);
      }
    }
  }
  specialRules.push(`BINGO_DISENGAGE_WITHIN:${SKYWATCH.BINGO_DISENGAGE_TURNS}_TURNS`);

  return {
    id: `handoff:${eng.id}`,
    tick: s.tick,
    table: mergeTable(pos.band),
    mapSpec: { sheetsHint: [`${pos.band} band merge at air hex ${pos.gridQ},${pos.gridR}`] },
    perSide: sides,
    specialRules,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// THE CAPITAL HANDOFF — space engagements (DEEP SKY §6)
// Map, vectors & velocities, tactical FP from the burn-day ledger, intel = initiative.
// ════════════════════════════════════════════════════════════════════════════

function spaceSideBlock(
  s: TruthState, formationIds: Id[], sideId: Id,
  deploysFirst: boolean, initiativeBonus: number,
): HandoffPackage['perSide'][number] {
  const formations = formationIds.map(id => s.formations[id]).filter(Boolean);
  const units = formations.flatMap(f => {
    const vel = f.pos.kind === 'lane' ? Math.round(f.pos.velocityKps) : 0;
    return f.unitIds.map(uid => {
      const u = s.units[uid];
      // tactical FP from the burn-day ledger: tons × the sheet's tactical rate (§3)
      const fpPerTon = u.fuel?.fpPerTon ?? DEEPSKY.TACTICAL_FP_PER_TON_LARGE;
      return {
        unitId: uid,
        velocity: vel,
        fpOnTable: u.fuel ? Math.round(u.fuel.tons * fpPerTon) : undefined,
        ammoState: u.ammoState, damage: u.damage,
        pilotSkills: pilotSkills(s, uid),
      };
    });
  });
  const worstRdy = Math.min(10, ...formations.map(f => f.rdy));
  return {
    sideId,
    entryEdge: 'ANY_HALF',
    deploysFirst,
    initiativeBonus,
    initiativeBonusTurns: initiativeBonus > 0 ? DEEPSKY.FRESHER_LIGHT_INIT_TURNS : 0,
    hiddenSetup: false, fortified: false,
    rdyTnPenalty: rdyPenalty(worstRdy),
    units,
    offboard: { artillery: [], airOnStation: [], reinforcements: [] },
  };
}

/** Staleness of a side's freshest contact on the enemy force, in ticks (∞ if blind). */
function lightFreshness(s: TruthState, sideId: Id, enemyIds: Id[]): number {
  let best = Infinity;
  for (const c of Object.values(s.contacts)) {
    if (c.observerSideId === sideId && enemyIds.includes(c.targetFormationId) && c.level >= 1) {
      best = Math.min(best, s.tick - c.staleAsOfTick);
    }
  }
  return best;
}

export function buildSpaceHandoff(s: TruthState, eng: Engagement): HandoffPackage {
  const cls = eng.classification;
  // intel = initiative (§6): the side with fresher light at commit gets +1 init, 3 turns
  const atkStale = lightFreshness(s, eng.attackerSideId, eng.defenderFormationIds);
  const defStale = lightFreshness(s, eng.defenderSideId, eng.attackerFormationIds);
  const atkBonus = atkStale < defStale ? DEEPSKY.FRESHER_LIGHT_INIT_BONUS : 0;
  const defBonus = defStale < atkStale ? DEEPSKY.FRESHER_LIGHT_INIT_BONUS : 0;
  // total surprise: an undetected attacker opening fire uses the bounce rules (§6)
  const defBlind = !Number.isFinite(defStale);

  const specialRules: string[] = [];
  if (cls) {
    specialRules.push(cls.type === 'SLASH'
      ? `SLASH:${cls.slashTurns}_TURNS`
      : cls.type);
    specialRules.push(`MM:${cls.mm.toFixed(2)}_BURN_DAYS`,
                      `VELOCITY_GAP:${cls.gapBurnDays.toFixed(2)}_BURN_DAYS`,
                      `MARGIN:${cls.marginBurnDays.toFixed(2)}_BURN_DAYS`);
    if (cls.type === 'MATCHED') specialRules.push('BOARDING_POSSIBLE_IF_CRIPPLED');
    if (cls.type === 'BLOCKADE') specialRules.push('DEFENDER_PICKS_RANGE_BRACKET');
  }
  if (defBlind) specialRules.push(`BOUNCE:${eng.defenderSideId} deploys first (total surprise)`);

  const nodeName = cls?.nodeId ? s.system.nodes[cls.nodeId]?.name : undefined;
  return {
    id: `handoff:${eng.id}`,
    tick: s.tick,
    table: 'SPACE',
    mapSpec: { sheetsHint: ['space map, SO capital rules'], nodeName },
    perSide: [
      spaceSideBlock(s, eng.attackerFormationIds, eng.attackerSideId, defBlind ? false : defBonus > atkBonus, atkBonus),
      spaceSideBlock(s, eng.defenderFormationIds, eng.defenderSideId, defBlind || atkBonus > defBonus, defBonus),
    ],
    specialRules,
  };
}
