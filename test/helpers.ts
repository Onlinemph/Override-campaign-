/**
 * test/helpers.ts — scenario builders shared across engine tests.
 */
import {
  addFormation, emptyTruth, mkFacility, mkFormation, mkSide, mkTheater, mkUnit,
} from '../src/fixtures.js';
import type { Formation, GroundPos, Order, TruthState, Unit } from '../src/core/types.js';
import type { HexOverride } from '../src/fixtures.js';

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
