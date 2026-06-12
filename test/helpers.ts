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
