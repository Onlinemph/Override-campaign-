/**
 * Battle Armor card renderer — PURE string builder (no DOM, no CSS import), so
 * it can be reused by the browser UI (main.ts) AND by an offline preview script
 * that emits a standalone HTML file. Output is styled by the `.ba-sheet` rules
 * in style.css, mirroring the printed Override Battle Armor record card.
 */

import type { BattleArmorCard } from "../core/index.js";

/** Escape text for safe insertion into HTML. */
function esc(s: string | number): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** A row of armor pips (one per point). */
function pips(n: number, cls: string): string {
  return `<div class="pips">${`<i class="pip ${cls}"></i>`.repeat(Math.max(0, n))}</div>`;
}

/** A compact inline glyph of a battle-armor trooper, for the squad rows. */
const BA_TROOPER_SVG = `<svg class="ba-fig" viewBox="0 0 24 32" aria-hidden="true">
  <circle cx="12" cy="5" r="4"/>
  <rect x="5" y="9" width="14" height="12" rx="3"/>
  <rect x="1" y="10" width="4" height="9" rx="2"/>
  <rect x="19" y="10" width="4" height="9" rx="2"/>
  <rect x="7" y="21" width="4" height="10" rx="1.5"/>
  <rect x="13" y="21" width="4" height="10" rx="1.5"/>
</svg>`;

/** Format one Override range bracket: null -> "–", else a signed integer. */
function baBracket(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return v >= 0 ? `+${v}` : `${v}`;
}

/** A weapon column header: name, the PB/S/M/L bracket grid, and a "Dmg" label. */
function weaponHeader(
  label: string,
  range: BattleArmorCard["firepower"][number]["range"],
  unknown = false,
): string {
  const flag = unknown ? ' <span class="warn-flag">[?]</span>' : "";
  const cells: [string, string][] = range
    ? [
        ["PB", baBracket(range.pb)],
        ["S", baBracket(range.s)],
        ["M", baBracket(range.m)],
        ["L", baBracket(range.l)],
      ]
    : [
        ["PB", "–"],
        ["S", "–"],
        ["M", "–"],
        ["L", "–"],
      ];
  const rng = `<div class="ba-rng">
    ${cells.map(([h]) => `<span class="ba-rng-h">${h}</span>`).join("")}
    ${cells.map(([, v]) => `<span class="ba-rng-v">${esc(v)}</span>`).join("")}
  </div>`;
  return `<th class="ba-wpn"><div class="ba-wname">${esc(label)}${flag}</div>${rng}<div class="ba-dmg-label">Dmg</div></th>`;
}

/**
 * Squad firepower table, styled after the printed Override Battle Armor card:
 * weapons across the top (each with its PB/S/M/L brackets), surviving troopers
 * down the side (full squad first), each cell the damage that many suits deal.
 * BA does not group into TICs — it sums each trooper's contribution, so damage
 * falls as suits die.
 */
function firepowerTable(card: BattleArmorCard): string {
  if (card.firepower.length === 0) {
    return `<p class="muted">No squad weapons.</p>`;
  }
  const heads = [
    ...card.firepower.map((w) => weaponHeader(w.label, w.range, w.unknown)),
    weaponHeader("Anti-Infantry", { pb: 0, s: 0, m: null, l: null, x: null }),
  ].join("");
  const rows: string[] = [];
  for (let n = card.troopers; n >= 1; n--) {
    const weaponCells = card.firepower
      .map((w) => `<td class="num">${esc(w.byTrooper[n - 1] ?? "–")}</td>`)
      .join("");
    const aiCell = `<td class="num ba-ai">${esc(card.antiInfantryByTrooper[n - 1] ?? "–")}</td>`;
    rows.push(`<tr>
      <th class="ba-count">
        <span class="ba-n">${esc(n)}</span>${BA_TROOPER_SVG}
        <span class="ba-armor-pips">${pips(card.health, "health")}${pips(card.armor, "armor")}</span>
      </th>
      ${weaponCells}${aiCell}
    </tr>`);
  }
  return `<div class="ba-fire-wrap"><table class="ba-firepower">
    <thead><tr><th class="ba-corner">Troopers&nbsp;&amp;&nbsp;Weapons</th>${heads}</tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table></div>`;
}

/** Inline equipment summary for the unit-data panel (or "—" when none). */
function baEquipmentLine(card: BattleArmorCard): string {
  if (card.equipment.length === 0) return "—";
  return card.equipment
    .map((e) => `${esc(e.label)}${e.count > 1 ? ` ×${e.count}` : ""}`)
    .join(", ");
}

/**
 * Render a Battle Armor card as an HTML string: a title banner, a UNIT DATA
 * panel (type / class / move / TMM / anti-'Mech), the OVERRIDE wordmark with
 * blank skill boxes, then the per-trooper firepower table.
 */
export function renderBACard(card: BattleArmorCard): string {
  const warnings = card.warnings.length
    ? `<ul class="warnings">${card.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`
    : "";
  const amech = card.antiMech ? "✕" : "";
  return `<article class="card ba-sheet">
    <div class="ba-top">
      <div class="ba-titlebox">
        <div class="ba-title">${esc(card.name)} <span class="ba-sqd">(SQD${esc(card.troopers)})</span></div>
        <div class="ba-unitdata">
          <div class="ba-ud-h">UNIT DATA</div>
          <div class="ba-ud-row"><b>Type:</b> Battle Armor
            <span class="ba-amech"><span class="ba-check">${amech}</span> Anti-’Mech Attack</span></div>
          <div class="ba-ud-row"><b>Class:</b> ${esc(card.weightClass)} · ${esc(card.techBase)}</div>
          <div class="ba-ud-row"><b>Move:</b> ${esc(card.move)}</div>
          <div class="ba-ud-row"><b>TMM:</b> ${esc(card.tmm)}${card.jumpMP > 0 ? ` <span class="muted">(jump ${esc(card.tmmJump)})</span>` : ""}</div>
          <div class="ba-ud-row"><b>Equipment:</b> ${baEquipmentLine(card)}</div>
        </div>
      </div>
      <div class="ba-brand">
        <div class="ba-skills">
          <div class="ba-skill"><span>Gunnery</span><div class="ba-skill-box"></div></div>
          <div class="ba-skill"><span>Anti-Mech</span><div class="ba-skill-box"></div></div>
        </div>
        <div class="ba-wordmark">B<span class="ba-wm-a">▲</span>TTLETECH<br><b>OVERRIDE</b></div>
      </div>
    </div>
    ${firepowerTable(card)}
    <p class="ba-legend">
      <span class="ba-armor-pips">${pips(card.health, "health")}${pips(card.armor, "armor")}</span>
      <span class="ba-hl-red">1 health</span> (final hit) + ${esc(card.armor)} armor per suit
    </p>
    <p class="ba-note">Armor &amp; TMM mirror the ’Mech rules (best-effort) — validate against the DFA generator.</p>
    ${warnings}
  </article>`;
}
