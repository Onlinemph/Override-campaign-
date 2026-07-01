/**
 * Aerospace / Conventional Fighter card renderer — PURE string builder (no DOM,
 * no CSS import), in the Override record-card style shared with the 'Mech and
 * vehicle cards. Styled by the `.mech-sheet` / `.fdoll` rules in style.css.
 *
 * Armor is shown by FACING (nose / wings / aft) with armor (purple) over
 * structure (red) hexes; movement is thrust (safe / max); the weapons table's
 * Loc column holds the firing facing. Hit numbers use the Override fighter table
 * (Nose 6-8, R-Wing 3-5, L-Wing 9-11, Aft 2 & 12).
 */

import type { FighterCard, RangeBrackets } from "../core/index.js";
import { armorTypeLabel, fighterDoll } from "./biped-doll.js";

function esc(s: string | number): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function bracket(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return v >= 0 ? `+${v}` : `${v}`;
}

function rangeCells(r: RangeBrackets | null): string {
  const vals = r ? [r.pb, r.s, r.m, r.l, r.x] : [null, null, null, null, null];
  return vals.map((v) => `<td class="num rng">${esc(bracket(v))}</td>`).join("");
}

/** The weapons table: one row per facing TIC. */
function weaponsTable(card: FighterCard): string {
  if (card.weapons.length === 0) {
    return `<p class="muted">No weapons.</p>`;
  }
  const rows = card.weapons
    .map((w) => {
      const flag = w.unknown ? ' <span class="warn-flag">[?]</span>' : "";
      return `<tr>
        <td class="wname">${esc(w.label)}${w.tc ? ' <span class="tc-flag">(TC)</span>' : ""}${flag}</td>
        <td class="num wdmg">${esc(w.damageText)}</td>
        <td class="num">${esc(w.heat)}</td>
        <td class="loc">${esc(w.facing)}</td>
        ${rangeCells(w.range)}
      </tr>`;
    })
    .join("");
  return `<table class="mweapons">
    <thead><tr>
      <th class="wname">Weapons</th><th class="num">Dmg</th><th class="num">Ht</th>
      <th class="loc">Loc</th><th class="num">PB</th><th class="num">S</th>
      <th class="num">M</th><th class="num">L</th><th class="num">X</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function equipmentLine(card: FighterCard): string {
  if (card.equipment.length === 0) return "—";
  return card.equipment
    .map((e) => `${esc(e.label)}${e.count > 1 ? ` ×${e.count}` : ""} <span class="eq-loc">(${esc(e.facing)})</span>`)
    .join(", ");
}

/** Aerospace heat scale: the 'Mech strip with a thrust-flavored level 1. */
const AERO_HEAT_SCALE = [
  { n: 5, cls: "h5", txt: "Automatic Shutdown" },
  { n: 4, cls: "h4", txt: "Ammo Explosion (avoid 8+)" },
  { n: 3, cls: "h3", txt: "Shutdown (avoid 8+)" },
  { n: 2, cls: "h2", txt: "+1 Ranged Attack Mod" },
  { n: 1, cls: "h1", txt: "-2 Safe Thrust / -1 TMM" },
  { n: 0, cls: "h0", txt: "No Effects" },
];

function heatScale(): string {
  const rows = AERO_HEAT_SCALE.map(
    (r) => `<div class="hs-row"><span class="hs-n ${r.cls}">${r.n}</span><span class="hs-t">${esc(r.txt)}</span></div>`,
  ).join("");
  return `<div class="heatscale"><div class="hs-label">Heat Scale</div><div class="hs-rows">${rows}</div></div>`;
}

/** Pilot condition monitor + Engine / Avionics crit boxes (mirrors the 'Mech card). */
function conditionMonitor(): string {
  const box = '<span class="cm-box"></span>';
  const track = ["3+", "5+", "7+", "9+", "11+"]
    .map((t) => `<span class="cm-pip">${t}</span>`)
    .join("");
  return `<div class="condmon">
    <span class="cm-grp">Engine ${box}${box}</span>
    <span class="cm-grp">Avionics ${box}${box}</span>
    <span class="cm-grp">Condition ${track}<span class="cm-pip kia">KIA</span></span>
  </div>`;
}

/**
 * Render an aerospace/conventional fighter as an HTML string in the Override
 * record-card layout: title banner, UNIT DATA (type / mass / thrust + sinks /
 * TMM + DThr, with the heat scale for aerospace — conventional fighters do not
 * track heat), the per-facing weapons table, equipment, a pilot condition
 * monitor, the OVERRIDE wordmark + skill boxes, and the facing armor diagram.
 */
export function renderFighterCard(card: FighterCard): string {
  const warnings = card.warnings.length
    ? `<ul class="warnings">${card.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`
    : "";
  const type = card.conventional ? "Conventional Fighter" : "Aerospace Fighter";
  const sinks = card.conventional ? "" : ` <b>Sinks:</b> ${esc(card.sinks)}`;
  // Fuel tonnage: 80 points/ton for aerospace, 160/ton for conventional (double).
  const fuelTons = card.fuel ? +(card.fuel / (card.conventional ? 160 : 80)).toFixed(1) : 0;
  const fuel = card.fuel ? `<div><b>Fuel:</b> ${esc(card.fuel)} pts <span class="muted">(${esc(fuelTons)} t)</span></div>` : "";
  return `<article class="card mech-sheet doll-card">
    <div class="ms-grid">
      <div class="ms-left">
        <div class="ms-title">${esc(card.name)}</div>
        <div class="ms-unitdata">
          <div class="ms-ud-h">UNIT DATA</div>
          <div class="ms-ud-cols">
            <div class="ms-ud-stats">
              <div><b>Type:</b> ${type}</div>
              <div><b>Mass:</b> ${esc(card.tonnage)} Tons</div>
              <div class="ms-ud-move"><b>Thrust:</b> ${esc(card.move)}${sinks}</div>
              <div><b>TMM:</b> ${esc(card.tmm)} <b>DThr:</b> ${esc(card.dthr)}</div>
              ${card.armorType ? `<div><b>Armor:</b> ${esc(armorTypeLabel(card.armorType))}</div>` : ""}
              ${fuel}
            </div>
            ${card.conventional ? "" : heatScale()}
          </div>
        </div>
        ${weaponsTable(card)}
        <p class="ms-equip"><b>Equipment:</b> ${equipmentLine(card)}</p>
        ${conditionMonitor()}
        ${warnings}
      </div>
      <div class="ms-right">
        <div class="ms-brand">
          <div class="ms-skills">
            <div class="ms-skill"><span>Gunnery</span><div class="ms-skill-box"></div></div>
            <div class="ms-skill"><span>Piloting</span><div class="ms-skill-box"></div></div>
          </div>
          <div class="ms-wordmark">B<span class="ms-wm-a">▲</span>TTLETECH<br><b>OVERRIDE</b></div>
        </div>
        ${fighterDoll(card)}
      </div>
    </div>
  </article>`;
}
