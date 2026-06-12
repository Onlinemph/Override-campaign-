/** M2 — conditional order triggers (spec §2.6, §3.3). */
import { describe, expect, it } from 'vitest';
import { evalTrigger, triggerPass } from '../../src/engine/triggers.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { Order, TruthState } from '../../src/core/types.js';

function activate(truth: TruthState, order: Order) {
  truth.orders[order.id] = order;
  truth.formations[order.formationId].currentOrderId = order.id;
}

function run(truth: TruthState): GameEvent[] {
  const events: GameEvent[] = [];
  triggerPass(truth, e => { events.push(e); applyEvent(truth, e); });
  return events;
}

describe('M2 — trigger evaluation', () => {
  it('TICK_REACHED / RDY_BELOW / HEX_REACHED', () => {
    const truth = baseTruth();
    const f = addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(5, 5) });
    truth.tick = 100;
    expect(evalTrigger(truth, f.id, 'blue', { when: 'TICK_REACHED', param: 100 })).toBe(true);
    expect(evalTrigger(truth, f.id, 'blue', { when: 'TICK_REACHED', param: 101 })).toBe(false);
    f.rdy = 3;
    expect(evalTrigger(truth, f.id, 'blue', { when: 'RDY_BELOW', param: 5 })).toBe(true);
    expect(evalTrigger(truth, f.id, 'blue', { when: 'RDY_BELOW', param: 3 })).toBe(false);
    expect(evalTrigger(truth, f.id, 'blue', { when: 'HEX_REACHED', param: '5,5' })).toBe(true);
    expect(evalTrigger(truth, f.id, 'blue', { when: 'HEX_REACHED', param: '6,5' })).toBe(false);
  });

  it('CONTACT_WITHIN: own contact within N hexes of the formation', () => {
    const truth = baseTruth();
    const f = addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(5, 5) });
    truth.contacts['c'] = {
      id: 'c', observerSideId: 'blue', targetFormationId: 'x', kind: 'STANDARD',
      level: 2, lastConfirmedTick: 0, lastFadeTick: 0,
      estPos: gp(9, 5), posErrorHexes: 0, staleAsOfTick: 0,
    };
    expect(evalTrigger(truth, f.id, 'blue', { when: 'CONTACT_WITHIN', param: 4 })).toBe(true);
    expect(evalTrigger(truth, f.id, 'blue', { when: 'CONTACT_WITHIN', param: 3 })).toBe(false);
  });

  it('DETECTED_SELF: an enemy holds the given ladder level on this formation', () => {
    const truth = baseTruth();
    const f = addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(5, 5) });
    truth.contacts['c'] = {
      id: 'c', observerSideId: 'red', targetFormationId: 'f', kind: 'STANDARD',
      level: 2, lastConfirmedTick: 0, lastFadeTick: 0,
      estPos: gp(5, 5), posErrorHexes: 0, staleAsOfTick: 0,
    };
    expect(evalTrigger(truth, f.id, 'blue', { when: 'DETECTED_SELF', param: 1 })).toBe(true);
    expect(evalTrigger(truth, f.id, 'blue', { when: 'DETECTED_SELF', param: 2 })).toBe(true);
    expect(evalTrigger(truth, f.id, 'blue', { when: 'DETECTED_SELF', param: 3 })).toBe(false);
  });

  it('FUEL_BELOW is parked until M3 (never fires)', () => {
    const truth = baseTruth();
    const f = addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(5, 5) });
    expect(evalTrigger(truth, f.id, 'blue', { when: 'FUEL_BELOW', param: 100 })).toBe(false);
  });
});

describe('M2 — trigger pass', () => {
  it('fires once, spawns the thenOrder, and marks the conditional consumed', () => {
    const truth = baseTruth();
    truth.tick = 50;
    const f = addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(5, 5) });
    const order: Order = {
      ...moveOrder('o', f, 'PATROL', []),
      conditionals: [{
        trigger: { when: 'TICK_REACHED', param: 50 },
        thenOrder: { id: 'placeholder', sideId: 'blue', formationId: 'f', issuedTick: 0,
                     effectiveTick: 0, kind: 'MOVE', path: [gp(4, 5)] } as Order,
      }],
    };
    activate(truth, order);

    const events = run(truth);
    expect(events.filter(e => e.type === 'TRIGGER_FIRED')).toHaveLength(1);
    const fired = events[0] as Extract<GameEvent, { type: 'TRIGGER_FIRED' }>;
    expect(fired.newOrder.kind).toBe('MOVE');
    expect(fired.newOrder.formationId).toBe('f');
    expect(fired.newOrder.effectiveTick).toBe(51);
    expect(truth.orders[fired.newOrder.id]).toBeTruthy();
    expect(truth.orders['o'].conditionals[0].fired).toBe(true);

    // does not re-fire on a second pass
    expect(run(truth).filter(e => e.type === 'TRIGGER_FIRED')).toHaveLength(0);
  });

  it('fires even when the formation is OFF-NET (conditionals keep running, spec §3.3)', () => {
    const truth = baseTruth();
    truth.tick = 10;
    const f = addMechFormation(truth, { id: 'f', sideId: 'blue', pos: gp(20, 5) });
    f.onNet = false;
    const order: Order = {
      ...moveOrder('o', f, 'MOVE', [gp(19, 5)]),
      conditionals: [{
        trigger: { when: 'DETECTED_SELF', param: 1 },
        thenOrder: { id: 'p', sideId: 'blue', formationId: 'f', issuedTick: 0,
                     effectiveTick: 0, kind: 'HIDE' } as Order,
      }],
    };
    activate(truth, order);
    truth.contacts['c'] = {
      id: 'c', observerSideId: 'red', targetFormationId: 'f', kind: 'STANDARD',
      level: 1, lastConfirmedTick: 10, lastFadeTick: 10,
      estPos: gp(20, 5), posErrorHexes: 0, staleAsOfTick: 10,
    };
    expect(run(truth).filter(e => e.type === 'TRIGGER_FIRED')).toHaveLength(1);
  });
});
