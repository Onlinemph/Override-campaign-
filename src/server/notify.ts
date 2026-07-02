/**
 * server/notify.ts — the slow war's doorbell (ext).
 *
 * Async campaigns run for weeks with players checking in when life allows; this module
 * pings each side's Discord webhook when something THEIRS happens. Fog of war holds:
 * a side is only ever told what its own screens would show — delivered reports, its own
 * shop/refit completions, its own fuel emergencies, and the engagements it is party to.
 * The GM webhook gets the spectator feed (engagements, results, endings).
 *
 * collectNotifications is pure (unit-tested); postWebhooks is the thin fetch shell.
 */
import type { TruthState } from '../core/types.js';
import type { LoggedEvent } from '../core/events.js';

export interface WebhookConfig {
  gm?: string;                     // OVERRIDE_WEBHOOK_GM
  sides: Record<string, string>;   // OVERRIDE_WEBHOOK_<SIDEID> (uppercased)
}

export function webhookConfigFromEnv(env: NodeJS.ProcessEnv, sideIds: string[]): WebhookConfig {
  const sides: Record<string, string> = {};
  for (const id of sideIds) {
    const url = env[`OVERRIDE_WEBHOOK_${id.toUpperCase()}`];
    if (url) sides[id] = url;
  }
  return { gm: env.OVERRIDE_WEBHOOK_GM, sides };
}

/** side id → lines to send ('gm' for the GM feed). Pure: state + new events in, text out. */
export function collectNotifications(
  s: TruthState, fresh: LoggedEvent[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (who: string, line: string) => { (out[who] ??= []).push(line); };
  const sideName = (id: string) => s.sides[id]?.name ?? id;

  for (const { event: e } of fresh) {
    switch (e.type) {
      case 'REPORT_DELIVERED': {
        const r = s.reports[e.reportId];
        if (r) add(r.sideId, `📨 ${r.text}`);
        break;
      }
      case 'ENGAGEMENT_TRIGGERED': {
        const eng = e.engagement;
        const where = eng.hex ? `hex ${eng.hex.q},${eng.hex.r}`
          : eng.airPos ? `air ${eng.airPos.gridQ},${eng.airPos.gridR}` : 'deep space';
        const line = `⚔ **Engagement** at ${where} — the campaign is frozen. Battle night!`;
        add(eng.attackerSideId, line);
        add(eng.defenderSideId, line);
        add('gm', `⚔ ${sideName(eng.attackerSideId)} vs ${sideName(eng.defenderSideId)} at ${where} — export the handoff when ready.`);
        break;
      }
      case 'BATTLE_RESULT_INGESTED': {
        for (const id of Object.keys(s.sides)) add(id, '🕊 Battle resolved — the campaign clock is running again.');
        add('gm', '🕊 Battle result ingested; campaign unfrozen.');
        break;
      }
      case 'REPAIR_COMPLETED': {
        const u = s.units[e.unitId];
        if (u) add(u.sideId, `🔧 ${u.name} is out of the shop — repaired and ready.`);
        break;
      }
      case 'REFIT_COMPLETED': {
        add(e.unit.sideId, `🔨 ${e.unit.name} rebuilt and delivered to ${s.formations[e.formationId]?.name ?? e.formationId}` +
          (e.pilot ? ` — ${e.pilot.name} takes the seat.` : '.'));
        break;
      }
      case 'FUEL_THRESHOLD': {
        if (e.threshold !== 'BINGO') break;
        const f = s.formations[e.formationId];
        if (f) add(f.sideId, `⛽ **BINGO** — ${f.name} is disengaging on fumes (${e.fpMin} FP).`);
        break;
      }
      case 'CAMPAIGN_ENDED': {
        const line = `🏁 **Campaign over** — ${e.winnerSideId ? `${sideName(e.winnerSideId)} wins` : 'no victor'} (${e.reason}).`;
        for (const id of Object.keys(s.sides)) add(id, line);
        add('gm', line);
        break;
      }
    }
  }
  return out;
}

/** Fire-and-forget Discord posts (content ≤ 2000 chars; failures logged, never thrown). */
export function postWebhooks(
  cfg: WebhookConfig, messages: Record<string, string[]>,
): void {
  for (const [who, lines] of Object.entries(messages)) {
    const url = who === 'gm' ? cfg.gm : cfg.sides[who];
    if (!url || lines.length === 0) continue;
    const content = lines.join('\n').slice(0, 1990);
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    }).catch(err => console.warn(`webhook ${who} failed:`, err?.message ?? err));
  }
}
