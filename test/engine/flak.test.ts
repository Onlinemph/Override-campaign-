/** Flak (ext): AA bites at the interface points — launches, landings, drop passes. */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { capitalBatteriesNear, capitalGauntlet, flakBatteriesNear, flakGauntlet,
         flakStrength, flakTn } from '../../src/engine/flak.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { CAPITAL_WEAPONS, FLAK } from '../../src/rules.js';
import { mkFacility } from '../../src/fixtures.js';
import { addFlight, addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { Order, TruthState } from '../../src/core/types.js';

function run(truth: TruthState, fn: (emit: (e: GameEvent) => void) => void): GameEvent[] {
  const events: GameEvent[] = [];
  fn(e => { events.push(e); applyEvent(truth, e); });
  return events;
}

function withBattery(seed: string, at = gp(10, 10)) {
  const truth = baseTruth(seed);
  addMechFormation(truth, { id: 'aa1', sideId: 'red', pos: at }, 2, { tags: ['AA'] });
  return truth;
}

describe('the gauntlet itself', () => {
  it('a hit degrades one damage step and the battery is revealed (SALV-A rolls 10)', () => {
    const truth = withBattery('SALV-A');
    const flt = addFlight(truth, { id: 'f1', sideId: 'blue', basePos: gp(10, 10), fp: 300 });
    const events = run(truth, emit => flakGauntlet(truth, emit, flt, gp(10, 10), 'test'));

    expect(events.some(e => e.type === 'DIE_ROLLED' && /flak/.test(e.roll.purpose))).toBe(true);
    expect(truth.units[flt.unitIds[0]].damage).toBe('DAMAGED');       // one step, not dead
    expect(truth.contacts['contact:blue:aa1']?.level).toBe(FLAK.REVEAL_LEVEL); // shoot & be seen
  });

  it('a miss still reveals the battery — the bargain cuts both ways (SALV-D rolls 5)', () => {
    const truth = withBattery('SALV-D');
    const flt = addFlight(truth, { id: 'f1', sideId: 'blue', basePos: gp(10, 10), fp: 300 });
    run(truth, emit => flakGauntlet(truth, emit, flt, gp(10, 10), 'test'));

    expect(truth.units[flt.unitIds[0]].damage).toBe('OK');
    expect(truth.contacts['contact:blue:aa1']?.level).toBe(FLAK.REVEAL_LEVEL);
  });

  it('flak batters but never one-shots: CRIPPLED stays CRIPPLED', () => {
    const truth = withBattery('SALV-A');
    const flt = addFlight(truth, { id: 'f1', sideId: 'blue', basePos: gp(10, 10), fp: 300 });
    truth.units[flt.unitIds[0]].damage = 'CRIPPLED';
    run(truth, emit => flakGauntlet(truth, emit, flt, gp(10, 10), 'test'));
    expect(truth.units[flt.unitIds[0]].damage).toBe('CRIPPLED');
  });

  it('out of the umbrella (or friendly, or embarked) nobody fires', () => {
    const truth = withBattery('SALV-A', gp(3, 3)); // battery far from the LZ
    addMechFormation(truth, { id: 'own-aa', sideId: 'blue', pos: gp(10, 10) }, 1, { tags: ['AA'] });
    const stowed = addMechFormation(truth, { id: 'aa2', sideId: 'red', pos: gp(10, 10) }, 1, { tags: ['AA'] });
    stowed.mounted = { carrierFormationId: 'own-aa' }; // nonsense mount, but: mounted ⇒ silent
    const flt = addFlight(truth, { id: 'f1', sideId: 'blue', basePos: gp(10, 10), fp: 300 });
    expect(flakBatteriesNear(truth, 'blue', gp(10, 10))).toHaveLength(0);
    const events = run(truth, emit => flakGauntlet(truth, emit, flt, gp(10, 10), 'test'));
    expect(events).toHaveLength(0);
  });
});

describe('D-050 — batteries graded by their real guns', () => {
  it('strength sums the units\' derived flak values; TN scales down to the floor', () => {
    const truth = baseTruth('GRADE-1');
    // two Partisan-grade units (flak 5 each) = a massed dedicated battery
    const heavy = addMechFormation(truth, { id: 'heavy', sideId: 'red', pos: gp(5, 5) }, 2, { tags: ['AA'] });
    for (const uid of heavy.unitIds) truth.units[uid].flak = 5;
    expect(flakStrength(truth, heavy)).toBe(10);
    expect(flakTn(10)).toBe(FLAK.TN_FLOOR); // 9 − ⌊10/3⌋ = 6
    // a bare authored AA tag is an improvised battery of 1
    const scratch = addMechFormation(truth, { id: 'scratch', sideId: 'red', pos: gp(9, 9) }, 1, { tags: ['AA'] });
    expect(flakStrength(truth, scratch)).toBe(1);
    expect(flakTn(1)).toBe(FLAK.TN_BASE);
  });

  it('a massed battery (strength ≥ 8) degrades two steps per hit — still capped at CRIPPLED', () => {
    const truth = baseTruth('SALV-A'); // seed rolls 10 on the first 2d6
    const battery = addMechFormation(truth, { id: 'aa1', sideId: 'red', pos: gp(10, 10) }, 2, { tags: ['AA'] });
    for (const uid of battery.unitIds) truth.units[uid].flak = 5;
    const flt = addFlight(truth, { id: 'f1', sideId: 'blue', basePos: gp(10, 10), fp: 300 });
    run(truth, emit => flakGauntlet(truth, emit, flt, gp(10, 10), 'test'));
    expect(truth.units[flt.unitIds[0]].damage).toBe('CRIPPLED'); // OK → two steps
  });
});

describe('D-050 — anti-capital emplacements deny the sky', () => {
  function withBase(seed: string, weapon: string, shots = 8, at = gp(10, 10)) {
    const truth = baseTruth(seed, [], 40, 30);
    truth.facilities['base'] = mkFacility({ id: 'base', sideId: 'red', name: 'Silo Hill',
      pos: at, capitalBattery: { weapon, shots } });
    return truth;
  }
  function dropship(truth: TruthState, id: string, airQ: number, airR: number) {
    const ds = addMechFormation(truth, { id, sideId: 'blue', pos: gp(2, 2) }, 1, { class: 'DROPSHIP' });
    ds.pos = { kind: 'air', gridQ: airQ, gridR: airR, band: 'HIGH', altLevel: 6,
               velocity: 2, vectorDeg: 0 };
    ds.air = { phase: 'ENROUTE', speed: 'CRUISE' };
    return ds;
  }

  it('a DropShip inside the umbrella eats real weapon damage; the magazine drains', () => {
    const truth = withBase('CAP-1', 'KILLER_WHALE', 2); // dmg 3 steps, range 12
    const ds = dropship(truth, 'ds1', 12, 10); // 2 air hexes from the silo
    const before = truth.facilities['base'].capitalBattery!.shots;
    run(truth, emit => capitalGauntlet(truth, emit, ds, { q: 12, r: 10 }, 'overflight'));
    expect(truth.facilities['base'].capitalBattery!.shots).toBe(before - 1); // missiles are finite
    const dmg = truth.units[ds.unitIds[0]].damage;
    // seeded roll: hit ⇒ THREE steps (OK → DESTROYED — a Killer Whale can gut a ship)
    expect(['OK', 'DESTROYED']).toContain(dmg);
    if (dmg === 'DESTROYED') expect(truth.formations['ds1'].destroyed).toBe(true);
  });

  it('outside the range there is no engagement; a dry magazine is silent', () => {
    const truth = withBase('CAP-2', 'KILLER_WHALE', 0); // dry
    expect(capitalBatteriesNear(truth, 'blue', { q: 11, r: 10 })).toHaveLength(0);
    const truth2 = withBase('CAP-2b', 'KILLER_WHALE', 8);
    // Killer Whale reaches 12 air hexes: 13 out is empty sky
    expect(capitalBatteriesNear(truth2, 'blue', { q: 23, r: 10 })).toHaveLength(1 - 1);
    expect(capitalBatteriesNear(truth2, 'blue', { q: 22, r: 10 })).toHaveLength(1);
  });

  it('only the Barracuda can track a fighter; everyone tracks a DropShip', () => {
    // (flights based OFF the silo hex — a grounded blue flight ON it would suppress it)
    const truth = withBase('CAP-3', 'WHITE_SHARK');
    const flt = addFlight(truth, { id: 'flt', sideId: 'blue', basePos: gp(14, 10), fp: 300 });
    flt.pos = { kind: 'air', gridQ: 14, gridR: 10, band: 'HIGH', altLevel: 6,
                velocity: 2, vectorDeg: 0 };
    const shark = run(truth, emit => capitalGauntlet(truth, emit, flt, { q: 14, r: 10 }, 'test'));
    expect(shark.filter(e => e.type === 'DIE_ROLLED')).toHaveLength(0); // can't track it

    const truth2 = withBase('CAP-3b', 'BARRACUDA');
    const flt2 = addFlight(truth2, { id: 'flt', sideId: 'blue', basePos: gp(14, 10), fp: 300 });
    const cuda = run(truth2, emit => capitalGauntlet(truth2, emit, flt2, { q: 14, r: 10 }, 'test'));
    expect(cuda.filter(e => e.type === 'DIE_ROLLED')).toHaveLength(1); // its whole niche
  });

  it('an enemy ground formation ON the battery silences it — take the guns by taking the ground', () => {
    const truth = withBase('CAP-4', 'WHITE_SHARK');
    expect(capitalBatteriesNear(truth, 'blue', { q: 10, r: 10 })).toHaveLength(1);
    addMechFormation(truth, { id: 'assault', sideId: 'blue', pos: gp(10, 10) });
    expect(capitalBatteriesNear(truth, 'blue', { q: 10, r: 10 })).toHaveLength(0);
  });

  it('the denial umbrella fires every step a capital hull spends in the zone (through the step loop)', () => {
    const truth = withBase('CAP-5', 'NL45', 0); // energy mount: no magazine to drain
    dropship(truth, 'ds1', 12, 10);
    const c = Campaign.create(truth);
    c.step('CONTACT');
    c.step('CONTACT');
    const rolls = c.store.all().filter(le =>
      le.event.type === 'DIE_ROLLED' && /capital battery/.test((le.event as any).roll.purpose));
    expect(rolls.length).toBe(2); // one shot per battery per step
    expect(replay(c.store.all())).toEqual(c.truth);
  });

  it('a dead ship takes its embarked riders with it', () => {
    // NL45 does 1 step: pre-damage the ship to CRIPPLED so a hit kills it
    const truth = withBase('SALV-A', 'KILLER_WHALE'); // seed rolls 10 ⇒ hit at TN 8
    const ds = dropship(truth, 'ds1', 11, 10);
    truth.units[ds.unitIds[0]].damage = 'DAMAGED'; // 3 steps from DAMAGED ⇒ DESTROYED
    const riders = addMechFormation(truth, { id: 'riders', sideId: 'blue', pos: gp(2, 2) });
    riders.mounted = { carrierFormationId: 'ds1' };
    run(truth, emit => capitalGauntlet(truth, emit, ds, { q: 11, r: 10 }, 'overflight'));
    expect(truth.formations['ds1'].destroyed).toBe(true);
    expect(truth.formations['riders'].destroyed).toBe(true); // lost with the ship
  });
});

describe('wired into the interfaces', () => {
  it('a LAND through an enemy umbrella takes fire on final approach', () => {
    const truth = withBattery('FLAK-LAND', gp(12, 8));
    const ds = addMechFormation(truth, { id: 'ds1', sideId: 'blue', pos: gp(2, 2) },
      1, { class: 'DROPSHIP' });
    ds.air = { phase: 'ENROUTE', speed: 'CRUISE' };
    ds.pos = { kind: 'air', gridQ: 0, gridR: 0, band: 'HIGH', altLevel: 6,
               velocity: 2, vectorDeg: 0 };
    const u = truth.units[ds.unitIds[0]];
    u.fuel = { fp: 4000, fpPerTon: 30, tons: 4000 / 30 };
    truth.orders['o1'] = { ...moveOrder('o1', ds, 'MOVE', []), kind: 'LAND',
                           targetHex: gp(12, 8), path: [] } as Order;
    ds.currentOrderId = 'o1';
    const c = Campaign.create(truth);

    for (let i = 0; i < 5; i++) c.step();
    expect(c.truth.formations['ds1'].pos).toEqual(gp(12, 8)); // down, whatever the flak said
    const flakRolls = c.store.all().filter(le =>
      le.event.type === 'DIE_ROLLED' && /flak.*final approach/.test((le.event as any).roll.purpose));
    expect(flakRolls.length).toBeGreaterThan(0);
    expect(c.truth.contacts['contact:blue:aa1']).toBeDefined(); // the battery gave itself away
    expect(replay(c.store.all())).toEqual(c.truth);
  });

  it('a combat drop through flak scatters worse — same dice, +2 hexes', () => {
    const seed = 'FLAK-DROP';
    const mk = (withAa: boolean) => {
      const truth = baseTruth(seed);
      if (withAa) addMechFormation(truth, { id: 'aa1', sideId: 'red', pos: gp(15, 10) },
        2, { tags: ['AA'] });
      addMechFormation(truth, { id: 'carrier', sideId: 'blue', pos: gp(5, 5) },
        1, { class: 'DROPSHIP' });
      addMechFormation(truth, { id: 'payload', sideId: 'blue', pos: gp(5, 5) });
      return Campaign.create(truth);
    };
    const calm = mk(false).combatDrop('carrier', 'payload', gp(15, 10));
    const hot = mk(true).combatDrop('carrier', 'payload', gp(15, 10));
    expect(calm.ok && hot.ok).toBe(true);
    if (!calm.ok || !hot.ok) return;
    // identical drop dice (flak rolls come after them), so the delta is pure flak
    expect(hot.scatter).toBe(calm.scatter + FLAK.DROP_SCATTER_EXTRA);
  });
});
