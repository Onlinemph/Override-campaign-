/**
 * handoff/export.ts — build a HandoffPackage from a pending engagement (core §7.2; spec §3.6).
 *
 * The operational state dictates the tabletop setup: map from terrain, entry edges from
 * approach vectors, intel→initiative, posture→hidden/fortified, RDY→TN penalty, plus
 * in-range off-board artillery and on-net reinforcements. No combat is computed here.
 */
import { ARTILLERY_TAG_RANGE, COMBAT, ENGAGEMENT, RDY } from '../rules.js';
import type {
  Engagement, Formation, GroundPos, HandoffPackage, Id, TruthState,
} from '../core/types.js';
import { hexKey } from '../core/types.js';
import { hexDistance, neighbors } from '../hex/axial.js';

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
    offboard: { artillery, airOnStation: [], reinforcements },
  };
}

export function buildHandoff(s: TruthState, eng: Engagement): HandoffPackage {
  const hex = eng.hex;
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
