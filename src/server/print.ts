/**
 * server/print.ts — the paper bridge (ext, D-034): a battle pack the GM prints and
 * takes to the table, so game night needs no laptops until the result comes home.
 *
 * Page 1 (per side): the briefing the campaign derived — entry edge, deploy order,
 * initiative, posture, RDY penalty, off-board support — plus the roster with each
 * unit's pilot, coarse state, and the persisted record-sheet damage spelled out so
 * the cards can be pre-marked before play.
 * Page 2: a blank result form whose fields mirror BattleResult one-to-one, so typing
 * the outcome back into the tracker afterwards is transcription, not archaeology.
 *
 * Pure (string in, string out): the server route and the tests both call it.
 */
import type { BattleRoster, BattleRosterSide, BattleRosterUnit } from '../handoff/battle.js';
import { CLOCK } from '../rules.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function dayClock(tick: number): string {
  const day = Math.floor(tick / CLOCK.TICKS_PER_DAY) + 1;
  const minutes = (tick % CLOCK.TICKS_PER_DAY) * CLOCK.TICK_MINUTES;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `Day ${day}, ${hh}:${mm}`;
}

/** The persisted record-sheet marks, in words the GM copies onto the card. */
export function describeSheetDamage(d: Record<string, unknown> | undefined): string {
  if (!d) return '';
  const parts: string[] = [];
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  const rec = (v: unknown): Record<string, number> =>
    (v && typeof v === 'object' ? v as Record<string, number> : {});
  const locs = Object.entries(rec(d.loc)).filter(([, n]) => n > 0);
  if (locs.length) parts.push('boxes: ' + locs.map(([k, n]) => `${k} ${n}`).join(', '));
  const groups = Object.entries(rec(d.groups)).filter(([, n]) => n > 0);
  if (groups.length) parts.push('groups: ' + groups.map(([k, n]) => `${k} ${n}`).join(', '));
  for (const crit of ['engine', 'gyro', 'avionics'] as const) {
    if (num(d[crit]) > 0) parts.push(`${crit} crit ×${num(d[crit])}`);
  }
  if (num(d.legHits) > 0) parts.push(`leg hits ×${num(d.legHits)}`);
  if (num(d.heat) > 0) parts.push(`heat ${num(d.heat)}`);
  const ammo = Object.entries(rec(d.ammo)).filter(([, n]) => n > 0);
  if (ammo.length) parts.push('ammo spent: ' + ammo.map(([k, n]) => `${k} ×${n}`).join(', '));
  if (num(d.condition) > 0) parts.push(`pilot hits ${num(d.condition)}`);
  if (d.out) parts.push('OUT OF ACTION');
  return parts.join(' · ');
}

function setupLines(side: BattleRosterSide): string[] {
  const s = side.setup;
  const lines: string[] = [];
  lines.push(`Enter from: <b>${esc(String(s.entryEdge))}</b>` +
    (s.deploysFirst ? ' — <b>deploys first</b>' : ''));
  if (s.initiativeBonus > 0) {
    lines.push(`Initiative: <b>+${s.initiativeBonus}</b> for the first ${s.initiativeBonusTurns} turns`);
  }
  if (s.hiddenSetup) lines.push('<b>Hidden setup</b> — place units concealed');
  if (s.fortified) lines.push('<b>Fortified</b> — entrenchments apply');
  if (s.rdyTnPenalty > 0) lines.push(`Worn down: <b>+${s.rdyTnPenalty} TN</b> on all rolls (low readiness)`);
  if (s.offboard.artillery > 0) {
    lines.push(`Off-board artillery: <b>${s.offboard.artillery} tube${s.offboard.artillery === 1 ? '' : 's'}</b> in range`);
  }
  for (const a of s.offboard.airOnStation) {
    lines.push(`Air on call: arrives turn <b>${a.arrivesTurn}</b> (${a.fpOnStation} FP on station)`);
  }
  for (const r of s.offboard.reinforcements) {
    lines.push(`Reinforcements: turn <b>${r.arrivesTurn}</b> from ${esc(r.edge)}`);
  }
  if (lines.length === 1 && !s.deploysFirst) lines.push('No special setup');
  return lines;
}

function airCols(units: BattleRosterUnit[]): boolean {
  return units.some(u => u.velocity !== undefined || u.fpOnTable !== undefined);
}

function rosterTable(side: BattleRosterSide): string {
  const air = airCols(side.units);
  const head = `<tr><th>Unit</th><th>Pilot (G/P)</th><th>Status</th><th>Ammo</th>` +
    (air ? '<th>Vel</th><th>Alt</th><th>FP (joker/bingo)</th>' : '') +
    `<th>Carry-over damage — pre-mark the card</th></tr>`;
  const rows = side.units.map(u => {
    const sheet = describeSheetDamage(u.sheetDamage);
    const fp = u.fpOnTable !== undefined
      ? `${u.fpOnTable}${u.jokerFp !== undefined ? ` (${u.jokerFp}/${u.bingoFp})` : ''}` : '';
    return `<tr><td><b>${esc(u.model)}</b></td>` +
      `<td>${esc(u.pilot ?? '—')} (${u.gunnery}/${u.piloting})</td>` +
      `<td>${esc(u.damage)}</td><td>${esc(u.ammoState)}</td>` +
      (air ? `<td>${u.velocity ?? ''}</td><td>${u.altLevel ?? ''}</td><td>${fp}</td>` : '') +
      `<td class="sheet">${sheet ? esc(sheet) : '<span class="dim">clean sheet</span>'}</td></tr>`;
  }).join('\n');
  return `<table>${head}\n${rows}</table>`;
}

function resultRows(side: BattleRosterSide): string {
  return side.units.map(u =>
    `<tr><td><b>${esc(u.model)}</b><br><span class="dim">${esc(u.pilot ?? '')}</span></td>` +
    `<td>☐ OK &nbsp;☐ Damaged &nbsp;☐ Crippled &nbsp;☐ Destroyed &nbsp;☐ Salvage</td>` +
    `<td>☐ Full &nbsp;☐ Partial &nbsp;☐ Dry</td>` +
    `<td class="blank"></td><td class="blank"></td><td>☐</td></tr>`).join('\n');
}

/** The whole battle pack as a standalone printable page. */
export function buildBattlePack(roster: BattleRoster, campaignName = ''): string {
  const sidesHtml = roster.sides.map(side => `
<section class="side">
  <h2>${esc(side.name)}</h2>
  <ul class="setup">${setupLines(side).map(l => `<li>${l}</li>`).join('')}</ul>
  ${rosterTable(side)}
</section>`).join('\n');

  const formHtml = roster.sides.map(side => `
<h3>${esc(side.name)}</h3>
<table class="form">
<tr><th>Unit</th><th>Outcome</th><th>Ammo</th><th>Pilot hits</th><th>Kills</th><th>Ejected</th></tr>
${resultRows(side)}
</table>`).join('\n');

  const rules = roster.specialRules.map(r => `<span class="chip">${esc(r)}</span>`).join(' ');
  return `<!doctype html>
<meta charset="utf-8">
<title>Battle pack — ${esc(campaignName || roster.handoffId)}</title>
<style>
  body { font: 13px/1.45 system-ui, sans-serif; color: #111; background: #fff;
         max-width: 960px; margin: 0 auto; padding: 20px; }
  h1 { font-size: 20px; margin: 0 0 2px; } h2 { font-size: 16px; margin: 18px 0 4px;
       border-bottom: 2px solid #111; padding-bottom: 2px; }
  h3 { font-size: 14px; margin: 14px 0 4px; }
  .dim { color: #777; } .meta { color: #444; margin-bottom: 10px; }
  .chip { border: 1px solid #999; border-radius: 3px; padding: 0 5px; font-size: 11px;
          white-space: nowrap; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0 12px; }
  th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .sheet { font-size: 12px; }
  ul.setup { margin: 4px 0 8px 18px; padding: 0; }
  .form td.blank { min-width: 60px; }
  .formpage { page-break-before: always; }
  .lines div { border-bottom: 1px solid #999; height: 20px; }
  .noprint { background: #ffc; border: 1px solid #cc0; padding: 6px 10px; margin: 10px 0; }
  @media print { .noprint { display: none; } body { padding: 0; } }
</style>
<div class="noprint">🖨 Print this page (Ctrl/Cmd-P). Page 1 sets up the table; page 2 is the
result form — fill it at the table, then copy it into the battle tracker or GM screen.</div>
<h1>OVERRIDE battle pack ${campaignName ? '— ' + esc(campaignName) : ''}</h1>
<p class="meta">${dayClock(roster.tick)} (tick ${roster.tick}) · table: <b>${esc(roster.table)}</b>
 · map: ${esc(roster.mapSheets.join('; '))}${roster.nodeName ? ' · at ' + esc(roster.nodeName) : ''}
 · <span class="dim">${esc(roster.handoffId)}</span><br>${rules}</p>
${sidesHtml}
<section class="formpage">
<h2>Result form — fill at the table</h2>
${formHtml}
<table class="form">
<tr><th style="width:30%">Victor (side)</th><td class="blank"></td></tr>
<tr><th>Who holds the hex/field</th><td class="blank"></td></tr>
<tr><th>Turns elapsed</th><td class="blank"></td></tr>
<tr><th>Aero: fuel remaining per flight</th><td class="blank"></td></tr>
</table>
<h3>Notes (salvage claims, withdrawals &amp; edges, anything unusual)</h3>
<div class="lines"><div></div><div></div><div></div><div></div><div></div></div>
</section>
`;
}
