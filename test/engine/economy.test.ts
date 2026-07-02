/** The fix pack (ext): HIDE works, movement breaks posture, REARM, factory SP, MASH. */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { maintenancePass } from '../../src/engine/logistics.js';
import { scoringPass } from '../../src/engine/scoring.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { CAREER, CLOCK, SUPPLY } from '../../src/rules.js';
import { mkFacility } from '../../src/fixtures.js';
import { addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { BattleResult, Order, TruthState } from '../../src/core/types.js';

function run(truth: TruthState, fn: (emit: (e: GameEvent) => void) => void): GameEvent[] {
  const events: GameEvent[] = [];
  fn(e => { events.push(e); applyEvent(truth, e); });
  return events;
}

function activate(truth: TruthState, order: Order) {
  truth.orders[order.id] = order;
  truth.formations[order.formationId].currentOrderId = order.id;
}

describe('HIDE — the Hold button finally does something', () => {
  it('a HIDE order flips posture and completes', () => {
    const truth = baseTruth('HIDE-1');
    const f = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(5, 5) });
    activate(truth, moveOrder('o1', f, 'HIDE', []));
    run(truth, emit => maintenancePass(truth, 1, emit));
    expect(truth.formations['m1'].posture).toBe('HIDE');
    expect(truth.orders['o1'].completed).toBe(true);
  });

  it('moving breaks HIDE and DUG_IN — no marching entrenchments', () => {
    const truth = baseTruth('HIDE-2');
    addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(5, 5), posture: 'DUG_IN' });
    run(truth, emit => emit({ type: 'FORMATION_MOVED', formationId: 'm1', to: gp(6, 5),
      movedKind: 'NORMAL', onRoad: false, headingDeg: 0, tick: 0 }));
    expect(truth.formations['m1'].posture).toBe('NONE');
  });
});

describe('REARM — dry ground units draw ammo at last', () => {
  it('draws REARM_SP_PER_UNIT per non-full unit from a co-located depot', () => {
    const truth = baseTruth('REARM-1');
    truth.facilities['depot'] = mkFacility({ id: 'depot', sideId: 'blue',
      name: 'Dump', pos: gp(5, 5), tags: ['DEPOT'], supplyPoints: 10 });
    const f = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(5, 5) });
    truth.units[f.unitIds[0]].ammoState = 'DRY';
    truth.units[f.unitIds[1]].ammoState = 'PARTIAL';
    activate(truth, moveOrder('o1', f, 'REARM', []));
    const c = Campaign.create(truth);
    c.step();
    expect(c.truth.units[f.unitIds[0]].ammoState).toBe('FULL');
    expect(c.truth.units[f.unitIds[1]].ammoState).toBe('FULL');
    expect(c.truth.facilities['depot'].supplyPoints)
      .toBe(10 - 2 * SUPPLY.REARM_SP_PER_UNIT);
    expect(c.truth.orders['o1'].completed).toBe(true);
    expect(replay(c.store.all())).toEqual(c.truth);
  });

  it('draws from a co-located convoy when there is no depot; waits when there is nothing', () => {
    const truth = baseTruth('REARM-2');
    const f = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(5, 5) });
    truth.units[f.unitIds[0]].ammoState = 'DRY';
    activate(truth, moveOrder('o1', f, 'REARM', []));
    const c = Campaign.create(truth);
    c.step();
    expect(c.truth.units[f.unitIds[0]].ammoState).toBe('DRY'); // nothing to draw from
    expect(c.truth.orders['o1'].completed).toBeUndefined();    // waits at the dump

    // a convoy rolls in with stock
    const convoy = addMechFormation(c.truth, { id: 'trucks', sideId: 'blue', pos: gp(5, 5) });
    convoy.carriedSp = 5;
    c.inject({ type: 'GM_NOTE', tick: c.truth.tick, text: 'test: convoy arrives' });
    c.step();
    expect(c.truth.units[f.unitIds[0]].ammoState).toBe('FULL');
    expect(c.truth.formations['trucks'].carriedSp).toBe(5 - SUPPLY.REARM_SP_PER_UNIT);
  });
});

describe('REPAIR — players queue their own shop work', () => {
  it('feeds every damaged unit into the shop as SP allows; completes when all stand OK', () => {
    const truth = baseTruth('PREPAIR-1');
    truth.facilities['depot'] = mkFacility({ id: 'depot', sideId: 'blue', name: 'Yards',
      pos: gp(5, 5), tags: ['DEPOT'], supplyPoints: 2 }); // enough for one DAMAGED + one CRIPPLED? no: 1+2=3 > 2
    const f = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(5, 5) });
    truth.units[f.unitIds[0]].damage = 'DAMAGED';   // 1 SP, 1 day
    truth.units[f.unitIds[1]].damage = 'CRIPPLED';  // 2 SP, 3 days
    activate(truth, moveOrder('o1', f, 'REPAIR', []));
    const c = Campaign.create(truth);

    c.step();
    // 2 SP on hand: the DAMAGED job (1 SP) and... only one of the two fits
    const inShop = f.unitIds.filter(uid => c.truth.units[uid].repairReadyTick != null);
    expect(inShop.length).toBe(1);
    expect(c.truth.orders['o1'].completed).toBeUndefined(); // queue still open

    // the factory pays out / a convoy arrives — top the depot and let the clock run
    c.inject({ type: 'SP_CHANGED', facilityId: 'depot', delta: 5, reason: 'test restock' });
    for (let i = 0; i < 150 && !c.truth.orders['o1'].completed; i++) c.step();
    expect(c.truth.units[f.unitIds[0]].damage).toBe('OK');
    expect(c.truth.units[f.unitIds[1]].damage).toBe('OK');
    expect(c.truth.orders['o1'].completed).toBe(true);
    expect(replay(c.store.all())).toEqual(c.truth);
  });

  it('nowhere to repair: the order waits; an embarked formation uses the carrier crews', () => {
    const truth = baseTruth('PREPAIR-2');
    const ds = addMechFormation(truth, { id: 'ds1', sideId: 'blue', pos: gp(7, 7) },
      1, { class: 'DROPSHIP' });
    ds.carrier = { bays: 2, crews: 1, avFuelTons: 20 };
    const field = addMechFormation(truth, { id: 'field', sideId: 'blue', pos: gp(2, 2) });
    truth.units[field.unitIds[0]].damage = 'DAMAGED';
    activate(truth, moveOrder('of', field, 'REPAIR', []));
    const aboard = addMechFormation(truth, { id: 'cargo', sideId: 'blue', pos: gp(7, 7) });
    aboard.mounted = { carrierFormationId: 'ds1' };
    truth.units[aboard.unitIds[0]].damage = 'DAMAGED';
    truth.units[aboard.unitIds[1]].damage = 'DAMAGED';
    activate(truth, moveOrder('oc', aboard, 'REPAIR', []));
    const c = Campaign.create(truth);

    c.step();
    expect(c.truth.units[field.unitIds[0]].repairReadyTick).toBeUndefined(); // open field: waits
    // the carrier's single crew takes one job; the second waits for the bench
    const started = aboard.unitIds.filter(uid => c.truth.units[uid].repairReadyTick != null);
    expect(started.length).toBe(1);
  });
});

describe('factories produce', () => {
  it('a FACTORY mints SP at each daily boundary', () => {
    const truth = baseTruth('FACTORY-1');
    truth.facilities['works'] = mkFacility({ id: 'works', sideId: 'blue',
      name: 'Ironworks', pos: gp(5, 5), tags: ['FACTORY'], supplyPoints: 0 });
    truth.tick = 2 * CLOCK.TICKS_PER_DAY; // two days elapsed
    run(truth, emit => scoringPass(truth, emit));
    expect(truth.facilities['works'].supplyPoints).toBe(2 * SUPPLY.FACTORY_SP_PER_DAY);
  });
});

describe('MASH — the medics earn their keep', () => {
  it('a wounded pilot recovers in 1 day instead of 3 when the side fields a MASH', () => {
    const truth = baseTruth('MASH-1');
    truth.clockMode = 'CONTACT';
    addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(5, 5), sigBase: 6 });
    const blue = addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(6, 5), omp: 4 });
    truth.sides['blue'].commandNodes = ['blue-1'];
    addMechFormation(truth, { id: 'medics', sideId: 'blue', pos: gp(2, 2) }, 1, { tags: ['MASH'] });
    truth.pilots['hurt'] = { id: 'hurt', name: 'Hurt', gunnery: 4, piloting: 5,
      kills: 0, ace: false, fatigue: 0, status: 'OK' };
    truth.units[blue.unitIds[0]].pilotIds = ['hurt'];
    activate(truth, moveOrder('o', blue, 'MOVE', [gp(5, 5)]));
    const c = Campaign.create(truth);
    let guard = 0;
    while (!c.pendingEngagement && guard++ < 5) c.step();
    const pkg = c.exportHandoff()!;
    const tick0 = c.truth.tick;
    const result: BattleResult = {
      handoffId: pkg.id, victorSideId: 'red', hexControlSideId: 'red',
      unitOutcomes: [{ unitId: blue.unitIds[0], damage: 'DAMAGED', ammoState: 'PARTIAL',
                       pilotOutcomes: [{ pilotId: 'hurt', status: 'WOUNDED' }] }],
      ejections: [], turnsElapsed: 6, notes: '',
    };
    c.ingestBattleResult(result);
    expect(c.truth.pilots['hurt'].recoverAtTick)
      .toBe(tick0 + CAREER.WOUND_RECOVERY_DAYS_MASH * CLOCK.TICKS_PER_DAY);
  });
});
