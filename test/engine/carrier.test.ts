/** Carrier carry pass — embarked units ride their carrier (ext: the DropShip story). */
import { describe, expect, it } from 'vitest';
import { carrierPass, samePos } from '../../src/engine/carrier.js';
import { movementPass } from '../../src/engine/movement.js';
import { detectionPass } from '../../src/engine/detection.js';
import { maintenancePass } from '../../src/engine/logistics.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { CLOCK } from '../../src/rules.js';
import { addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { GroundPos, TruthState } from '../../src/core/types.js';

function run(truth: TruthState, pass: (s: TruthState, emit: (e: GameEvent) => void) => void): GameEvent[] {
  const events: GameEvent[] = [];
  const emit = (e: GameEvent) => { events.push(e); applyEvent(truth, e); };
  pass(truth, emit);
  return events;
}

function posOf(truth: TruthState, id: string): GroundPos {
  return truth.formations[id].pos as GroundPos;
}

describe('carrier carry pass', () => {
  it('embarked formation snaps to its carrier position', () => {
    const truth = baseTruth('CARRY-SEED');
    const carrier = addMechFormation(truth, { id: 'ds1', sideId: 'blue', pos: gp(7, 9) });
    carrier.carrier = { bays: 4, crews: 2, avFuelTons: 40 };
    const lance = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(2, 2) });
    lance.mounted = { carrierFormationId: 'ds1' };

    const evs = run(truth, carrierPass);
    expect(evs.map(e => e.type)).toContain('MOUNT_MOVED');
    expect(posOf(truth, 'm1')).toEqual(gp(7, 9));
  });

  it('parked carrier emits nothing (already co-located)', () => {
    const truth = baseTruth('CARRY-SEED');
    addMechFormation(truth, { id: 'ds1', sideId: 'blue', pos: gp(7, 9) });
    const lance = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(7, 9) });
    lance.mounted = { carrierFormationId: 'ds1' };

    const evs = run(truth, carrierPass);
    expect(evs).toHaveLength(0);
  });

  it('embarked unit does not move on its own orders', () => {
    const truth = baseTruth('CARRY-SEED');
    addMechFormation(truth, { id: 'ds1', sideId: 'blue', pos: gp(7, 9) });
    const lance = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(7, 9), omp: 20 });
    lance.mounted = { carrierFormationId: 'ds1' };
    const order = moveOrder('o1', lance, 'MOVE', [gp(8, 9), gp(9, 9)]);
    truth.orders[order.id] = order;
    lance.currentOrderId = order.id;

    const evs = run(truth, (s, emit) => movementPass(s, 10, emit));
    expect(evs).toHaveLength(0);
    expect(posOf(truth, 'm1')).toEqual(gp(7, 9)); // stayed with the carrier
  });

  it('a destroyed carrier strands its embarked units at the last hex', () => {
    const truth = baseTruth('CARRY-SEED');
    const carrier = addMechFormation(truth, { id: 'ds1', sideId: 'blue', pos: gp(7, 9) });
    carrier.destroyed = true;
    const lance = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(7, 9) });
    lance.mounted = { carrierFormationId: 'ds1' };

    const evs = run(truth, carrierPass);
    expect(evs.map(e => e.type)).toContain('MOUNT_CHANGED');
    expect(truth.formations['m1'].mounted).toBeUndefined();
    expect(posOf(truth, 'm1')).toEqual(gp(7, 9)); // left where the carrier fell
  });

  it('an embarked formation is not independently detectable — the carrier is the return', () => {
    const truth = baseTruth('CARRY-SEED');
    addMechFormation(truth, { id: 'ds1', sideId: 'blue', pos: gp(7, 9) });
    const lance = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(7, 9) });
    lance.mounted = { carrierFormationId: 'ds1' };
    // an enemy standing in the SAME hex: normally an instant mutual LOCK
    addMechFormation(truth, { id: 'red1', sideId: 'red', pos: gp(7, 9) });

    run(truth, detectionPass);
    expect(truth.contacts['contact:red:m1']).toBeUndefined();  // cargo invisible in the bay
    expect(truth.contacts['contact:blue:red1']).toBeDefined(); // the carrier still sees
    expect(truth.contacts['contact:red:ds1']).toBeDefined();   // and is seen
  });

  it('an embarked formation is sustained by the ship — no supply draw, no starvation', () => {
    const truth = baseTruth('CARRY-SEED');
    addMechFormation(truth, { id: 'ds1', sideId: 'blue', pos: gp(7, 9) });
    const lance = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(7, 9) });
    lance.mounted = { carrierFormationId: 'ds1' };
    truth.tick = CLOCK.TICKS_PER_DAY; // a full day out, nowhere near a depot

    run(truth, (s, emit) => maintenancePass(s, 1, emit));
    expect(truth.formations['m1'].supply.inSupply).toBe(true);
    expect(truth.formations['m1'].rdy).toBe(10); // no out-of-supply RDY bleed
  });

  it('samePos distinguishes kinds and coordinates', () => {
    expect(samePos(gp(1, 1), gp(1, 1))).toBe(true);
    expect(samePos(gp(1, 1), gp(1, 2))).toBe(false);
    expect(samePos(gp(1, 1), { kind: 'node', nodeId: 'n1' })).toBe(false);
    expect(samePos({ kind: 'node', nodeId: 'n1' }, { kind: 'node', nodeId: 'n1' })).toBe(true);
  });
});
