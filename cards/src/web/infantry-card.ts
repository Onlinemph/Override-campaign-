/**
 * Conventional Infantry card renderer — PURE string builder (no DOM, no CSS
 * import), in the Override record-card style shared with the 'Mech card.
 *
 * Full-width layout: a title bar, a top band (UNIT DATA | armament + small-arms
 * range | skills + OVERRIDE wordmark), then a wide TROOPERS & WEAPONS section
 * with one column of trooper pips per squad and a per-squad damage legend, plus
 * a FIELD GUNS table (towed standard weapons, real stats).
 */

import type { InfantryCard, RangeBrackets } from "../core/index.js";

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

/** Format a cluster-damage array as "2 · 2 · 1" (or "—" when empty). */
function dmg(clusters: number[]): string {
  return clusters.length ? clusters.join(" · ") : "—";
}

/**
 * Small-arms range row, in the DFA infantry-card style: the weapon name over a
 * PB/S/M/L to-hit row (infantry have no Extreme bracket). Returns "" when the
 * primary weapon's range is unscored.
 */
function rangeTable(card: InfantryCard): string {
  if (!card.range) return "";
  const r = card.range;
  const cells = [r.pb, r.s, r.m, r.l].map((v) => `<td class="num rng">${esc(bracket(v))}</td>`).join("");
  return `<table class="mweapons">
    <thead><tr>
      <th class="wname">${esc(card.primaryWeapon || "Small Arms")}</th>
      <th class="num">PB</th><th class="num">S</th><th class="num">M</th><th class="num">L</th>
    </tr></thead>
    <tbody><tr><td class="wname">To-hit by range</td>${cells}</tr></tbody>
  </table>`;
}

/**
 * TROOPERS & WEAPONS section: each squad is a column of trooper pips spread
 * across the full width, with the small-arms range row and a per-squad damage
 * legend on the right. Damage recalculates as whole squads are eliminated — wipe
 * a squad's pips and read the new damage off the legend. "" when unscored.
 */
function troopersSection(card: InfantryCard): string {
  if (!card.damageBySquads.length) return "";
  const squadCols = Array.from({ length: card.squadCount }, (_, q) => {
    const surviving = card.squadCount - q; // leftmost squad is the last to fall
    const here = card.damageBySquads[surviving - 1] ?? [];
    const pips = Array.from(
      { length: card.squadSize },
      () => `<span class="ms-body"></span>`,
    ).join("");
    return `<div class="inf-squad" title="${esc(surviving)} squad${surviving === 1 ? "" : "s"} left → ${esc(dmg(here))}">
      <div class="inf-squad-h">Squad ${esc(surviving)}</div>
      <div class="inf-pips">${pips}</div>
      <div class="inf-squad-dmg">${esc(dmg(here))}</div>
    </div>`;
  }).join("");
  const legend = card.damageBreaks
    .map((b) => {
      const band = b.from === b.to ? `${b.from}` : `${b.from}–${b.to}`;
      return `<tr><td class="num">${esc(band)}</td><td class="wdmg">${esc(dmg(b.damage))}</td></tr>`;
    })
    .join("");
  return `<div class="inf-troopers">
    <div class="inf-sec-h">TROOPERS &amp; WEAPONS<span class="inf-sec-sub">${esc(card.squadCount)} squad${card.squadCount === 1 ? "" : "s"} × ${esc(card.squadSize)} = ${esc(card.troopers)}</span></div>
    <div class="inf-tr-body">
      <div class="inf-squads">${squadCols}</div>
      <div class="inf-degrade">
        <div class="inf-degrade-h">Damage by squads left</div>
        <table class="ms-degrade">
          <thead><tr><th class="num">Squads</th><th>Damage</th></tr></thead>
          <tbody>${legend}</tbody>
        </table>
      </div>
    </div>
  </div>`;
}

/** Field-gun weapons table (no Loc column — field guns aren't located). */
function fieldGunsTable(card: InfantryCard): string {
  if (card.fieldGuns.length === 0) return "";
  const rows = card.fieldGuns
    .map((w) => {
      const flag = w.unknown ? ' <span class="warn-flag">[?]</span>' : "";
      return `<tr>
        <td class="wname">${esc(w.label)}${flag}</td>
        <td class="num wdmg">${esc(w.damageText)}</td>
        <td class="num">${esc(w.heat)}</td>
        ${rangeCells(w.range)}
      </tr>`;
    })
    .join("");
  return `<table class="mweapons">
    <thead><tr>
      <th class="wname">Field Guns</th><th class="num">Dmg</th><th class="num">Ht</th>
      <th class="num">PB</th><th class="num">S</th><th class="num">M</th><th class="num">L</th><th class="num">X</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/**
 * Render a conventional infantry platoon as an Override record card. Full-width
 * layout: a title bar, a top band (UNIT DATA | armament + small-arms range |
 * skills + OVERRIDE wordmark), then a wide TROOPERS & WEAPONS section (squads
 * spread across the row, per-squad damage legend on the right), field guns, and
 * any warnings.
 */
export function renderInfantryCard(card: InfantryCard): string {
  const warnings = card.warnings.length
    ? `<ul class="warnings">${card.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`
    : "";
  const secondary = card.secondaryWeapon
    ? `<div><b>Secondary:</b> ${esc(card.secondaryWeapon)}${card.secondaryCount ? ` ×${esc(card.secondaryCount)}` : ""}</div>`
    : "";
  return `<article class="card mech-sheet inf-sheet">
    <div class="ms-title">${esc(card.name)}</div>
    <div class="inf-top">
      <div class="ms-unitdata">
        <div class="ms-ud-h">UNIT DATA</div>
        <div class="ms-ud-stats">
          <div><b>Type:</b> ${esc(card.motionLabel)} Infantry</div>
          <div><b>Troopers:</b> ${esc(card.troopers)} <span class="inf-dim">(${esc(card.squadCount)}×${esc(card.squadSize)})</span></div>
          <div class="ms-ud-move"><b>Move:</b> ${esc(card.move)}</div>
          <div><b>TMM:</b> ${esc(card.tmmText)}</div>
          <div><b>Anti-’Mech:</b> ${card.antiMek ? "Yes" : "No"}</div>
        </div>
      </div>
      <div class="inf-arm">
        <div class="inf-arm-h">ARMAMENT</div>
        <div class="ms-armament">
          <div><b>Primary:</b> ${esc(card.primaryWeapon || "—")}</div>
          ${secondary}
          ${card.damage.length ? `<div><b>Full damage:</b> ${dmg(card.damage)}</div>` : ""}
        </div>
        ${rangeTable(card)}
      </div>
      <div class="ms-brand">
        <div class="ms-skills">
          <div class="ms-skill"><span>Gunnery</span><div class="ms-skill-box"></div></div>
          <div class="ms-skill"><span>Anti-’Mech</span><div class="ms-skill-box"></div></div>
        </div>
        <div class="ms-wordmark">B<span class="ms-wm-a">▲</span>TTLETECH<br><b>OVERRIDE</b></div>
      </div>
    </div>
    ${troopersSection(card)}
    ${fieldGunsTable(card)}
    ${
      card.damage.length
        ? ""
        : `<p class="ba-note">Small-arms damage/range pending per-trooper values for this weapon.
            Movement / TMM mirror the ’Mech rules (best-effort).</p>`
    }
    ${warnings}
  </article>`;
}
