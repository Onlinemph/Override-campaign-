/** The slow war's doorbell (ext): per-side Discord pings that respect the fog. */
import { describe, expect, it } from 'vitest';
import { collectNotifications, webhookConfigFromEnv } from '../../src/server/notify.js';
import type { LoggedEvent } from '../../src/core/events.js';
import { addMechFormation, baseTruth, gp } from '../helpers.js';

const log = (events: object[]): LoggedEvent[] =>
  events.map((event, i) => ({ index: i, event } as LoggedEvent));

describe('collectNotifications — fog of war holds', () => {
  it('a delivered report pings only its side; engagements ping both parties and the GM', () => {
    const truth = baseTruth('NOTIFY-1');
    addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(5, 5) });
    truth.reports['r1'] = {
      id: 'r1', sideId: 'blue', generatedTick: 3, deliveredTick: 5,
      sourceFormationId: 'blue-1', contactId: 'c1',
      text: 'T+3 — Recon Lance: CONTACT, company-strength, hex 8,4',
      snapshot: { level: 3, estPos: gp(8, 4), posErrorHexes: 0, asOfTick: 3 },
    };
    const msgs = collectNotifications(truth, log([
      { type: 'REPORT_DELIVERED', reportId: 'r1', tick: 5 },
      { type: 'ENGAGEMENT_TRIGGERED', engagement: {
        id: 'e1', tick: 6, hex: gp(8, 4), trigger: 'SAME_HEX',
        attackerSideId: 'red', defenderSideId: 'blue',
        attackerFormationIds: [], defenderFormationIds: [], status: 'PENDING' } },
    ]));
    expect(msgs['blue'].some(m => m.includes('Recon Lance'))).toBe(true);
    expect(msgs['red']).toHaveLength(1);                       // the battle ping only
    expect(msgs['red'][0]).toContain('Engagement');
    expect(msgs['gm'][0]).toContain('Red');                    // GM sees who vs who
    // the report text never reaches the other side
    expect(msgs['red'].join()).not.toContain('Recon Lance');
  });

  it('shop, refit, and bingo pings go to the owner; endings go to everyone', () => {
    const truth = baseTruth('NOTIFY-2');
    const f = addMechFormation(truth, { id: 'blue-1', sideId: 'blue', pos: gp(5, 5) });
    const msgs = collectNotifications(truth, log([
      { type: 'REPAIR_COMPLETED', unitId: f.unitIds[0], tick: 9 },
      { type: 'FUEL_THRESHOLD', formationId: 'blue-1', threshold: 'BINGO', fpMin: 12, tick: 9 },
      { type: 'FUEL_THRESHOLD', formationId: 'blue-1', threshold: 'JOKER', fpMin: 40, tick: 9 },
      { type: 'CAMPAIGN_ENDED', winnerSideId: 'red', reason: 'reached 25 VP', tick: 9 },
    ]));
    expect(msgs['blue'].filter(m => m.includes('shop'))).toHaveLength(1);
    expect(msgs['blue'].filter(m => m.includes('BINGO'))).toHaveLength(1); // joker is quiet
    expect(msgs['blue'].some(m => m.includes('Campaign over'))).toBe(true);
    expect(msgs['red'].some(m => m.includes('Campaign over'))).toBe(true);
    expect(msgs['gm'].some(m => m.includes('Campaign over'))).toBe(true);
  });
});

describe('webhookConfigFromEnv', () => {
  it('reads OVERRIDE_WEBHOOK_<SIDE> and _GM, ignores unset sides', () => {
    const cfg = webhookConfigFromEnv({
      OVERRIDE_WEBHOOK_BLUE: 'https://discord/blue',
      OVERRIDE_WEBHOOK_GM: 'https://discord/gm',
    } as NodeJS.ProcessEnv, ['blue', 'red']);
    expect(cfg.sides).toEqual({ blue: 'https://discord/blue' });
    expect(cfg.gm).toBe('https://discord/gm');
  });
});
