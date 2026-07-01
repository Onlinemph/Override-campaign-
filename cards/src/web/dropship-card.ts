/**
 * DropShip card renderer — PURE string builder (no DOM, no CSS import), in the
 * Override record-card style shared with the aerospace fighter card. Styled by
 * `.mech-sheet` / `.ddoll` rules in style.css.
 *
 * Differences from the fighter card: four firing ARCS (Nose / Left Side / Right
 * Side / Aft) drawn as a diamond with NUMERIC armor values (dropship armor runs
 * into the hundreds — pips don't scale), SI in the center, and a CAPACITY line
 * for transport bays. Hit numbers mirror the fighter table (Nose 6-8, R-Side
 * 3-5, L-Side 9-11, Aft 2 & 12).
 */

import type { DropshipCard, RangeBrackets } from "../core/index.js";
import { armorTypeLabel, dropshipDoll } from "./biped-doll.js";

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

/** One WarShip arc box: label over a numeric armor value (no 2d6 hit row —
 * capital combat selects the firing arc rather than rolling a 2d6 hit table). */
function wsArcBox(area: string, label: string, armor: number): string {
  return `<div class="dloc ${area}">
    <div class="dloc-name">${esc(label)}</div>
    <div class="dloc-val">${esc(armor)}</div>
  </div>`;
}

/** SI core box, shared by both diagrams. */
function siBox(card: DropshipCard): string {
  return `<div class="dloc dsi">
      <div class="dloc-name">SI</div>
      <div class="dloc-val si">${esc(card.structure)}</div>
    </div>`;
}

/** Arc armor diagram. DropShips get an Aerodyne/Spheroid hull doll; WarShips
 * keep the SIX hex sides (nose / fore-L/R / aft-L/R / aft) around the SI core. */
function armorDiagram(card: DropshipCard): string {
  const a = card.armor;
  if (card.shipClass === "WarShip") {
    return `<div class="ddoll warship">
    ${wsArcBox("dfl", "Fore-Left", a.foreLeft ?? a.leftSide)}
    ${wsArcBox("dnose", "Nose", a.nose)}
    ${wsArcBox("dfr", "Fore-Right", a.foreRight ?? a.rightSide)}
    ${wsArcBox("dal", "Aft-Left", a.aftLeft ?? a.leftSide)}
    ${siBox(card)}
    ${wsArcBox("dar", "Aft-Right", a.aftRight ?? a.rightSide)}
    ${wsArcBox("daft", "Aft", a.aft)}
  </div>
  <p class="mdoll-legend">Armor per hex side (capital ÷ 3) · SI = structural integrity</p>`;
  }
  return dropshipDoll(card);
}

/** The weapons table: one row per arc TIC. */
/** Arc code -> full firing-arc name shown as the section header. */
const ARC_NAMES: Readonly<Record<string, string>> = {
  NO: "Nose",
  LS: "Left Side",
  RS: "Right Side",
  AF: "Aft",
  HL: "Hull",
  // WarShip arcs.
  FL: "Left Front Side",
  FR: "Right Front Side",
  LB: "Left Broadside",
  RB: "Right Broadside",
  AL: "Aft Left Side",
  AR: "Aft Right Side",
};
const ARC_DISPLAY_ORDER = ["NO", "FL", "FR", "LB", "RB", "AL", "AR", "AF", "LS", "RS", "HL"];

function weaponsTable(card: DropshipCard): string {
  if (card.weapons.length === 0) {
    return `<p class="muted">No weapons.</p>`;
  }
  // Group the bay rows by firing arc — each arc is its own banded section, so the
  // (often long) DropShip/WarShip weapon list reads clearly on a printed sheet.
  const byArc = new Map<string, DropshipCard["weapons"]>();
  for (const w of card.weapons) {
    const list = byArc.get(w.facing) ?? [];
    list.push(w);
    byArc.set(w.facing, list);
  }
  const arcs = ARC_DISPLAY_ORDER.filter((a) => byArc.has(a)).concat(
    [...byArc.keys()].filter((a) => !ARC_DISPLAY_ORDER.includes(a)),
  );
  const body = arcs
    .map((arc) => {
      const head = `<tr class="arc-head"><th colspan="8">${esc(ARC_NAMES[arc] ?? arc)}</th></tr>`;
      const rows = byArc
        .get(arc)!
        .map((w) => {
          const flag = w.unknown ? ' <span class="warn-flag">[?]</span>' : "";
          return `<tr>
        <td class="wname">${esc(w.label)}${w.tc ? ' <span class="tc-flag">(TC)</span>' : ""}${flag}</td>
        <td class="num wdmg">${esc(w.damageText)}</td>
        <td class="num">${esc(w.heat)}</td>
        ${rangeCells(w.range)}
      </tr>`;
        })
        .join("");
      return head + rows;
    })
    .join("");
  return `<table class="mweapons dropship-weapons">
    <thead><tr>
      <th class="wname">Weapons</th><th class="num">Dmg</th><th class="num">Ht</th>
      <th class="num">PB</th><th class="num">S</th>
      <th class="num">M</th><th class="num">L</th><th class="num">X</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function equipmentLine(card: DropshipCard): string {
  if (card.equipment.length === 0) return "—";
  return card.equipment
    .map((e) => `${esc(e.label)}${e.count > 1 ? ` ×${e.count}` : ""} <span class="eq-loc">(${esc(e.facing)})</span>`)
    .join(", ");
}

function capacityLine(card: DropshipCard): string {
  if (card.bays.length === 0) return "—";
  return card.bays
    .map((b) => (b.tons ? `${esc(b.label)} ${esc(b.size.toLocaleString())}t` : `${esc(b.label)} ×${esc(b.size)}`))
    .join(", ");
}

/** Aerospace heat scale (same strip as the fighter card). */
const HEAT_SCALE = [
  { n: 5, cls: "h5", txt: "Automatic Shutdown" },
  { n: 4, cls: "h4", txt: "Ammo Explosion (avoid 8+)" },
  { n: 3, cls: "h3", txt: "Shutdown (avoid 8+)" },
  { n: 2, cls: "h2", txt: "+1 Ranged Attack Mod" },
  { n: 1, cls: "h1", txt: "-2 Safe Thrust / -1 TMM" },
  { n: 0, cls: "h0", txt: "No Effects" },
];

function heatScale(): string {
  const rows = HEAT_SCALE.map(
    (r) => `<div class="hs-row"><span class="hs-n ${r.cls}">${r.n}</span><span class="hs-t">${esc(r.txt)}</span></div>`,
  ).join("");
  return `<div class="heatscale"><div class="hs-label">Heat Scale</div><div class="hs-rows">${rows}</div></div>`;
}

/** Crew condition monitor (consciousness track), as on the fighter card. */
function conditionMonitor(): string {
  const track = ["3+", "5+", "7+", "9+", "11+"]
    .map((t) => `<span class="cm-pip">${t}</span>`)
    .join("");
  return `<div class="condmon">
    <span class="cm-grp">Condition ${track}<span class="cm-pip kia">KIA</span></span>
  </div>`;
}

/**
 * Render a DropShip as an HTML string in the Override record-card layout: title
 * banner, UNIT DATA (type / mass / thrust + sinks / TMM + DThr, heat scale),
 * the per-arc weapons table, equipment + capacity, a crew condition monitor,
 * the OVERRIDE wordmark + skill boxes, and the arc armor diamond.
 */
export function renderDropshipCard(card: DropshipCard): string {
  const warnings = card.warnings.length
    ? `<ul class="warnings">${card.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`
    : "";
  return `<article class="card mech-sheet doll-card">
    <div class="ms-grid">
      <div class="ms-left">
        <div class="ms-title">${esc(card.name)}</div>
        <div class="ms-unitdata">
          <div class="ms-ud-h">UNIT DATA</div>
          <div class="ms-ud-cols">
            <div class="ms-ud-stats">
              <div><b>Type:</b> ${esc(card.shipClass === "WarShip" ? "WarShip" : `${card.motionLabel} DropShip`)}</div>
              <div><b>Mass:</b> ${esc(card.tonnage.toLocaleString())} Tons</div>
              <div class="ms-ud-move"><b>Thrust:</b> ${esc(card.move)} <b>Sinks:</b> ${esc(card.sinks)}</div>
              <div><b>TMM:</b> ${esc(card.tmm)} <b>DThr:</b> ${esc(card.dthr)}</div>
              ${card.armorType ? `<div><b>Armor:</b> ${esc(armorTypeLabel(card.armorType))}</div>` : ""}
            </div>
            ${heatScale()}
          </div>
        </div>
        ${weaponsTable(card)}
        <p class="ms-equip"><b>Equipment:</b> ${equipmentLine(card)}</p>
        <p class="ms-equip"><b>Capacity:</b> ${capacityLine(card)}</p>
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
        ${armorDiagram(card)}
      </div>
    </div>
  </article>`;
}
