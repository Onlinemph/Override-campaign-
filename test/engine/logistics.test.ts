/** M2 — RDY recovery, Dig In, supply attrition (core §3.2, §4.1, §10). */
import { describe, expect, it } from 'vitest';
import { maintenancePass } from '../../src/engine/logistics.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { CLOCK } from '../../src/rules.js';
import { mkFacility } from '../../src/fixtures.js';
import { addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { Order, TruthState } from '../../src/core/types.js';

function run(truth: TruthState, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  maintenancePass(truth, dt, e => { events.push(e); applyEvent(truth, e); });
  return events;
}
function activate(truth: TruthState, order: Order) {
  truth.orders[order.id] = order;
  truth.formations[order.formationId].currentOrderId = order.id;
}

describe('M2 — logistics & upkeep', () => {
  it('REST recovers +2 RDY/pulse in supply, +1 out of supply', () => {
    const truth = baseTruth();
    truth.clockMode = 'PULSE';
    const f = addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(5, 5) });
    f.rdy = 4; f.supply.inSupply = true;
    activate(truth, moveOrder('o', f, 'REST', []));
    run(truth, CLOCK.TICKS_PER_PULSE);
    expect(truth.formations['f'].rdy).toBe(6);

    truth.formations['f'].supply.inSupply = false;
    run(truth, CLOCK.TICKS_PER_PULSE);
    expect(truth.formations['f'].rdy).toBe(7);
  });

  it('REST never exceeds the RDY cap', () => {
    const truth = baseTruth();
    truth.clockMode = 'PULSE';
    const f = addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(5, 5) });
    f.rdy = 9;
    activate(truth, moveOrder('o', f, 'REST', []));
    run(truth, CLOCK.TICKS_PER_PULSE);
    expect(truth.formations['f'].rdy).toBe(10);
  });

  it('DIG_IN completes to DUG_IN after 2 pulses and finishes the order (core §4.1)', () => {
    const truth = baseTruth();
    truth.clockMode = 'PULSE';
    const f = addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(5, 5) });
    f.posture = 'DIGGING';
    activate(truth, moveOrder('o', f, 'DIG_IN', []));

    run(truth, CLOCK.TICKS_PER_PULSE); // 1 pulse — not yet
    expect(truth.formations['f'].posture).toBe('DIGGING');
    run(truth, CLOCK.TICKS_PER_PULSE); // 2 pulses — dug in
    expect(truth.formations['f'].posture).toBe('DUG_IN');
    expect(truth.orders['o'].completed).toBe(true);
  });

  it('engineers halve the dig-in time (1 pulse)', () => {
    const truth = baseTruth();
    truth.clockMode = 'PULSE';
    const f = addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(5, 5) },
      4, { tags: ['ENGINEER'] });
    f.posture = 'DIGGING';
    activate(truth, moveOrder('o', f, 'DIG_IN', []));
    run(truth, CLOCK.TICKS_PER_PULSE);
    expect(truth.formations['f'].posture).toBe('DUG_IN');
  });

  it('out of supply: a daily tick with no depot in range costs −1 RDY (core §10.2)', () => {
    const truth = baseTruth();
    const f = addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(5, 5) });
    f.rdy = 8;
    truth.tick = CLOCK.TICKS_PER_DAY; // a full day since lastSuppliedTick (0)
    run(truth, CLOCK.TICKS_PER_WATCH);
    expect(truth.formations['f'].supply.inSupply).toBe(false);
    expect(truth.formations['f'].rdy).toBe(7);
  });

  it('in supply: a stocked depot within range keeps the formation supplied, no attrition', () => {
    const truth = baseTruth();
    const f = addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(5, 5) });
    f.rdy = 8;
    truth.facilities['depot'] = mkFacility({
      id: 'depot', sideId: 'blue', name: 'Depot', pos: gp(10, 5),
      tags: ['DEPOT'], supplyPoints: 30 });
    truth.tick = CLOCK.TICKS_PER_DAY;
    run(truth, CLOCK.TICKS_PER_WATCH);
    expect(truth.formations['f'].supply.inSupply).toBe(true);
    expect(truth.formations['f'].rdy).toBe(8);
  });
});
