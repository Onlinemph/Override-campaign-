/**
 * D-049 — plans (order queues) & standing rules (persistent if-then reflexes).
 */
import { describe, expect, it } from 'vitest';
import { Campaign } from '../../src/core/truth.js';
import { addMechFormation, baseTruth, gp } from '../helpers.js';
import type { GroundPos, Order, StandingRule } from '../../src/core/types.js';

function order(id: string, fid: string, kind: Order['kind'], extra: Partial<Order> = {}): Order {
  return { id, sideId: 'blue', formationId: fid, issuedTick: 0, effectiveTick: 0,
           kind, conditionals: [], ...extra };
}
function pos(c: Campaign, id: string): GroundPos {
  return c.truth.formations[id].pos as GroundPos;
}
function stepUntil(c: Campaign, pred: () => boolean, cap = 120): void {
  let n = 0;
  while (!pred()) {
    c.step('CONTACT');
    if (++n > cap) throw new Error('stepUntil cap');
  }
}

describe('D-049 — plans: orders queue and execute in sequence', () => {
  it('MOVE → MOVE → HIDE runs step by step, each activating when the last completes', () => {
    const truth = baseTruth('PLAN-1');
    addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(0, 5), omp: 10 });
    truth.sides['blue'].commandNodes = ['f']; // its own node: always reachable
    const c = Campaign.create(truth);
    const r = c.issuePlan([
      order('p1', 'f', 'MOVE', { path: [gp(2, 5)] }),
      order('p2', 'f', 'MOVE', { path: [gp(2, 3)] }),
      order('p3', 'f', 'HIDE'),
    ]);
    expect(r).toEqual({ ok: true });

    stepUntil(c, () => c.truth.orders['p1'].completed === true);
    expect(pos(c, 'f')).toEqual(gp(2, 5)); // leg one done exactly where plotted
    stepUntil(c, () => c.truth.orders['p2'].completed === true);
    expect(pos(c, 'f')).toEqual(gp(2, 3));
    stepUntil(c, () => c.truth.formations['f'].posture === 'HIDE');
    expect(c.truth.orders['p3'].completed).toBe(true); // HIDE is instant on activation
  });

  it('a NEWER instruction abandons the old plan: stale steps cancel, never resurrect', () => {
    const truth = baseTruth('PLAN-2');
    addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(0, 5), omp: 10 });
    truth.sides['blue'].commandNodes = ['f']; // its own node: always reachable
    const c = Campaign.create(truth);
    c.issuePlan([
      order('p1', 'f', 'MOVE', { path: [gp(6, 5)] }),
      order('p2', 'f', 'MOVE', { path: [gp(6, 2)] }),
    ]);
    c.step('CONTACT'); // p1 active, marching
    // change of heart: a fresh single order mid-plan
    const r = c.issueOrder(order('new', 'f', 'MOVE', { path: [gp(1, 5)] }));
    expect(r.ok).toBe(true);
    stepUntil(c, () => c.truth.orders['new'].completed === true);
    expect(pos(c, 'f')).toEqual(gp(1, 5));
    expect(c.truth.orders['p2'].completed).toBe(true); // cancelled, not lurking
    // and nothing resurrects it: a few more steps, the unit stays put
    for (let i = 0; i < 5; i++) c.step('CONTACT');
    expect(pos(c, 'f')).toEqual(gp(1, 5));
  });
});

describe('D-049 — standing rules: reflexes that outlive orders', () => {
  const rule = (when: string, param: number | string, kind: Order['kind'],
                extra: Partial<StandingRule> = {}): StandingRule => ({
    trigger: { when: when as StandingRule['trigger']['when'], param },
    thenOrder: { id: 'ph', sideId: 'blue', formationId: 'f', issuedTick: 0,
                 effectiveTick: 0, kind },
    ...extra,
  });

  it('a rule fires whatever the unit is doing — even idle, even with no order at all', () => {
    const truth = baseTruth('RULE-1');
    addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(5, 5), omp: 10 });
    truth.formations['f'].rules = [rule('TICK_REACHED', 3, 'DIG_IN')];
    const c = Campaign.create(truth);
    stepUntil(c, () => ['DIGGING', 'DUG_IN'].includes(c.truth.formations['f'].posture), 40);
    expect(c.truth.formations['f'].rules![0].armed).toBe(false); // spent
  });

  it('a fired rule interrupts the current plan (the reflex outranks the itinerary)', () => {
    const truth = baseTruth('RULE-2');
    addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(0, 5), omp: 10 });
    truth.sides['blue'].commandNodes = ['f']; // its own node: always reachable
    truth.formations['f'].rules = [
      rule('TICK_REACHED', 2, 'MOVE', {
        thenOrder: { id: 'ph', sideId: 'blue', formationId: 'f', issuedTick: 0,
                     effectiveTick: 0, kind: 'MOVE', path: [gp(0, 7)] } }),
    ];
    const c = Campaign.create(truth);
    c.issuePlan([
      order('p1', 'f', 'MOVE', { path: [gp(9, 5)] }),
      order('p2', 'f', 'HIDE'),
    ]);
    stepUntil(c, () => pos(c, 'f').q === 0 && pos(c, 'f').r === 7, 60);
    expect(c.truth.orders['p2'].completed).toBe(true);        // queued step cancelled
    expect(c.truth.formations['f'].posture).not.toBe('HIDE'); // the plan never resumed
  });

  it('one-shot rules stay spent; repeat rules re-arm when the trigger goes false (edge-triggered)', () => {
    const truth = baseTruth('RULE-3');
    addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(5, 5), omp: 10, rdy: 8 });
    truth.formations['f'].rules = [rule('RDY_BELOW', 5, 'REST', { repeat: true })];
    const c = Campaign.create(truth);

    c.truth.formations['f'].rdy = 3; // condition true
    c.step('CONTACT');
    expect(c.truth.formations['f'].rules![0].armed).toBe(false); // fired once, disarmed
    c.step('CONTACT');
    // condition still true: no re-fire while disarmed (no spam)
    const restOrders = Object.keys(c.truth.orders).filter(id => id.startsWith('rule:f:0'));
    expect(restOrders).toHaveLength(1);

    c.truth.formations['f'].rdy = 8; // recovered: trigger false → re-arms
    c.step('CONTACT');
    expect(c.truth.formations['f'].rules![0].armed).toBe(true);
    c.truth.formations['f'].rdy = 2; // drops again → fires again
    c.step('CONTACT');
    expect(Object.keys(c.truth.orders).filter(id => id.startsWith('rule:f:0'))).toHaveLength(2);
  });

  it('setRules replaces the reflexes and re-arms them (net-gated like any transmission)', () => {
    const truth = baseTruth('RULE-4');
    const hq = addMechFormation(truth, { id: 'hq', sideId: 'blue', pos: gp(0, 5) });
    truth.sides['blue'].commandNodes = [hq.id];
    addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(5, 5) });
    addMechFormation(truth, { id: 'lost', sideId: 'blue', pos: gp(25, 5) }); // off-net
    const c = Campaign.create(truth);

    const ok = c.setRules('f', [rule('TICK_REACHED', 999, 'REST')]);
    expect(ok).toEqual({ ok: true });
    expect(c.truth.formations['f'].rules).toHaveLength(1);
    expect(c.truth.formations['f'].rules![0].armed).toBe(true);

    const denied = c.setRules('lost', []);
    expect(denied.ok).toBe(false); // you cannot reprogram a unit you cannot reach
  });
});
