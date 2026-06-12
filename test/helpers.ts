/**
 * test/helpers.ts — scenario builders shared across engine tests.
 */
import {
  addFormation, emptyTruth, mkFacility, mkFormation, mkSide, mkTheater, mkUnit,
} from '../src/fixtures.js';
import type { Formation, GroundPos, Order, TruthState, Unit } from '../src/core/types.js';
import type { HexOverride } from '../src/fixtures.js';

export { mkFacility, mkUnit };

export const T = 'theater-1';

export function gp(q: number, r: number): GroundPos {
  return { kind: 'ground', theaterId: T, q, r };
}

export function baseTruth(
  seed = 'TEST-SEED', overrides: HexOverride[] = [], width = 30, height = 20,
): TruthState {
  const truth = emptyTruth(seed);
  truth.theaters[T] = mkTheater(T, 'Test Theater', width, height, 'CLEAR', overrides);
  truth.sides['blue'] = mkSide('blue', 'Blue');
  truth.sides['red'] = mkSide('red', 'Red');
  return truth;
}

export function addMechFormation(
  truth: TruthState, p: Partial<Formation> & { id: string; sideId: string; pos: GroundPos },
  unitCount = 4, unitOverrides: Partial<Unit> = {},
): Formation {
  const f = mkFormation({ name: p.id, ...p });
  const units = Array.from({ length: unitCount }, (_, i) =>
    mkUnit({ sideId: p.sideId, name: `${p.id}-${i + 1}`, model: 'TST-1', ...unitOverrides }));
  addFormation(truth, f, units);
  return truth.formations[f.id];
}

export function moveOrder(
  id: string, f: Formation, kind: Order['kind'], path: GroundPos[], effectiveTick = 0,
  extra: Partial<Order> = {},
): Order {
  return {
    id, sideId: f.sideId, formationId: f.id,
    issuedTick: 0, effectiveTick, kind, path, conditionals: [], ...extra,
  };
}

/** Wire a system graph into truth (M4 / DEEP SKY). Lanes are named "a--b". */
export function addSystem(
  truth: TruthState,
  nodes: Array<{ id: string; type: string; name?: string; theaterId?: string; secret?: boolean }>,
  lanes: Array<[string, string, number]>,
): void {
  for (const n of nodes) {
    truth.system.nodes[n.id] = {
      id: n.id, type: n.type as never, name: n.name ?? n.id,
      surveyedBy: [], secret: n.secret ?? false,
      ...(n.theaterId ? { theaterId: n.theaterId } : {}),
    };
  }
  for (const [a, b, distanceAU] of lanes) {
    truth.system.lanes[`${a}--${b}`] = { id: `${a}--${b}`, a, b, distanceAU };
  }
}

/** A space vessel formation at a node (M4 / DEEP SKY). */
export function addVessel(
  truth: TruthState,
  p: { id: string; sideId: string; nodeId: string; count?: number;
       klass?: 'DROPSHIP' | 'JUMPSHIP' | 'WARSHIP'; tons?: number;
       tonsPerBurnDay?: number; maxThrust?: number; emcon?: 'DARK' | 'PASSIVE' | 'ACTIVE';
       withDrive?: { chargePct?: number; sail?: 'STOWED' | 'DEPLOYED';
                     chargeRateHrsTo100?: number; lfBatteryCharged?: boolean } },
): Formation {
  const count = p.count ?? 1;
  const units = Array.from({ length: count }, (_, i) => mkUnit({
    id: `${p.id}-${i + 1}`, sideId: p.sideId, name: `${p.id}-${i + 1}`,
    model: p.klass ?? 'DROPSHIP', class: p.klass ?? 'DROPSHIP',
    maxThrust: p.maxThrust ?? 4,
    fuel: { fp: 0, fpPerTon: 30, tons: p.tons ?? 80,
            tonsPerBurnDay: p.tonsPerBurnDay ?? 1.84 },
  }));
  const f = mkFormation({
    id: p.id, sideId: p.sideId, name: p.id,
    pos: { kind: 'node', nodeId: p.nodeId },
    sigBase: 8, omp: 0, emcon: p.emcon ?? 'PASSIVE',
  });
  addFormation(truth, f, units);
  if (p.withDrive) {
    for (const u of units) {
      truth.jumpDrives[u.id] = {
        vesselUnitId: u.id, chargePct: p.withDrive.chargePct ?? 0,
        chargeRateHrsTo100: p.withDrive.chargeRateHrsTo100 ?? 180,
        sail: p.withDrive.sail ?? 'STOWED', kfDamage: 'NONE',
        ...(p.withDrive.lfBatteryCharged !== undefined
          ? { lfBatteryCharged: p.withDrive.lfBatteryCharged } : {}),
      };
    }
  }
  return truth.formations[p.id];
}

/** A flight of fighters, grounded at a base or airborne (M3 / SKYWATCH). */
export function addFlight(
  truth: TruthState,
  p: { id: string; sideId: string; count?: number; klass?: 'ASF' | 'CONV_FIGHTER';
       fp?: number; tons?: number; safeThrust?: number;
       basePos?: GroundPos; homeFacilityId?: string;
       airPos?: { q: number; r: number; band?: 'DECK' | 'LOW' | 'HIGH' | 'SUBORBITAL' | 'ORBIT' };
       withPilots?: boolean },
): Formation {
  const count = p.count ?? 1;
  const units = Array.from({ length: count }, (_, i) => {
    const u = mkUnit({
      id: `${p.id}-${i + 1}`,
      sideId: p.sideId, name: `${p.id}-${i + 1}`, model: p.klass ?? 'ASF',
      class: p.klass ?? 'ASF', safeThrust: p.safeThrust ?? 6,
      fuel: { fp: p.fp ?? 400, fpPerTon: 80, tons: p.tons ?? (p.fp ?? 400) / 80 },
    });
    if (p.withPilots) {
      const pilot = { id: `${p.id}-pilot-${i + 1}`, name: `${p.id} pilot ${i + 1}`,
                      gunnery: 4, piloting: 5, kills: 0, ace: false, fatigue: 0,
                      status: 'OK' as const };
      truth.pilots[pilot.id] = pilot;
      u.pilotIds = [pilot.id];
    }
    return u;
  });
  const pos: Formation['pos'] = p.airPos
    ? { kind: 'air', gridQ: p.airPos.q, gridR: p.airPos.r, band: p.airPos.band ?? 'HIGH',
        altLevel: 6, velocity: 2, vectorDeg: 0 }
    : p.basePos!;
  const f = mkFormation({
    id: p.id, sideId: p.sideId, name: p.id, pos,
    sigBase: count >= 3 ? 6 : count === 2 ? 8 : 9,
  });
  f.air = { phase: p.airPos ? 'ENROUTE' : 'GROUNDED', speed: 'CRUISE',
            homeFacilityId: p.homeFacilityId };
  addFormation(truth, f, units);
  return truth.formations[p.id];
}
