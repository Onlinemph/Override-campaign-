/** M7 — artillery fire missions, counter-battery, the spotter loop (core §9.1–9.2). */
import { describe, expect, it } from 'vitest';
import { batteryRange, batteryStrength, firesPass } from '../../src/engine/fires.js';
import { capitalBatteriesNear } from '../../src/engine/flak.js';
import { netNodesOf } from '../../src/engine/net.js';
import { artyStrengthFromWeapons } from '../../src/roster/derive.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { mkFacility } from '../../src/fixtures.js';
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
  it('a Long Tom battery damages an enemy in the target hex, within its 15-hex range', () => {
    const truth = baseTruth('FIRE-1');
    const bat = addMechFormation(truth, { id: 'blue-arty', sideId: 'blue', pos: gp(2, 2), br: 20 },
      1, { tags: ['LONG_TOM'], class: 'SUPPORT' });
    void bat;
    addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(14, 2) }); // 12 hexes away
    // a forward observer with LOS to the target removes the intel penalty (the spotter loop)
    addMechFormation(truth, { id: 'blue-spotter', sideId: 'blue', pos: gp(13, 2) });
    fireOrder(truth, 'blue-arty', { targetHex: gp(14, 2) });

    const uid = truth.formations['red-1'].unitIds[0];
    const before = truth.units[uid].damage;
    run(truth);
    const after = truth.units[uid].damage;
    expect(batteryRange(truth, truth.formations['blue-arty'])).toBe(15); // D-052 halved
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
    fireOrder(truth, 'blue-arty', { targetHex: gp(14, 2) }); // 12 hexes: in the halved reach
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
    fireOrder(truth, 'blue-arty', { targetHex: gp(14, 2) }); // nobody there
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

describe('D-052 — the guns are real', () => {
  const DMG = ['OK', 'DAMAGED', 'CRIPPLED', 'DESTROYED'];

  it('tube strength comes off the card; the battery sums it; DRY tubes drop out', () => {
    const parsed = { kind: 'vehicle', card: { weapons: [
      { label: 'x2 Long Tom Artillery' }, { label: 'Machine Gun' }] } } as never;
    expect(artyStrengthFromWeapons(parsed)).toBe(6); // 2 × 3, capped ceiling anyway
    const thumper = { kind: 'vehicle', card: { weapons: [
      { label: 'Thumper Artillery' }] } } as never;
    expect(artyStrengthFromWeapons(thumper)).toBe(1);

    const truth = baseTruth('GUNS-1');
    const bat = addMechFormation(truth, { id: 'bat', sideId: 'blue', pos: gp(2, 2) },
      2, { tags: ['LONG_TOM'], class: 'SUPPORT' });
    for (const uid of bat.unitIds) truth.units[uid].arty = 3;
    expect(batteryStrength(truth, bat)).toBe(6);
    truth.units[bat.unitIds[0]].ammoState = 'DRY'; // one magazine empty
    expect(batteryStrength(truth, bat)).toBe(3);
  });

  it('a massed battery tears an extra step out of the same seeded hit', () => {
    const mk = (arty: number) => {
      const truth = baseTruth('GUNS-2');
      const bat = addMechFormation(truth, { id: 'bat', sideId: 'blue', pos: gp(2, 2), br: 20 },
        2, { tags: ['LONG_TOM'], class: 'SUPPORT' });
      for (const uid of bat.unitIds) truth.units[uid].arty = arty;
      addMechFormation(truth, { id: 'tgt', sideId: 'red', pos: gp(10, 2) });
      addMechFormation(truth, { id: 'spot', sideId: 'blue', pos: gp(9, 2) });
      fireOrder(truth, 'bat', { targetHex: gp(10, 2) });
      run(truth);
      return DMG.indexOf(truth.units[truth.formations['tgt'].unitIds[0]].damage);
    };
    const light = mk(1);   // strength 2
    const massed = mk(3);  // strength 6 — same seed, same roll
    expect(massed).toBe(light + 1);
  });

  it('sustained fire drains the magazine until the battery falls silent', () => {
    const truth = baseTruth('GUNS-3');
    const bat = addMechFormation(truth, { id: 'bat', sideId: 'blue', pos: gp(2, 2), br: 20 },
      1, { tags: ['LONG_TOM'], class: 'SUPPORT' });
    fireOrder(truth, 'bat', { targetHex: gp(10, 2) }); // harassment on an empty hex
    let shots = 0;
    for (let i = 0; i < 300 && truth.units[bat.unitIds[0]].ammoState !== 'DRY'; i++) {
      shots += run(truth).filter(e =>
        e.type === 'DIE_ROLLED' && /fire mission/.test((e as any).roll.purpose)).length;
    }
    expect(truth.units[bat.unitIds[0]].ammoState).toBe('DRY'); // it ran out
    expect(shots).toBeGreaterThan(2); // ...but not instantly
    // dry battery: the FIRE order stands but nothing comes out
    expect(run(truth).filter(e => e.type === 'DIE_ROLLED')).toHaveLength(0);
  });

  it('bombardment flattens a photographed base — clean fire, and DESTROYED silences everything', () => {
    const truth = baseTruth('GUNS-4', [], 40, 30);
    truth.sides['red'].commandNodes = ['silo'];
    truth.facilities['silo'] = mkFacility({ id: 'silo', sideId: 'red', name: 'Silo Hill',
      pos: gp(10, 2), tags: ['COMM_RELAY'], isCommandNode: true, supplyPoints: 40,
      capitalBattery: { weapon: 'WHITE_SHARK', shots: 8 },
      knownTo: ['blue'] }); // photographed by a D-051 sortie
    const bat = addMechFormation(truth, { id: 'bat', sideId: 'blue', pos: gp(2, 2), br: 20 },
      2, { tags: ['LONG_TOM'], class: 'SUPPORT' });
    for (const uid of bat.unitIds) truth.units[uid].arty = 3;
    fireOrder(truth, 'bat', { targetHex: gp(10, 2) });

    const ev = run(truth);
    const roll = ev.find(e => e.type === 'DIE_ROLLED' &&
      /fire mission/.test((e as any).roll.purpose)) as any;
    expect(roll.roll.purpose).not.toMatch(/intel/); // surveyed grid: no blind penalty
    for (let i = 0; i < 300 && truth.facilities['silo'].damage !== 'DESTROYED'; i++) {
      run(truth);
      if (batteryStrength(truth, bat) === 0) { // magazines can empty mid-shoot: refill
        for (const uid of bat.unitIds) truth.units[uid].ammoState = 'FULL';
      }
    }
    expect(truth.facilities['silo'].damage).toBe('DESTROYED');
    expect(truth.facilities['silo'].supplyPoints).toBe(0); // rubble stores nothing
    expect(capitalBatteriesNear(truth, 'blue', { q: 10, r: 2 })).toHaveLength(0); // guns silent
    expect(netNodesOf(truth, 'red')).toHaveLength(0); // node + relay both gone
  });
});
