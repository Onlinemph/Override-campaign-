/**
 * server/diary.ts — the war diary (ext): a side's chronicle of its own war.
 *
 * Built from the event log with the same fog discipline as the live screens: a side's
 * diary contains only what that side experienced — the reports that reached its net,
 * its battles, its losses, its ships crossing the atmosphere, its shop work. Read it
 * top to bottom and you get the campaign as that side lived it: the play-by-mail
 * turn record, the between-sessions catch-up, the lore.
 */
import { CLOCK } from '../rules.js';
import type { TruthState } from '../core/types.js';
import type { LoggedEvent } from '../core/events.js';

export interface DiaryEntry { day: number; tick: number; text: string }

const MAX_ENTRIES = 800; // the most recent slice of a very long war

export function buildDiary(
  s: TruthState, events: LoggedEvent[], sideId: string,
): DiaryEntry[] {
  const out: DiaryEntry[] = [];
  const push = (tick: number, text: string) =>
    out.push({ day: Math.floor(tick / CLOCK.TICKS_PER_DAY) + 1, tick, text });
  const fname = (id: string) => s.formations[id]?.name ?? id;
  const isCarrierShip = (id: string) => {
    const f = s.formations[id];
    return !!f && (!!f.carrier || f.unitIds.some(u => s.units[u]?.class === 'DROPSHIP'));
  };

  for (const { event: e } of events) {
    switch (e.type) {
      case 'REPORT_DELIVERED': {
        const r = s.reports[e.reportId];
        if (r && r.sideId === sideId) push(e.tick, `📨 ${r.text}`);
        break;
      }
      case 'ENGAGEMENT_TRIGGERED': {
        const eng = e.engagement;
        if (eng.attackerSideId !== sideId && eng.defenderSideId !== sideId) break;
        const where = eng.hex ? `hex ${eng.hex.q},${eng.hex.r}`
          : eng.airPos ? `air ${eng.airPos.gridQ},${eng.airPos.gridR}` : 'deep space';
        const ours = (eng.attackerSideId === sideId
          ? eng.attackerFormationIds : eng.defenderFormationIds).map(fname).join(', ');
        push(eng.tick, `⚔ Battle at ${where} — ${ours || 'our forces'} engaged.`);
        break;
      }
      case 'BATTLE_RESULT_INGESTED':
        push(e.tick, '🕊 The battle is over; the campaign clock runs again.');
        break;
      case 'FORMATION_DESTROYED': {
        const f = s.formations[e.formationId];
        if (f?.sideId === sideId) push(e.tick, `☠ ${f.name} — lost (${e.reason}).`);
        break;
      }
      case 'ATMO_TRANSIT': {
        const f = s.formations[e.formationId];
        if (f?.sideId !== sideId) break;
        push(e.tick, e.direction === 'DESCENT'
          ? `☄ ${f.name} hit the atmosphere.`
          : `🚀 ${f.name} climbed to orbit.`);
        break;
      }
      case 'AIR_LANDED': {
        const f = s.formations[e.formationId];
        if (f?.sideId === sideId && isCarrierShip(e.formationId)) {
          push(e.tick, `🛬 ${f.name} put down at ${e.pos.q},${e.pos.r}.`);
        }
        break;
      }
      case 'REPAIR_COMPLETED': {
        const u = s.units[e.unitId];
        if (u?.sideId === sideId) push(e.tick, `🔧 ${u.name} repaired.`);
        break;
      }
      case 'REFIT_COMPLETED': {
        if (e.unit.sideId === sideId) {
          push(e.tick, `🔨 ${e.unit.name} rebuilt into ${fname(e.formationId)}` +
            (e.pilot ? ` — ${e.pilot.name} takes the seat.` : '.'));
        }
        break;
      }
      case 'BLOCKADE_STATE': {
        if (e.sideId === sideId) {
          push(e.tick, e.blockaded
            ? '🚫 The jump points are closed — off-world imports have stopped.'
            : '🟢 The lanes home are open; imports flowing.');
        }
        break;
      }
      case 'CAMPAIGN_ENDED':
        push(e.tick, `🏁 The campaign is over — ${e.winnerSideId
          ? `${s.sides[e.winnerSideId]?.name ?? e.winnerSideId} holds the field`
          : 'no victor'} (${e.reason}).`);
        break;
    }
  }
  // BLOCKADE_STATE repeats daily — keep only transitions
  const dedup: DiaryEntry[] = [];
  let lastBlockade: string | null = null;
  for (const en of out) {
    if (en.text.startsWith('🚫') || en.text.startsWith('🟢')) {
      if (en.text === lastBlockade) continue;
      lastBlockade = en.text;
    }
    dedup.push(en);
  }
  return dedup.slice(-MAX_ENTRIES);
}
