/** Stall reasons (ext): the engine explains why an order is waiting. */
import { describe, expect, it } from 'vitest';
import { stallReason } from '../../src/engine/stall.js';
import { mkFacility } from '../../src/fixtures.js';
import { addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { Order, TruthState } from '../../src/core/types.js';

function withOrder(truth: TruthState, id: string, order: Partial<Order> & { kind: Order['kind'] }) {
  const f = truth.formations[id];
  const o: Order = { id: `o-${id}`, sideId: f.sideId, formationId: id,
    issuedTick: 0, effectiveTick: 0, conditionals: [], path: [], ...order };
  truth.orders[o.id] = o;
  f.currentOrderId = o.id;
  return f;
}

describe('stallReason', () => {
  it('REARM with no source explains itself; with a stocked depot it goes quiet', () => {
    const truth = baseTruth('STALL-1');
    const f = withOrder(truth, addMechFormation(truth,
      { id: 'm1', sideId: 'blue', pos: gp(5, 5) }).id, { kind: 'REARM' });
    truth.units[f.unitIds[0]].ammoState = 'DRY';
    expect(stallReason(truth, f)).toMatch(/no stocked depot/);

    truth.facilities['depot'] = mkFacility({ id: 'depot', sideId: 'blue', name: 'Dump',
      pos: gp(5, 5), tags: ['DEPOT'], supplyPoints: 10 });
    expect(stallReason(truth, f)).toBeUndefined();

    truth.facilities['depot'].supplyPoints = 0;
    expect(stallReason(truth, f)).toMatch(/holds 0 SP/);
  });

  it('EMBARK waits for a landed ship and free bays, in words', () => {
    const truth = baseTruth('STALL-2');
    const ds = addMechFormation(truth, { id: 'ds1', sideId: 'blue', pos: gp(5, 5) });
    ds.carrier = { bays: 1, crews: 1, avFuelTons: 10 };
    const cargo = addMechFormation(truth, { id: 'cargo', sideId: 'blue', pos: gp(5, 5) });
    cargo.mounted = { carrierFormationId: 'ds1' };
    const f = withOrder(truth, addMechFormation(truth,
      { id: 'm1', sideId: 'blue', pos: gp(5, 5) }).id,
      { kind: 'EMBARK', targetFormationId: 'ds1' });
    expect(stallReason(truth, f)).toMatch(/bays are full/);

    ds.pos = { kind: 'air', gridQ: 0, gridR: 0, band: 'HIGH', altLevel: 6,
               velocity: 2, vectorDeg: 0 };
    expect(stallReason(truth, f)).toMatch(/waiting for .* to land/);
  });

  it('STRIKE without a fix, REPAIR with nowhere to go, a blocked column — all speak', () => {
    const truth = baseTruth('STALL-3', [{ q: 6, r: 5, terrain: 'WATER' }]);
    const striker = withOrder(truth, addMechFormation(truth,
      { id: 's1', sideId: 'blue', pos: gp(3, 3) }).id,
      { kind: 'STRIKE', targetContactId: 'contact:blue:ghost' });
    expect(stallReason(truth, striker)).toMatch(/no usable fix/);

    const broken = withOrder(truth, addMechFormation(truth,
      { id: 'r1', sideId: 'blue', pos: gp(9, 9) }).id, { kind: 'REPAIR' });
    truth.units[broken.unitIds[0]].damage = 'DAMAGED';
    expect(stallReason(truth, broken)).toMatch(/nowhere to repair/);

    const column = withOrder(truth, addMechFormation(truth,
      { id: 'c1', sideId: 'blue', pos: gp(5, 5) }).id,
      { kind: 'MOVE', path: [gp(6, 5), gp(7, 5)] });
    expect(stallReason(truth, column)).toMatch(/impassable/);

    // a working order says nothing
    const fine = withOrder(truth, addMechFormation(truth,
      { id: 'f1', sideId: 'blue', pos: gp(2, 9) }).id,
      { kind: 'MOVE', path: [gp(3, 9)] });
    expect(stallReason(truth, fine)).toBeUndefined();
  });
});
