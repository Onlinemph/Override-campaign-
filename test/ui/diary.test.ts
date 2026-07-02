/** The war diary (ext): each side's chronicle, fog-scoped, day-grouped. */
import { describe, expect, it } from 'vitest';
import { buildDiary } from '../../src/server/diary.js';
import { CLOCK } from '../../src/rules.js';
import type { LoggedEvent } from '../../src/core/events.js';
import { addMechFormation, baseTruth, gp } from '../helpers.js';

const log = (events: object[]): LoggedEvent[] =>
  events.map((event, i) => ({ index: i, event } as LoggedEvent));

describe('buildDiary', () => {
  it('chronicles only what the side lived, grouped by day, blockade transitions deduped', () => {
    const truth = baseTruth('DIARY-1');
    addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(5, 5) });
    addMechFormation(truth, { id: 'red-1', sideId: 'red', pos: gp(9, 9) });
    truth.reports['r1'] = {
      id: 'r1', sideId: 'blue', generatedTick: 10, deliveredTick: 12,
      sourceFormationId: 'blue-1', contactId: 'c',
      text: 'T+10 — Recon: SHADOW company-strength hex 8,4',
      snapshot: { level: 2, estPos: gp(8, 4), posErrorHexes: 0, asOfTick: 10 },
    };
    const D = CLOCK.TICKS_PER_DAY;
    const events = log([
      { type: 'REPORT_DELIVERED', reportId: 'r1', tick: 12 },
      { type: 'FORMATION_DESTROYED', formationId: 'red-1', reason: 'lost in battle', tick: 20 },
      { type: 'BLOCKADE_STATE', sideId: 'blue', blockaded: false, tick: D },
      { type: 'BLOCKADE_STATE', sideId: 'blue', blockaded: false, tick: 2 * D }, // repeat: deduped
      { type: 'BLOCKADE_STATE', sideId: 'blue', blockaded: true, tick: 3 * D },  // transition: kept
      { type: 'CAMPAIGN_ENDED', winnerSideId: 'red', reason: 'reached 25 VP', tick: 3 * D + 5 },
    ]);

    const blue = buildDiary(truth, events, 'blue');
    expect(blue.map(e => [...e.text][0])).toEqual(['📨', '🟢', '🚫', '🏁']);
    expect(blue[0].day).toBe(1);
    expect(blue[2].day).toBe(4); // day boundaries computed from ticks

    // red never learns about blue's report; red DOES see its own loss
    const red = buildDiary(truth, events, 'red');
    expect(red.map(e => [...e.text][0])).toEqual(['☠', '🏁']);
    expect(red.join('')).not.toContain('Recon');
  });
});
