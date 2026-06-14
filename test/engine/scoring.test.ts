/** M6 — objective control, daily VP accrual, campaign endings (core §12). */
import { describe, expect, it } from 'vitest';
import { scoringPass } from '../../src/engine/scoring.js';
import { applyEvent, type GameEvent } from '../../src/core/events.js';
import { Campaign } from '../../src/core/truth.js';
import { CLOCK } from '../../src/rules.js';
import { addMechFormation, baseTruth, gp } from '../helpers.js';
import type { TruthState } from '../../src/core/types.js';

function run(truth: TruthState): GameEvent[] {
  const events: GameEvent[] = [];
  scoringPass(truth, e => { events.push(e); applyEvent(truth, e); });
  return events;
}

function withObjective(truth: TruthState, q: number, r: number,
                       o: { vpPerDay: number; hidden?: boolean; fake?: boolean; ownerSideId?: string }) {
  truth.theaters['theater-1'].hexes[`${q},${r}`].objective = { hidden: false, ...o };
}

describe('M6 — objective control', () => {
  it('a sole occupant takes an uncontested objective; control persists when it leaves', () => {
    const truth = baseTruth();
    withObjective(truth, 5, 5, { vpPerDay: 3 });
    addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(5, 5) });
    run(truth);
    expect(truth.theaters['theater-1'].hexes['5,5'].objective!.ownerSideId).toBe('blue');

    // blue walks off — it still holds what it took (no flip without a new sole holder)
    truth.formations['blue-1'].pos = gp(6, 5);
    run(truth);
    expect(truth.theaters['theater-1'].hexes['5,5'].objective!.ownerSideId).toBe('blue');
  });

  it('a contested hex does not flip control (the engagement layer owns that)', () => {
    const truth = baseTruth();
    withObjective(truth, 5, 5, { vpPerDay: 3, ownerSideId: 'blue' });
    addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(5, 5) });
    addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(5, 5) });
    expect(run(truth).some(e => e.type === 'OBJECTIVE_CONTROL')).toBe(false);
    expect(truth.theaters['theater-1'].hexes['5,5'].objective!.ownerSideId).toBe('blue');
  });

  it('fake objectives are never owned and never scored', () => {
    const truth = baseTruth();
    withObjective(truth, 5, 5, { vpPerDay: 9, fake: true });
    addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(5, 5) });
    truth.tick = CLOCK.TICKS_PER_DAY;
    run(truth);
    expect(truth.theaters['theater-1'].hexes['5,5'].objective!.ownerSideId).toBeUndefined();
    expect(truth.sides['blue'].vp).toBe(0);
  });
});

describe('M6 — daily VP accrual', () => {
  it('scores each held objective once per day, anchored against clock compression', () => {
    const truth = baseTruth();
    withObjective(truth, 5, 5, { vpPerDay: 3, ownerSideId: 'blue' });   // spaceport
    withObjective(truth, 8, 8, { vpPerDay: 1, ownerSideId: 'blue' });   // depot
    withObjective(truth, 2, 2, { vpPerDay: 2, ownerSideId: 'red' });    // factory

    truth.tick = CLOCK.TICKS_PER_DAY - 1;
    run(truth);
    expect(truth.sides['blue'].vp).toBe(0); // a day hasn't elapsed yet

    truth.tick = CLOCK.TICKS_PER_DAY;
    run(truth);
    expect(truth.sides['blue'].vp).toBe(4); // 3 + 1
    expect(truth.sides['red'].vp).toBe(2);
    expect(truth.lastScoredTick).toBe(CLOCK.TICKS_PER_DAY);

    // jump three days in one coarse move: all three days score (no skipping)
    truth.tick = CLOCK.TICKS_PER_DAY * 4;
    run(truth);
    expect(truth.sides['blue'].vp).toBe(4 * 4);
    expect(truth.sides['red'].vp).toBe(2 * 4);
  });

  it('held system nodes (jump points, gas giants) score too', () => {
    const truth = baseTruth();
    truth.system.nodes['zenith'] = { id: 'zenith', type: 'JUMP_ZENITH', name: 'Zenith',
      surveyedBy: [], secret: false, objective: { vpPerDay: 2, ownerSideId: 'red' } };
    truth.tick = CLOCK.TICKS_PER_DAY;
    run(truth);
    expect(truth.sides['red'].vp).toBe(2);
  });
});

describe('M6 — endings (core §12.2)', () => {
  it('first side to the VP threshold wins and freezes the campaign', () => {
    const truth = baseTruth();
    truth.config.vpThreshold = 5;
    withObjective(truth, 5, 5, { vpPerDay: 3, ownerSideId: 'blue' });
    const c = Campaign.create(truth);

    let guard = 0;
    while (!c.truth.ended && guard++ < 2000) c.step();
    expect(c.truth.ended).toBeTruthy();
    expect(c.truth.ended!.winnerSideId).toBe('blue');
    expect(c.truth.sides['blue'].vp).toBeGreaterThanOrEqual(5);

    // frozen: further steps are no-ops
    const tick = c.truth.tick;
    expect(c.step()).toHaveLength(0);
    expect(c.truth.tick).toBe(tick);
  });

  it('the wall-clock end tick ends it; highest VP wins, equal VP is a draw', () => {
    const win = baseTruth();
    win.config.endTick = CLOCK.TICKS_PER_DAY;
    win.theaters['theater-1'].hexes['5,5'].objective = { vpPerDay: 2, hidden: false, ownerSideId: 'blue' };
    const c = Campaign.create(win);
    let guard = 0;
    while (!c.truth.ended && guard++ < 2000) c.step();
    expect(c.truth.ended!.winnerSideId).toBe('blue');
    expect(c.truth.ended!.reason).toContain('time limit');

    const draw = baseTruth('DRAW-SEED');
    draw.config.endTick = CLOCK.TICKS_PER_DAY; // nobody scores ⇒ 0–0 draw
    const d = Campaign.create(draw);
    let g2 = 0;
    while (!d.truth.ended && g2++ < 2000) d.step();
    expect(d.truth.ended!.winnerSideId).toBeNull();
    expect(d.truth.ended!.reason).toContain('draw');
  });

  it('the ending survives replay (it is in the log)', async () => {
    const truth = baseTruth();
    truth.config.vpThreshold = 3;
    truth.theaters['theater-1'].hexes['5,5'].objective = { vpPerDay: 3, hidden: false, ownerSideId: 'red' };
    const c = Campaign.create(truth);
    let guard = 0;
    while (!c.truth.ended && guard++ < 2000) c.step();
    const { replay } = await import('../../src/core/truth.js');
    expect(replay(c.store.all())).toEqual(c.truth);
  });
});
