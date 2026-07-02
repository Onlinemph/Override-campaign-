/** Flak (ext): AA bites at the interface points — launches, landings, drop passes. */
import { describe, expect, it } from 'vitest';
import { Campaign, replay } from '../../src/core/truth.js';
import { flakBatteriesNear, flakGauntlet } from '../../src/engine/flak.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { FLAK } from '../../src/rules.js';
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
