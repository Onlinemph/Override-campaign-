/** B4 — clock-mode selection & compression (core §2; spec §3.1). */
import { describe, expect, it } from 'vitest';
import { chooseClockMode, isNight, ticksFor } from '../../src/engine/clock.js';
import { Campaign } from '../../src/core/truth.js';
import { isInterestingEvent } from '../../src/core/events.js';
import { addMechFormation, baseTruth, gp, moveOrder } from '../helpers.js';
import type { Contact } from '../../src/core/types.js';

function mkContact(observerSideId: string, targetFormationId: string, level: 0 | 1 | 2): Contact {
  return {
    id: `contact:${observerSideId}:${targetFormationId}`, observerSideId, targetFormationId,
    kind: 'STANDARD', level, lastConfirmedTick: 0, lastFadeTick: 0,
    estPos: gp(0, 0), posErrorHexes: 0, staleAsOfTick: 0,
  };
}

describe('B4 — clock mode', () => {
  it('WATCH when nothing is happening', () => {
    const truth = baseTruth();
    addMechFormation(truth, { id: 'b1', sideId: 'blue', pos: gp(0, 0) });
    addMechFormation(truth, { id: 'r1', sideId: 'red', pos: gp(20, 10) });
    expect(chooseClockMode(truth)).toBe('WATCH');
  });

  it('PULSE when any side has an incomplete order (active ground ops)', () => {
    const truth = baseTruth();
    addMechFormation(truth, { id: 'b1', sideId: 'blue', pos: gp(0, 0) });
    const r1 = addMechFormation(truth, { id: 'r1', sideId: 'red', pos: gp(20, 10) });
    truth.orders['o1'] = moveOrder('o1', r1, 'MOVE', [gp(19, 10)]);
    expect(chooseClockMode(truth)).toBe('PULSE');
  });

  it('proximity alone is NOT contact mode: both sides must not be blind', () => {
    const truth = baseTruth();
    addMechFormation(truth, { id: 'b1', sideId: 'blue', pos: gp(5, 5) });
    const r1 = addMechFormation(truth, { id: 'r1', sideId: 'red', pos: gp(8, 5) });
    truth.orders['o1'] = moveOrder('o1', r1, 'MOVE', [gp(7, 5)]);
    expect(chooseClockMode(truth)).toBe('PULSE'); // 3 hexes apart but nobody knows
  });

  it('CONTACT when within 5 op-hexes AND at least one side holds ladder ≥1 on the other', () => {
    const truth = baseTruth();
    addMechFormation(truth, { id: 'b1', sideId: 'blue', pos: gp(5, 5) });
    addMechFormation(truth, { id: 'r1', sideId: 'red', pos: gp(8, 5) });
    truth.contacts['c1'] = mkContact('blue', 'r1', 1);
    expect(chooseClockMode(truth)).toBe('CONTACT');
  });

  it('knowledge of a FAR formation does not trigger contact mode for a near blind pair', () => {
    const truth = baseTruth();
    addMechFormation(truth, { id: 'b1', sideId: 'blue', pos: gp(5, 5) });
    addMechFormation(truth, { id: 'r1', sideId: 'red', pos: gp(8, 5) });   // near, unknown
    addMechFormation(truth, { id: 'r2', sideId: 'red', pos: gp(25, 15) }); // far, known
    truth.contacts['c2'] = mkContact('blue', 'r2', 2);
    expect(chooseClockMode(truth)).toBe('PULSE'); // contact on r2 keeps ops active, not contact mode
  });

  it('dt: CONTACT 1, PULSE 10, WATCH 60', () => {
    expect(ticksFor('CONTACT')).toBe(1);
    expect(ticksFor('PULSE')).toBe(10);
    expect(ticksFor('WATCH')).toBe(60);
  });

  it('day/night from config: dawn 60 / dusk 180', () => {
    const truth = baseTruth();
    expect(isNight(truth, 0)).toBe(true);     // midnight
    expect(isNight(truth, 59)).toBe(true);
    expect(isNight(truth, 60)).toBe(false);   // dawn
    expect(isNight(truth, 179)).toBe(false);
    expect(isNight(truth, 180)).toBe(true);   // dusk
    expect(isNight(truth, 240 + 30)).toBe(true); // next day wraps
  });

  it('compression: empty watches emit nothing interesting and runUntilEvent fast-forwards', () => {
    const truth = baseTruth();
    addMechFormation(truth, { id: 'b1', sideId: 'blue', pos: gp(0, 0) });
    addMechFormation(truth, { id: 'r1', sideId: 'red', pos: gp(25, 15) });
    const campaign = Campaign.create(truth);

    const events = campaign.runUntilEvent(240); // a full quiet day
    expect(events.some(isInterestingEvent)).toBe(false);
    expect(campaign.truth.tick).toBe(240);     // fast-forwarded the whole cap
    expect(campaign.truth.clockMode).toBe('WATCH');
  });

  it('compression stops on the first interesting event (an arrival)', () => {
    const truth = baseTruth();
    addMechFormation(truth, { id: 'b1', sideId: 'blue', pos: gp(0, 0) });
    const r1 = addMechFormation(truth, { id: 'r1', sideId: 'red', pos: gp(25, 15) });
    truth.orders['o1'] = moveOrder('o1', r1, 'MOVE', [gp(24, 15), gp(23, 15)]);
    const campaign = Campaign.create(truth);

    const events = campaign.runUntilEvent(240);
    expect(events.some(e => e.type === 'ORDER_COMPLETED')).toBe(true);
    expect(campaign.truth.tick).toBeLessThan(240); // stopped early, did not burn the day
  });
});
