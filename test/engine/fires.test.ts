/** M7 — artillery fire missions, counter-battery, the spotter loop (core §9.1–9.2). */
import { describe, expect, it } from 'vitest';
import { firesPass, batteryRange } from '../../src/engine/fires.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { addMechFormation, baseTruth, gp, T } from '../helpers.js';
import type { Order, TruthState } from '../../src/core/types.js';

function run(truth: TruthState): GameEvent[] {
  const events: GameEvent[] = [];
  firesPass(truth, e => { events.push(e); applyEvent(truth, e); });
  return events;
}
function fireOrder(truth: TruthState, fId: string, o: Partial<Order>): void {
  const order: Order = { id: `fire-${fId}`, sideId: truth.formations[fId].sideId,
    formationId: fId, kind: 'FIRE', issuedTick: 0, effectiveTick: 0, conditionals: [], ...o };
  truth.orders[order.id] = order;
  truth.formations[fId].currentOrderId = order.id;
}

describe('M7 — fire missions', () => {
  it('a Long Tom battery damages an enemy in the target hex, within its 30-hex range', () => {
    const truth = baseTruth('FIRE-1');
    const bat = addMechFormation(truth, { id: 'blue-arty', sideId: 'blue', pos: gp(2, 2), br: 20 },
      1, { tags: ['LONG_TOM'], class: 'SUPPORT' });
    void bat;
    addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(20, 2) }); // 18 hexes away
    // a forward observer with LOS to the target removes the intel penalty (the spotter loop)
    addMechFormation(truth, { id: 'blue-spotter', sideId: 'blue', pos: gp(19, 2) });
    fireOrder(truth, 'blue-arty', { targetHex: gp(20, 2) });

    const uid = truth.formations['red-1'].unitIds[0];
    const before = truth.units[uid].damage;
    run(truth);
    const after = truth.units[uid].damage;
    expect(batteryRange(truth, truth.formations['blue-arty'])).toBe(30);
    expect(after).not.toBe(before); // OK → worse
    // the battery is flagged as having fired (SIG −3 this turn)
    expect(truth.formations['blue-arty'].transient?.fired).toBe(true);
  });

  it('out of range: no shot at all', () => {
    const truth = baseTruth('FIRE-2', [], 60, 10);
    addMechFormation(truth, { id: 'blue-arty', sideId: 'blue', pos: gp(2, 2), br: 20 },
      1, { tags: ['ARROW_IV'], class: 'SUPPORT' }); // range 8
    addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(40, 2) });
    fireOrder(truth, 'blue-arty', { targetHex: gp(40, 2) });
    expect(run(truth).filter(e => e.type === 'DIE_ROLLED')).toHaveLength(0);
  });

  it('counter-battery: firing auto-reveals the firer at CONTACT to an enemy that can range it', () => {
    const truth = baseTruth('FIRE-3');
    addMechFormation(truth, { id: 'blue-arty', sideId: 'blue', pos: gp(2, 2), br: 20 },
      1, { tags: ['LONG_TOM'], class: 'SUPPORT' });
    // a red counter-battery: its own Long Tom ranges the blue firing hex
    addMechFormation(truth, { id: 'red-cb', sideId: 'red', pos: gp(10, 2), br: 20 },
      1, { tags: ['LONG_TOM'], class: 'SUPPORT' });
    fireOrder(truth, 'blue-arty', { targetHex: gp(25, 2) });
    run(truth);
    const c = truth.contacts['contact:red:blue-arty'];
    expect(c).toBeTruthy();
    expect(c.level).toBe(3); // CONTACT — a confident fix on the firing hex
    expect(c.estPos).toMatchObject({ q: 2, r: 2 });
  });

  it('the §6.5 chaff trick: fire, then the fix is on the hex you LEAVE', () => {
    const truth = baseTruth('FIRE-CHAFF');
    truth.clockMode = 'CONTACT';
    const bat = addMechFormation(truth, { id: 'blue-arty', sideId: 'blue', pos: gp(5, 5), br: 20, omp: 4 },
      1, { tags: ['LONG_TOM'], class: 'SUPPORT' });
    addMechFormation(truth, { id: 'red-cb', sideId: 'red', pos: gp(9, 5), br: 20 },
      1, { tags: ['LONG_TOM'], class: 'SUPPORT' });
    fireOrder(truth, 'blue-arty', { targetHex: gp(20, 5) });
    run(truth);
    // red's confident fix:
    expect(truth.contacts['contact:red:blue-arty'].estPos).toMatchObject({ q: 5, r: 5 });
    // the battery shoots and scoots
    applyEvent(truth, { type: 'FORMATION_MOVED', formationId: 'blue-arty', to: gp(5, 7),
      movedKind: 'NORMAL', onRoad: false, headingDeg: 90, tick: truth.tick });
    void bat;
    // red's intel still says 5,5 — a confident, now-wrong LOCK on an empty hex
    expect(truth.contacts['contact:red:blue-arty'].estPos).toMatchObject({ q: 5, r: 5 });
    expect((truth.formations['blue-arty'].pos as any)).toMatchObject({ q: 5, r: 7 });
  });

  it('a stale fix lands on empty ground — no damage, but counter-battery still fires', () => {
    const truth = baseTruth('FIRE-STALE');
    addMechFormation(truth, { id: 'blue-arty', sideId: 'blue', pos: gp(2, 2), br: 20 },
      1, { tags: ['LONG_TOM'], class: 'SUPPORT' });
    addMechFormation(truth, { id: 'red-cb', sideId: 'red', pos: gp(10, 2), br: 20 },
      1, { tags: ['LONG_TOM'], class: 'SUPPORT' });
    fireOrder(truth, 'blue-arty', { targetHex: gp(25, 2) }); // nobody there
    const ev = run(truth);
    expect(ev.some(e => e.type === 'DIE_ROLLED')).toBe(true);          // it shot
    expect(ev.some(e => e.type === 'UNIT_STATE_CHANGED')).toBe(false); // hit nothing
    expect(truth.contacts['contact:red:blue-arty']).toBeTruthy();      // still revealed
  });

  it('a unit with no tubes never fires', () => {
    const truth = baseTruth('FIRE-NOTUBE');
    addMechFormation(truth, { id: 'blue-mech', sideId: 'blue', pos: gp(2, 2) });
    addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(4, 2) });
    fireOrder(truth, 'blue-mech', { targetHex: gp(4, 2) });
    expect(run(truth)).toHaveLength(0);
  });
});
