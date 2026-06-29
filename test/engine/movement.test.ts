/** B5 — ground movement (core §2.3, §5). */
import { describe, expect, it } from 'vitest';
import { movementPass, hexEntryCost, deriveFormationOmp } from '../../src/engine/movement.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { mkUnit } from '../../src/fixtures.js';
import { addMechFormation, baseTruth, gp, moveOrder, T } from '../helpers.js';
import type { GroundPos, Order, TruthState } from '../../src/core/types.js';

function run(truth: TruthState, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  const emit = (e: GameEvent) => { events.push(e); applyEvent(truth, e); };
  movementPass(truth, dt, emit);
  return events;
}

function activate(truth: TruthState, order: Order) {
  truth.orders[order.id] = order;
  const f = truth.formations[order.formationId];
  f.currentOrderId = order.id;
  f.pathIndex = 0;
  f.moveProgress = 0;
}

function posOf(truth: TruthState, id: string): GroundPos {
  return truth.formations[id].pos as GroundPos;
}

describe('B5 — movement', () => {
  it('OMP = slowest walk/cruise in the formation (core §3)', () => {
    const units = [
      mkUnit({ sideId: 'blue', walkOrCruise: 6 }),
      mkUnit({ sideId: 'blue', walkOrCruise: 3 }),
      mkUnit({ sideId: 'blue', walkOrCruise: 5 }),
    ];
    expect(deriveFormationOmp(units)).toBe(3);
  });

  it('contact mode: spends OMP/10 per turn against terrain costs hex by hex', () => {
    const truth = baseTruth('MOVE-SEED', [
      { q: 6, r: 5, terrain: 'WOODS' }, { q: 7, r: 5, terrain: 'WOODS' },
    ]);
    truth.clockMode = 'CONTACT';
    // omp 20 ⇒ 2 budget per 6-min turn; each woods hex costs 2 ⇒ one woods hex per turn
    const f = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(5, 5), omp: 20 });
    activate(truth, moveOrder('o1', f, 'MOVE', [gp(6, 5), gp(7, 5), gp(8, 5)]));

    run(truth, 1);
    expect(posOf(truth, 'm1')).toEqual(gp(6, 5)); // first woods hex
    run(truth, 1);
    expect(posOf(truth, 'm1')).toEqual(gp(7, 5)); // second woods hex
    run(truth, 1);
    expect(posOf(truth, 'm1')).toEqual(gp(8, 5)); // clear hex (cost 1) — arrives
    expect(truth.orders['o1'].completed).toBe(true);
  });

  it('roads halve hex cost (min 1) in contact mode', () => {
    const truth = baseTruth('MOVE-SEED', [
      { q: 6, r: 5, terrain: 'WOODS', infra: ['ROAD'] },
    ]);
    const f = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(5, 5), omp: 4 });
    const hex = truth.theaters[T].hexes['6,5'];
    expect(hexEntryCost(truth, f, hex)).toBe(1); // woods 2 × ½ = 1
    const clearRoad = { ...truth.theaters[T].hexes['6,5'], terrain: 'CLEAR' as const };
    expect(hexEntryCost(truth, f, clearRoad)).toBe(1); // ½ floored to min 1
  });

  it('wheeled formations pay double off-road in rough/woods/swamp; mountains bar them', () => {
    const truth = baseTruth('MOVE-SEED', [
      { q: 6, r: 5, terrain: 'WOODS' }, { q: 7, r: 5, terrain: 'MOUNTAIN' },
    ]);
    const f = addMechFormation(truth, { id: 'w1', sideId: 'blue', pos: gp(5, 5), omp: 4 },
      3, { tags: ['WHEELED'], class: 'SUPPORT' });
    expect(hexEntryCost(truth, f, truth.theaters[T].hexes['6,5'])).toBe(4); // woods 2 ×2
    expect(hexEntryCost(truth, f, truth.theaters[T].hexes['7,5'])).toBeNull();
  });

  it('water is impassable to ground formations: path stalls, no movement events', () => {
    const truth = baseTruth('MOVE-SEED', [{ q: 6, r: 5, terrain: 'WATER' }]);
    truth.clockMode = 'CONTACT';
    const f = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(5, 5), omp: 4 });
    activate(truth, moveOrder('o1', f, 'MOVE', [gp(6, 5), gp(7, 5)]));
    const events = run(truth, 1);
    expect(events.filter(e => e.type === 'FORMATION_MOVED')).toHaveLength(0);
    expect(posOf(truth, 'm1')).toEqual(gp(5, 5));
    expect(truth.orders['o1'].completed).toBeUndefined();
  });

  it('pulse mode: OMP hexes/pulse cross-country, ×1.5 on roads (18 km scale)', () => {
    const roadHexes = Array.from({ length: 12 }, (_, i) =>
      ({ q: i, r: 5, infra: ['ROAD' as const] }));
    const truth = baseTruth('MOVE-SEED', roadHexes, 16);
    truth.clockMode = 'PULSE';
    // road mover: omp 4 × 1.5 ⇒ 6 hexes per pulse
    const fr = addMechFormation(truth, { id: 'road', sideId: 'blue', pos: gp(0, 5), omp: 4 });
    activate(truth, moveOrder('or', fr, 'MOVE',
      Array.from({ length: 11 }, (_, i) => gp(i + 1, 5))));
    // cross-country mover: omp 4 ⇒ 4 hexes per pulse
    const fx = addMechFormation(truth, { id: 'xc', sideId: 'blue', pos: gp(0, 10), omp: 4 });
    activate(truth, moveOrder('ox', fx, 'MOVE',
      Array.from({ length: 11 }, (_, i) => gp(i + 1, 10))));

    run(truth, 10); // one pulse
    expect(posOf(truth, 'road')).toEqual(gp(6, 5));
    expect(posOf(truth, 'xc')).toEqual(gp(4, 10));
  });

  it('forced march: ×1.5 speed and RDY −1 per pulse marched', () => {
    const truth = baseTruth('MOVE-SEED', [], 40);
    truth.clockMode = 'PULSE';
    const f = addMechFormation(truth, { id: 'fm', sideId: 'blue', pos: gp(0, 10), omp: 4 });
    activate(truth, moveOrder('of', f, 'FORCED_MARCH',
      Array.from({ length: 30 }, (_, i) => gp(i + 1, 10))));

    run(truth, 10);
    expect(posOf(truth, 'fm')).toEqual(gp(6, 10)); // 4 × 1.5
    expect(truth.formations['fm'].rdy).toBe(9);

    run(truth, 10);
    expect(truth.formations['fm'].rdy).toBe(8);
  });

  it('cautious move: half speed (D-006)', () => {
    const truth = baseTruth('MOVE-SEED', [], 40);
    truth.clockMode = 'PULSE';
    const f = addMechFormation(truth, { id: 'cm', sideId: 'blue', pos: gp(0, 10), omp: 4 });
    activate(truth, moveOrder('oc', f, 'MOVE_CAUTIOUS',
      Array.from({ length: 20 }, (_, i) => gp(i + 1, 10))));
    run(truth, 10);
    expect(posOf(truth, 'cm')).toEqual(gp(2, 10)); // 4 × 0.5
    expect(truth.formations['cm'].transient?.moved).toBe('CAUTIOUS');
  });

  it('fractional progress carries across steps (no movement lost to rounding)', () => {
    const truth = baseTruth('MOVE-SEED', [], 40);
    truth.clockMode = 'CONTACT';
    const f = addMechFormation(truth, { id: 's1', sideId: 'blue', pos: gp(0, 3), omp: 10 },
      4, { walkOrCruise: 1 });
    // woods on the path: cost 2/hex, omp 10 ⇒ 1 budget/turn ⇒ one hex per 2 contact turns
    for (let q = 1; q <= 4; q++) truth.theaters[T].hexes[`${q},3`].terrain = 'WOODS';
    activate(truth, moveOrder('os', f, 'MOVE', [gp(1, 3), gp(2, 3)]));

    run(truth, 1);
    expect(posOf(truth, 's1')).toEqual(gp(0, 3)); // half paid
    run(truth, 1);
    expect(posOf(truth, 's1')).toEqual(gp(1, 3));
    run(truth, 1);
    run(truth, 1);
    expect(posOf(truth, 's1')).toEqual(gp(2, 3));
    expect(truth.orders['os'].completed).toBe(true);
  });

  it('movement records heading and road flag for detection & vector estimates', () => {
    const truth = baseTruth('MOVE-SEED', [{ q: 6, r: 5, infra: ['ROAD'] }]);
    truth.clockMode = 'CONTACT';
    const f = addMechFormation(truth, { id: 'm1', sideId: 'blue', pos: gp(5, 5), omp: 10 });
    activate(truth, moveOrder('o1', f, 'MOVE', [gp(6, 5)]));
    const events = run(truth, 1);
    const moved = events.find(e => e.type === 'FORMATION_MOVED') as any;
    expect(moved.onRoad).toBe(true);
    expect(moved.headingDeg).toBe(0);
    expect(truth.formations['m1'].lastHeadingDeg).toBe(0);
  });
});
