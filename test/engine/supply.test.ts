/** M7 — path-based supply, SP economy, convoy pipeline & interdiction (core §10). */
import { describe, expect, it } from 'vitest';
import { maintenancePass } from '../../src/engine/logistics.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { CLOCK } from '../../src/rules.js';
import { mkFacility } from '../../src/fixtures.js';
import { addMechFormation, baseTruth, gp, T } from '../helpers.js';
import type { Order, TruthState } from '../../src/core/types.js';

function run(truth: TruthState, dt: number = CLOCK.TICKS_PER_WATCH): GameEvent[] {
  const events: GameEvent[] = [];
  maintenancePass(truth, dt, e => { events.push(e); applyEvent(truth, e); });
  return events;
}
function depot(truth: TruthState, id: string, pos: ReturnType<typeof gp>, sp = 30) {
  truth.facilities[id] = mkFacility({ id, sideId: 'blue', name: id, pos, tags: ['DEPOT'], supplyPoints: sp });
}
// a road from the depot at 2,5 out to ~26,5 so a line can exist within budget
function roadLine(): { q: number; r: number; infra: ('ROAD')[] }[] {
  return Array.from({ length: 28 }, (_, i) => ({ q: i, r: 5, infra: ['ROAD'] as ('ROAD')[] }));
}

describe('M7 — path-based supply & the SP economy', () => {
  it('a road line draws SP daily from the depot; the depot drains', () => {
    const truth = baseTruth('SUP-1', roadLine(), 40);
    depot(truth, 'd', gp(2, 5), 30);
    addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(20, 5) });
    truth.tick = CLOCK.TICKS_PER_DAY;
    run(truth);
    expect(truth.formations['f'].supply.inSupply).toBe(true);
    expect(truth.facilities['d'].supplyPoints).toBe(29); // 1 SP drawn
  });

  it('beyond the 30-cost line (off-road doubles), no supply → RDY attrition', () => {
    // no roads: off-road costs 2/hex, so 20 hexes = 40 cost > 30 budget
    const truth = baseTruth('SUP-2');
    depot(truth, 'd', gp(2, 5), 30);
    const f = addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(22, 5) });
    f.rdy = 8;
    truth.tick = CLOCK.TICKS_PER_DAY;
    run(truth);
    expect(truth.formations['f'].supply.inSupply).toBe(false);
    expect(truth.formations['f'].rdy).toBe(7);
  });

  it('interdiction: an enemy astride the only road cuts the line', () => {
    // a causeway: a 3-row map, water above and below, the road the only dry passage
    const causeway = [];
    for (let q = 0; q < 28; q++) {
      causeway.push({ q, r: 0, terrain: 'WATER' as const });
      causeway.push({ q, r: 1, infra: ['ROAD' as const] });
      causeway.push({ q, r: 2, terrain: 'WATER' as const });
    }
    const truth = baseTruth('SUP-3', causeway, 28, 3);
    depot(truth, 'd', gp(2, 1), 30);
    addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(20, 1) });
    truth.tick = CLOCK.TICKS_PER_DAY;
    run(truth);
    expect(truth.formations['f'].supply.inSupply).toBe(true); // clear causeway first

    // a raider parks on the causeway — there is no way around
    addMechFormation(truth, { id: 'red-raider', sideId: 'red', pos: gp(11, 1) });
    truth.tick = CLOCK.TICKS_PER_DAY * 2;
    run(truth);
    expect(truth.formations['f'].supply.inSupply).toBe(false); // line cut → starved
  });

  it('a fighting day costs double SP', () => {
    const truth = baseTruth('SUP-4', roadLine(), 40);
    depot(truth, 'd', gp(2, 5), 30);
    const f = addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(10, 5) });
    f.lastBattleTick = CLOCK.TICKS_PER_DAY - 5; // fought within the last day
    truth.tick = CLOCK.TICKS_PER_DAY;
    run(truth);
    expect(truth.facilities['d'].supplyPoints).toBe(28); // 2 SP drawn
  });

  it('a dry depot supplies nobody (line exists, goods do not)', () => {
    const truth = baseTruth('SUP-5', roadLine(), 40);
    depot(truth, 'd', gp(2, 5), 0); // empty farm
    const f = addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(10, 5) });
    f.rdy = 9;
    truth.tick = CLOCK.TICKS_PER_DAY;
    run(truth);
    expect(truth.formations['f'].supply.inSupply).toBe(false);
    expect(truth.formations['f'].rdy).toBe(8);
  });

  it('a convoy RESUPPLY pours its SP into a co-located depot (the pipeline)', () => {
    const truth = baseTruth('SUP-6');
    depot(truth, 'd', gp(5, 5), 10);
    const convoy = addMechFormation(truth, { id: 'mule', sideId: 'blue', pos: gp(5, 5) },
      1, { class: 'SUPPORT' });
    convoy.carriedSp = 20;
    const o: Order = { id: 'res', sideId: 'blue', formationId: 'mule', kind: 'RESUPPLY',
      issuedTick: 0, effectiveTick: 0, conditionals: [] };
    truth.orders['res'] = o; convoy.currentOrderId = 'res';
    run(truth, CLOCK.TICKS_PER_PULSE);
    expect(truth.facilities['d'].supplyPoints).toBe(30); // 10 + 20
    expect(truth.formations['mule'].carriedSp).toBe(0);
    expect(truth.orders['res'].completed).toBe(true);
  });

  it('a mobile convoy with SP is itself a supply source for nearby units', () => {
    const truth = baseTruth('SUP-7', roadLine(), 40);
    // no depot at all — only a convoy carrying SP near the unit
    const convoy = addMechFormation(truth, { id: 'mule', sideId: 'blue', pos: gp(8, 5) },
      1, { class: 'SUPPORT' });
    convoy.carriedSp = 10;
    addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(12, 5) });
    truth.tick = CLOCK.TICKS_PER_DAY;
    run(truth);
    expect(truth.formations['f'].supply.inSupply).toBe(true);
    expect(truth.formations['mule'].carriedSp).toBe(9);
  });
});
