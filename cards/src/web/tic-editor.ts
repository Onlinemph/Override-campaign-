/**
 * Manual TIC editor (web only).
 *
 * The card's weapon table is driven by its TICs; this panel lets the user
 * re-partition the unit's flat weapon list into custom TICs and rebuilds them
 * with the SAME pure core math (`buildTic`), so the card updates live. It never
 * touches the conversion pipeline — it only swaps which weapons share a TIC.
 *
 * Grouping is facet-scoped: weapons may only share a TIC when their `keyOf`
 * matches (the 'Mech location for mechs, the arc/facing for vehicles & aero) and
 * the combined profile stays within the page-41 caps (`isLegalTicProfile`).
 *
 * Battle Armor / infantry do not use TICs and are out of scope.
 */

import { buildTic, isLegalTicProfile } from "../core/index.js";
import type { CardWeapon, Tic } from "../core/index.js";

/** A grouping: each entry is one TIC, listed as indices into the weapon array. */
export type Grouping = number[][];

/** Per-kind hooks: the legality/grouping facet and a human label for it. */
export interface EditorFacets {
  /** Grouping key — weapons can only TIC together when these match. */
  keyOf: (w: CardWeapon) => string;
  /** Human label for a TIC's facet (location / arc), shown on the box. */
  facetLabel: (w: CardWeapon) => string;
  /** Apply the page-41 TIC caps (base ≤ 5, max ≤ 14). 'Mechs/vehicles/aero do;
   * DropShip & WarShip weapon BAYS do not (a bay fires as one big attack). */
  enforceCaps: boolean;
}

const esc = (s: string | number): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Derive the editable grouping from a card's current (auto- or hand-) TICs. */
export function groupingFromTics(tics: ReadonlyArray<Tic>, weapons: CardWeapon[]): Grouping {
  return tics.map((t) => t.weapons.map((w) => weapons.indexOf(w)).filter((i) => i >= 0));
}

/** Rebuild `Tic[]` from a grouping, dropping empty groups. */
export function ticsFromGrouping(weapons: CardWeapon[], g: Grouping): Tic[] {
  return g.filter((grp) => grp.length > 0).map((grp) => buildTic(grp.map((i) => weapons[i]!)));
}

/**
 * Move weapon `wi` into target group `target` (an existing group index, or
 * "new" for a fresh solo TIC). Returns a fresh, compacted grouping.
 */
export function applyMove(g: Grouping, wi: number, target: number | "new"): Grouping {
  const next = g.map((grp) => grp.filter((i) => i !== wi));
  if (target === "new") next.push([wi]);
  else next[target]!.push(wi);
  return next.filter((grp) => grp.length > 0);
}

/** True if the indices form a legal TIC: one facet, and (when capped) within the caps. */
function legal(weapons: CardWeapon[], members: number[], facets: EditorFacets): boolean {
  if (members.length <= 1) return true;
  const k = facets.keyOf(weapons[members[0]!]!);
  if (!members.every((i) => facets.keyOf(weapons[i]!) === k)) return false;
  return !facets.enforceCaps || isLegalTicProfile(buildTic(members.map((i) => weapons[i]!)).profile);
}

/** True if weapon `wi` may join existing group `gi`. */
function canMove(weapons: CardWeapon[], g: Grouping, wi: number, gi: number, facets: EditorFacets): boolean {
  if (g[gi]!.includes(wi)) return false;
  return legal(weapons, [...g[gi]!, wi], facets);
}

/** Render the editor panel HTML for the current grouping. */
export function renderTicEditorHtml(weapons: CardWeapon[], g: Grouping, facets: EditorFacets): string {
  const boxes = g
    .map((grp, gi) => {
      const tic = buildTic(grp.map((i) => weapons[i]!));
      const facet = facets.facetLabel(weapons[grp[0]!]!);
      const rows = grp
        .map((wi) => {
          const w = weapons[wi]!;
          const opts = g
            .map((_, ti) => ti)
            .filter((ti) => ti !== gi && canMove(weapons, g, wi, ti, facets))
            .map((ti) => `<option value="g:${ti}">→ TIC ${ti + 1}</option>`)
            .join("");
          const split = grp.length > 1 ? `<option value="new">→ split off</option>` : "";
          const move =
            opts || split
              ? `<select class="tic-move" data-wi="${wi}" aria-label="Move ${esc(w.name)}">
                   <option value="" selected>move…</option>${opts}${split}
                 </select>`
              : "";
          return `<li><span class="tic-wname">${esc(w.name)}</span>${move}</li>`;
        })
        .join("");
      return `<div class="tic-box">
          <div class="tic-box-head">
            <span class="tic-tag">TIC ${gi + 1}</span>
            <span class="tic-meta">${esc(tic.damageText)} · ${esc(facet)}</span>
          </div>
          <ul class="tic-members">${rows}</ul>
        </div>`;
    })
    .join("");

  return `<section class="tic-editor" id="tic-editor">
      <div class="tic-editor-head">
        <h3>Weapon Groups (TICs)</h3>
        <button type="button" id="tic-reset" class="tic-reset">Reset to auto</button>
      </div>
      <p class="muted tic-hint">Move a weapon to combine it into another TIC (same location only) or split it off. The card updates live.</p>
      <div class="tic-boxes">${boxes}</div>
    </section>`;
}
