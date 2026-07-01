/**
 * Combat Vehicle card renderer — PURE string builder (no DOM, no CSS import),
 * in the Override record-card style shared with the 'Mech card. Styled by the
 * `.mech-sheet` / `.vdoll` rules in style.css.
 *
 * Differences from the 'Mech card: armor is shown by FACING (front / sides /
 * rear / turret) with armor (purple) over structure (red) hexes, there is no
 * Punch/Kick row, and the weapons table's Loc column holds the firing facing.
 */

import type { RangeBrackets, VehicleCard } from "../core/index.js";
import { armorTypeLabel, vehicleDoll } from "./biped-doll.js";

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

/** The weapons table: one row per facing TIC (no Punch/Kick for vehicles). */
function weaponsTable(card: VehicleCard): string {
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

function equipmentLine(card: VehicleCard): string {
  if (card.equipment.length === 0) return "—";
  return card.equipment
    .map((e) => `${esc(e.label)}${e.count > 1 ? ` ×${e.count}` : ""} <span class="eq-loc">(${esc(e.facing)})</span>`)
    .join(", ");
}

/**
 * Render a combat vehicle as an HTML string in the Override record-card layout:
 * title banner, UNIT DATA (type / mass / move / TMM), the per-facing weapons
 * table, equipment, the OVERRIDE wordmark + skill boxes, and the facing armor
 * diagram (armor over structure hexes).
 */
export function renderVehicleCard(card: VehicleCard): string {
  const warnings = card.warnings.length
    ? `<ul class="warnings">${card.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`
    : "";
  return `<article class="card mech-sheet doll-card">
    <div class="ms-grid">
      <div class="ms-left">
        <div class="ms-title">${esc(card.name)}</div>
        <div class="ms-unitdata">
          <div class="ms-ud-h">UNIT DATA</div>
          <div class="ms-ud-stats">
            <div><b>Type:</b> ${card.support ? "Support " : "Combat "}${card.hasRotor ? "VTOL" : "Vehicle"}</div>
            <div><b>Mass:</b> ${esc(card.tonnage)} Tons</div>
            <div class="ms-ud-move"><b>Move:</b> ${esc(card.move)}</div>
            <div><b>TMM:</b> ${esc(card.tmm)} / ${esc(card.tmm + 1)}</div>
            ${card.armorType ? `<div><b>Armor:</b> ${esc(armorTypeLabel(card.armorType))}</div>` : ""}
          </div>
        </div>
        ${weaponsTable(card)}
        <p class="ms-equip"><b>Equipment:</b> ${equipmentLine(card)}</p>
        <p class="ba-note">Armor / TMM / structure mirror the ’Mech rules (best-effort) — validate against the DFA generator.</p>
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
        ${vehicleDoll(card)}
      </div>
    </div>
  </article>`;
}
