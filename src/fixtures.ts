/**
 * fixtures.ts — declarative campaign construction, shared by tests and the demo loader.
 */
import { BASE_SIG, RDY, SENSOR_RANGES } from './rules.js';
import type {
  CampaignConfig, Facility, Formation, Hex, Id, InfraTag, Satellite, Side,
  TerrainType, Theater, TruthState, Unit,
} from './core/types.js';
import { hexKey } from './core/types.js';

export interface HexOverride {
  q: number; r: number; terrain?: TerrainType; infra?: InfraTag[];
  objective?: Hex['objective'];
}

export function mkTheater(
  id: Id, name: string, width: number, height: number,
  defaultTerrain: TerrainType = 'CLEAR', overrides: HexOverride[] = [],
): Theater {
  const hexes: Record<string, Hex> = {};
  for (let q = 0; q < width; q++) {
    for (let r = 0; r < height; r++) {
      hexes[hexKey(q, r)] = { theaterId: id, q, r, terrain: defaultTerrain,
                              infra: [], minefieldIds: [] };
    }
  }
  for (const o of overrides) {
    const h = hexes[hexKey(o.q, o.r)];
    if (!h) continue;
    if (o.terrain) h.terrain = o.terrain;
    if (o.infra) h.infra = o.infra;
    if (o.objective) h.objective = o.objective;
  }
  return { id, name, hexes };
}

let unitSeq = 0;
export function mkUnit(p: Partial<Unit> & { sideId: Id }): Unit {
  const u: Unit = {
    id: p.id ?? `unit-${unitSeq++}`,
    sideId: p.sideId,
    name: p.name ?? `Unit ${unitSeq}`,
    model: p.model ?? 'GEN-1',
    class: p.class ?? 'MECH',
    bv: p.bv ?? 1000, pv: p.pv ?? 25,
    walkOrCruise: p.walkOrCruise ?? 4, run: p.run ?? 6, jump: p.jump ?? 0,
    damage: p.damage ?? 'OK',
    pilotIds: p.pilotIds ?? [],
    ammoState: p.ammoState ?? 'FULL',
    tags: p.tags ?? [],
  };
  // keep optional keys absent (not explicitly undefined) so JSON round-trips exactly
  if (p.safeThrust !== undefined) u.safeThrust = p.safeThrust;
  if (p.maxThrust !== undefined) u.maxThrust = p.maxThrust;
  if (p.fuel !== undefined) u.fuel = p.fuel;
  return u;
}

export function mkFormation(
  p: Partial<Formation> & { id: Id; sideId: Id; name: string; pos: Formation['pos'] },
): Formation {
  // strip explicitly-undefined keys so they don't clobber defaults
  for (const k of Object.keys(p) as (keyof typeof p)[]) {
    if (p[k] === undefined) delete p[k];
  }
  return {
    unitIds: [], facing: 0,
    omp: 4, br: 10,
    sigBase: BASE_SIG.LANCE,
    sns: { ...SENSOR_RANGES.MECH_STANDARD },
    rdy: RDY.START,
    emcon: 'PASSIVE', posture: 'NONE',
    onNet: false, standingOrderIds: [],
    supply: { lastSuppliedTick: 0, inSupply: true },
    ...p,
  };
}

export function mkSide(id: Id, name: string, commandNodes: Id[] = []): Side {
  return { id, name, vp: 0, commandNodes, reprisalsOwed: 0 };
}

export function mkFacility(
  p: Partial<Facility> & { id: Id; sideId: Id; name: string; pos: Facility['pos'] },
): Facility {
  return {
    tags: [], fuelFarmTons: 0, supplyPoints: 0,
    turnaroundCrews: { total: 1, busyUntil: [] },
    isCommandNode: false,
    ...p,
  };
}

export function mkSatellite(
  p: Partial<Satellite> & { id: Id; sideId: Id; theaterId: Id; corridor: { q: number; r: number }[] },
): Satellite {
  return {
    kind: 'RECON', periodPulses: 4, nextPassTick: 0, alive: true, knownTo: [p.sideId],
    ...p,
  };
}

export function emptyTruth(seed: string, config?: Partial<CampaignConfig>): TruthState {
  return {
    seed, tick: 0, clockMode: 'WATCH', seedCursor: 0,
    config: { name: 'Test Campaign', dawnTick: 60, duskTick: 180, weather: 'CLEAR', ...config },
    sides: {}, theaters: {}, units: {}, pilots: {}, formations: {},
    facilities: {}, satellites: {}, markers: {}, salvage: {}, refits: {},
    contacts: {}, reports: {}, orders: {}, scoutedHexes: {},
    engagements: {}, pendingEngagementId: null, handoffs: {},
    system: { nodes: {}, lanes: {}, lastSweepTick: 0 },
    emissions: {}, jumpDrives: {},
    lastScoredTick: 0,
  };
}

/** Register a formation's units and add both to truth. */
export function addFormation(truth: TruthState, f: Formation, units: Unit[]): void {
  for (const u of units) truth.units[u.id] = u;
  f.unitIds = units.map(u => u.id);
  truth.formations[f.id] = f;
}
