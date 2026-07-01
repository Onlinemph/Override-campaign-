/**
 * Browser entry point. The UI layer — the ONLY place that touches the DOM. It
 * imports the pure core (parser + converter) exactly as the CLI does, proving
 * the core runs unchanged in a browser. No Node/filesystem APIs here.
 */

import "./style.css";

import {
  abbreviatedTicLabel,
  convertAny,
  dropshipWeaponRows,
  fighterWeaponRows,
  groupingLocation,
  normalizeWeaponName,
  ParseError,
  protoWeaponRows,
  ticHeat,
  vehicleWeaponRows,
} from "../core/index.js";
import { renderBACard } from "./ba-card.js";
import { renderDropshipCard } from "./dropship-card.js";
import { renderFighterCard } from "./fighter-card.js";
import { renderInfantryCard } from "./infantry-card.js";
import { movementLines, renderMechCard, weaponsTable } from "./mech-card.js";
import { renderProtoCard } from "./proto-card.js";
import { renderVehicleCard } from "./vehicle-card.js";
import { applyMove, groupingFromTics, renderTicEditorHtml, ticsFromGrouping } from "./tic-editor.js";
import { adjustRange, applyUnitQuirkToCard, applyWeaponQuirkToTic, quirkEffect, RANGE_BANDS, WEAPON_QUIRK_LABEL } from "./quirk-effects.js";
import type { EditorFacets, Grouping } from "./tic-editor.js";
import { RealtimeClient } from "@supabase/realtime-js";
import type { RealtimeChannel } from "@supabase/realtime-js";
import { MP_CONFIGURED, SUPABASE_ANON_KEY, SUPABASE_URL } from "./mp-config.js";
import { airEntryNote, buildNameIndex, resolveModel, setupNotes } from "./handoff-import.js";
import type { HandoffRoster } from "./handoff-import.js";
import { battleResultFromForces } from "./handoff-result.js";

// ---------------------------------------------------------------------------
// Unit browser — powered by the pre-built index served as a STATIC asset at
// ./units-index.json (public/units-index.json, written by extract-units.mjs).
// The unit files themselves are served from ./units/<path>. The index is
// fetched (not bundled/imported) so it keeps a stable URL and survives the
// single-file inlining step, which deletes the hashed assets/ directory.
// ---------------------------------------------------------------------------
interface UnitEntry { name: string; path: string; category: string; era: string; }

// Fetch the static index; returns null (browser stays hidden) if not generated.
async function loadUnitsIndex(): Promise<UnitEntry[] | null> {
  try {
    const resp = await fetch("./units-index.json");
    if (!resp.ok) return null;
    return (await resp.json()) as UnitEntry[];
  } catch {
    return null;
  }
}

async function initBrowser(): Promise<void> {
  const statusEl = document.getElementById("browse-status");
  const listEl = document.getElementById("browse-list");
  const countEl = document.getElementById("browse-count");
  const catSel = document.getElementById("browse-cat") as HTMLSelectElement;
  const searchInput = document.getElementById("browse-q") as HTMLInputElement;
  const factionSel = document.getElementById("browse-faction") as HTMLSelectElement | null;
  const eraSel = document.getElementById("browse-era") as HTMLSelectElement | null;
  const toggleBtn = document.getElementById("browse-toggle") as HTMLButtonElement;
  const browseBody = document.getElementById("browse-body") as HTMLElement;
  if (!statusEl || !listEl || !catSel || !searchInput || !toggleBtn || !browseBody) return;

  const unitsOrNull = await loadUnitsIndex();
  if (!unitsOrNull) {
    statusEl.textContent = "Unit index not found — run 'npm run extract-units' then restart the dev server.";
    return;
  }
  const units: UnitEntry[] = unitsOrNull;

  // Populate category filter.
  const cats = [...new Set(units.map((u) => u.category))].sort();
  for (const cat of cats) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    catSel.appendChild(opt);
  }

  // MUL availability: faction + era filters (only if the index loaded).
  await loadAvailIndex();
  await loadRoleIndex(); // roles shown + searchable in the unit list
  if (availIndex && factionSel && eraSel) {
    for (const f of availIndex.factions) {
      const o = document.createElement("option");
      o.value = String(f.id);
      o.textContent = f.name;
      factionSel.appendChild(o);
    }
    for (const e of availIndex.eras) {
      const o = document.createElement("option");
      o.value = String(e.id);
      o.textContent = e.name;
      eraSel.appendChild(o);
    }
  } else {
    // No availability data — hide just the faction/era selects, keep the rest.
    if (factionSel) factionSel.style.display = "none";
    if (eraSel) eraSel.style.display = "none";
  }

  const PAGE = 80; // units rendered per batch; more load as you scroll
  let filtered: UnitEntry[] = [];
  let shownCount = 0;

  const itemHtml = (u: UnitEntry): string => {
    const role = lookupRole(u.name, u.path);
    return `<div class="browse-item" role="option" tabindex="0" data-path="${esc(u.path)}" data-name="${esc(u.name)}">
            <span class="browse-item-name">${esc(u.name)}</span>
            <span class="browse-item-meta muted">${esc(u.category)}${u.era ? ` · ${esc(u.era)}` : ""}${role ? ` · <span class="browse-role">${esc(role)}</span>` : ""}</span>
            <button class="browse-add" type="button" data-path="${esc(u.path)}" data-name="${esc(u.name)}" title="Add to force" aria-label="Add ${esc(u.name)} to force">＋</button>
          </div>`;
  };

  function appendMore(): void {
    const next = filtered.slice(shownCount, shownCount + PAGE);
    if (next.length === 0) return;
    listEl!.insertAdjacentHTML("beforeend", next.map(itemHtml).join(""));
    shownCount += next.length;
    statusEl!.textContent =
      shownCount < filtered.length
        ? `Showing ${shownCount.toLocaleString()} of ${filtered.length.toLocaleString()} — scroll for more.`
        : "";
  }

  function render(): void {
    const q = searchInput.value.trim().toLowerCase();
    const cat = catSel.value;
    const facId = factionSel?.value ?? "";
    const eraId = eraSel?.value ?? "";
    const eraBit = eraId && availIndex ? availIndex.eras.findIndex((e) => String(e.id) === eraId) : -1;
    const useAvail = !!availIndex && (facId !== "" || eraId !== "");
    filtered = units.filter(
      (u) =>
        (!cat || u.category === cat) &&
        (!q ||
          u.name.toLowerCase().includes(q) ||
          u.era.toLowerCase().includes(q) ||
          (lookupRole(u.name, u.path) ?? "").toLowerCase().includes(q)) &&
        (!useAvail || isAvailable(u.path, facId, eraBit)),
    );
    if (countEl) countEl.textContent = `(${filtered.length.toLocaleString()} units)`;

    shownCount = 0;
    listEl!.innerHTML = "";
    listEl!.scrollTop = 0;
    if (filtered.length === 0) {
      statusEl!.textContent = "No units match.";
      return;
    }
    statusEl!.textContent = "";
    appendMore(); // first batch; the scroll listener loads the rest
  }

  // Infinite scroll: pull in the next batch as you near the bottom of the list.
  listEl.addEventListener("scroll", () => {
    if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 120) appendMore();
  });

  async function loadUnit(path: string, name: string): Promise<void> {
    statusEl!.textContent = `Loading ${name}…`;
    try {
      // Unit files are served as static assets from units/ (extracted from units.zip at build time).
      const url = `./units/${path}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
      const text = await resp.text();
      currentPreview = { text, file: path };
      // Pass the path (not the display name) so the BV lookup matches by filename.
      showResults([convertOne(text, path)]);
      output.scrollIntoView({ behavior: "smooth", block: "start" });
      statusEl!.textContent = "";
    } catch (err) {
      statusEl!.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // Add a browsed unit to the force without disturbing the preview.
  async function addBrowsedUnit(path: string, name: string): Promise<void> {
    try {
      const resp = await fetch(`./units/${path}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      addToForce(name, await resp.text(), path); // path enables filename-based BV match
      statusEl!.textContent = `Added ${name} to force.`;
    } catch (err) {
      statusEl!.textContent = `Error adding ${name}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  listEl.addEventListener("click", (e) => {
    const add = (e.target as Element).closest<HTMLElement>(".browse-add");
    if (add) {
      void addBrowsedUnit(add.dataset.path!, add.dataset.name!);
      return;
    }
    const item = (e.target as Element).closest<HTMLElement>(".browse-item");
    if (!item) return;
    loadUnit(item.dataset.path!, item.dataset.name!);
  });
  listEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const item = e.target as HTMLElement;
    if (!item.matches(".browse-item")) return;
    e.preventDefault();
    loadUnit(item.dataset.path!, item.dataset.name!);
  });

  catSel.addEventListener("change", render);
  searchInput.addEventListener("input", render);
  factionSel?.addEventListener("change", render);
  eraSel?.addEventListener("change", render);

  // Collapse toggle.
  toggleBtn.addEventListener("click", () => {
    const expanded = toggleBtn.getAttribute("aria-expanded") === "true";
    toggleBtn.setAttribute("aria-expanded", String(!expanded));
    browseBody.style.display = expanded ? "none" : "";
    toggleBtn.textContent = expanded ? "▼ Show" : "▲ Hide";
  });

  render();
}
import type { AnyCard, CardEquipment, CardWeapon, OverrideCard, RangeBrackets, Tic } from "../core/index.js";

// Injected by Vite (see vite.config.ts).
declare const __BUILD_TIME__: string;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const output = $<HTMLElement>("output");
const fileInput = $<HTMLInputElement>("file");
/** The unit currently shown in the preview (browse-click or upload), so the
 * "Add to Force" button knows what to add now that there's no paste box. */
let currentPreview: { text: string; file: string } | null = null;

/** Escape text for safe insertion into HTML. */
function esc(s: string | number): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function errorCard(file: string, message: string): string {
  return `<article class="card error">
    <h2>Could not convert ${esc(file)}</h2>
    <p>${esc(message)}</p>
  </article>`;
}

type ConvertResult = { ok: true; result: AnyCard } | { ok: false; html: string };

// ---- Battle Value (official MUL BV2) --------------------------------------
// A static { key -> BV } lookup (public/bv-index.json, built by
// scripts/build-bv-index.mjs from a Master Unit List export). Keyed by both the
// normalized source FILENAME (matches ~98% of the bundled MegaMek files) and the
// normalized "Chassis Model" name (fallback for pasted text). BV is a web-only
// concern sourced from this file, so it never touches the pure core/converter.
let bvIndex: Record<string, number> = {};
const bvKey = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
const fileStem = (p: string): string =>
  (p.replace(/\\/g, "/").split("/").pop() ?? "").replace(/\.(mtf|blk)$/i, "");

async function loadBvIndex(): Promise<void> {
  try {
    const resp = await fetch("./bv-index.json");
    if (resp.ok) bvIndex = (await resp.json()) as Record<string, number>;
  } catch {
    /* no BV index — cards/force just omit BV */
  }
}

/** Official BV for a unit: try the source filename first (best match), then the
 * display name. Returns undefined when the unit isn't in the MUL dataset. */
function lookupBv(name: string, file?: string): number | undefined {
  if (file) {
    const byFile = bvIndex[bvKey(fileStem(file))];
    if (byFile) return byFile;
  }
  return bvIndex[bvKey(name)];
}

// MUL design quirks (unit + weapon) — public/quirk-index.json, shown on the card
// when the "Show quirks" option is on (a body class reveals the injected line).
interface Quirks { u: string[]; w: string[] }
let quirkIndex: Record<string, Quirks> = {};
async function loadQuirkIndex(): Promise<void> {
  try {
    const resp = await fetch("./quirk-index.json");
    if (resp.ok) quirkIndex = (await resp.json()) as Record<string, Quirks>;
  } catch {
    /* no quirk data — the line just never appears */
  }
}
function lookupQuirks(name: string, file?: string): Quirks | undefined {
  if (file) {
    const byFile = quirkIndex[bvKey(fileStem(file))];
    if (byFile) return byFile;
  }
  return quirkIndex[bvKey(name)];
}

// Per-weapon quirks from the unit FILES (public/weaponquirk-index.json): which
// weapon carries which quirk, keyed by filename. Richer than the MUL summary.
let weaponQuirkIndex: Record<string, [string, string][]> = {};
async function loadWeaponQuirkIndex(): Promise<void> {
  try {
    const resp = await fetch("./weaponquirk-index.json");
    if (resp.ok) weaponQuirkIndex = (await resp.json()) as Record<string, [string, string][]>;
  } catch {
    /* no per-weapon data — falls back to the MUL summary */
  }
}

// MUL battlefield role (Sniper, Brawler, Skirmisher, …) — public/role-index.json.
// Memoized: the browser and the analytics panel share a single fetch.
let roleIndex: Record<string, string> = {};
let roleIndexPromise: Promise<void> | null = null;
function loadRoleIndex(): Promise<void> {
  roleIndexPromise ??= (async () => {
    try {
      const resp = await fetch("./role-index.json");
      if (resp.ok) roleIndex = (await resp.json()) as Record<string, string>;
    } catch {
      /* no role data — the role label/breakdown just stays empty */
    }
  })();
  return roleIndexPromise;
}
function lookupRole(name: string, file?: string): string | undefined {
  if (file) {
    const byFile = roleIndex[bvKey(fileStem(file))];
    if (byFile) return byFile;
  }
  return roleIndex[bvKey(name)];
}
const WEAPON_QUIRK_ACRONYMS = new Set(["er", "ppc", "ac", "lb", "hag", "srm", "lrm", "mrm", "mml", "mg", "ams", "tag", "ecm", "narc", "atm", "rac", "lac", "si", "c3", "ba", "sb", "os", "x"]);
/** Title-case a normalized weapon name, upper-casing known acronyms ("er ppc" -> "ER PPC"). */
function titleCaseWeapon(s: string): string {
  return s.replace(/[a-z0-9]+/gi, (w) => {
    const lw = w.toLowerCase();
    return WEAPON_QUIRK_ACRONYMS.has(lw) ? w.toUpperCase() : lw.charAt(0).toUpperCase() + lw.slice(1);
  });
}
/** Per-weapon quirks for a unit as structured entries (file-sourced if available,
 * else the MUL summary with no weapon binding). */
function weaponQuirkEntries(file: string | undefined, mulW: string[] | undefined): { weapon?: string; name: string }[] {
  const rows = file ? weaponQuirkIndex[bvKey(fileStem(file))] : undefined;
  if (rows?.length) {
    const out: { weapon?: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const [code, raw] of rows) {
      const weapon = titleCaseWeapon(normalizeWeaponName(raw));
      const name = WEAPON_QUIRK_LABEL[code] ?? code.replace(/_/g, " ");
      const k = `${weapon}|${name}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push({ weapon, name });
      }
    }
    return out;
  }
  return (mulW ?? []).map((name) => ({ name }));
}

/** One quirk row: optional weapon, name, and its Override effect, signed pos/neg/none. */
function quirkRowHtml(weapon: string | undefined, name: string): string {
  const e = quirkEffect(name);
  const cls = e ? ` cq-${e.sign}` : "";
  const w = weapon ? `<span class="cq-w">${esc(weapon)}:</span> ` : "";
  const eff = e ? ` — <span class="cq-e">${esc(e.effect)}</span>` : "";
  return `<div class="cq-row${cls}">${w}<span class="cq-n">${esc(name)}</span>${eff}</div>`;
}

/** Inject the (CSS-hidden) Design Quirks block with Override effects after the
 * card title; revealed by body.show-quirks. */
function withQuirks(html: string, quirks: Quirks | undefined, file?: string): string {
  const unitNames = quirks?.u ?? [];
  const weaponEntries = weaponQuirkEntries(file, quirks?.w);
  if (unitNames.length === 0 && weaponEntries.length === 0) return html;
  const rows = [
    ...unitNames.map((n) => quirkRowHtml(undefined, n)),
    ...weaponEntries.map((e) => quirkRowHtml(e.weapon, e.name)),
  ].join("");
  const block = `<div class="card-quirks"><div class="cq-h">Design Quirks</div>${rows}</div>`;
  return html.replace(/(<div class="(?:ms-title|ba-title)\b[^>]*>[\s\S]*?<\/div>)/, `$1${block}`);
}
/** Inject the MUL battlefield role as a small subtitle under the card title. */
function withRole(html: string, role: string | undefined): string {
  if (!role) return html;
  const line = `<div class="card-role">${esc(role)}</div>`;
  return html.replace(/(<div class="(?:ms-title|ba-title)\b[^>]*>[\s\S]*?<\/div>)/, `$1${line}`);
}

// BV2 pilot-skill multiplier (TechManual p.315 / MegaMek): [gunnery][piloting],
// 0–8 each. Regular 4/5 = 1.00; better skills cost more BV, worse less.
const BV_SKILL_MULT: ReadonlyArray<ReadonlyArray<number>> = [
  [2.42, 2.31, 2.21, 2.1, 1.93, 1.75, 1.68, 1.59, 1.5],
  [2.21, 2.11, 2.02, 1.92, 1.76, 1.6, 1.54, 1.46, 1.38],
  [1.93, 1.85, 1.76, 1.68, 1.54, 1.4, 1.35, 1.28, 1.21],
  [1.66, 1.58, 1.51, 1.44, 1.32, 1.2, 1.16, 1.1, 1.04],
  [1.38, 1.32, 1.26, 1.2, 1.1, 1.0, 0.95, 0.9, 0.85],
  [1.31, 1.19, 1.13, 1.08, 0.99, 0.9, 0.85, 0.81, 0.77],
  [1.24, 1.12, 1.07, 1.02, 0.94, 0.85, 0.81, 0.77, 0.72],
  [1.17, 1.06, 1.01, 0.96, 0.88, 0.8, 0.76, 0.72, 0.68],
  [1.1, 1.0, 0.95, 0.9, 0.83, 0.75, 0.71, 0.68, 0.64],
];
const clampIdx = (n: number): number => Math.max(0, Math.min(8, Math.round(n)));

/** Skill-adjusted BV: base × the BV2 gunnery/piloting multiplier, rounded. */
function adjustedBv(base: number | undefined, gunnery = 4, piloting = 5): number | undefined {
  if (base === undefined) return undefined;
  return Math.round(base * BV_SKILL_MULT[clampIdx(gunnery)]![clampIdx(piloting)]!);
}

/** A force unit's printed BV: official BV adjusted for its (effective) skills. */
function unitBv(u: ForceUnit): number | undefined {
  const sk = unitSkills(u);
  return adjustedBv(lookupBv(u.name, u.file), sk.gunnery, sk.piloting);
}

// ---- Pilot stable: named pilots saved once, assignable across forces -------
interface Pilot { id: string; name: string; gunnery: number; piloting: number; abilities?: string }
const PILOTS_KEY = "mtf2override.pilots";
function loadPilots(): Pilot[] {
  try {
    const p = JSON.parse(localStorage.getItem(PILOTS_KEY) ?? "[]") as unknown;
    return Array.isArray(p) ? (p as Pilot[]) : [];
  } catch {
    return [];
  }
}
let pilots: Pilot[] = loadPilots();
function savePilots(): void {
  try {
    localStorage.setItem(PILOTS_KEY, JSON.stringify(pilots));
  } catch {
    /* storage unavailable */
  }
}
function pilotFor(u: ForceUnit): Pilot | undefined {
  return u.pilotId ? pilots.find((p) => p.id === u.pilotId) : undefined;
}
/** Effective skills for a unit: its assigned pilot's, else its own (default 4/5). */
function unitSkills(u: ForceUnit): { gunnery: number; piloting: number } {
  const p = pilotFor(u);
  return { gunnery: p?.gunnery ?? u.gunnery ?? 4, piloting: p?.piloting ?? u.piloting ?? 5 };
}

// ---- MUL availability (faction × era) -------------------------------------
// Distilled from the MUL by scripts/build-avail-index.mjs into avail-index.json.
interface AvailIndex {
  factions: { id: number; name: string }[];
  eras: { id: number; name: string }[]; // chronological; the bit index follows this order
  byFile: Record<string, number>; // filename stem -> MUL ID
  avail: Record<string, Record<string, number>>; // MUL ID -> factionId -> era bitmask
}
let availIndex: AvailIndex | null = null;

async function loadAvailIndex(): Promise<void> {
  try {
    const resp = await fetch("./avail-index.json");
    if (resp.ok) availIndex = (await resp.json()) as AvailIndex;
  } catch {
    /* no availability data — the faction/era filters just stay inert */
  }
}

/** Whether a unit (by source path) is fielded by a faction in an era. Empty
 * factionId = any faction; eraBit < 0 = any era. Units not in the MUL
 * availability data are excluded whenever a faction/era filter is active. */
function isAvailable(path: string, factionId: string, eraBit: number): boolean {
  if (!availIndex) return true;
  const id = availIndex.byFile[bvKey(fileStem(path))];
  if (id == null) return false;
  const byFaction = availIndex.avail[id];
  if (!byFaction) return false;
  if (factionId) {
    const mask = byFaction[factionId] ?? 0;
    return eraBit < 0 ? mask !== 0 : (mask & (1 << eraBit)) !== 0;
  }
  if (eraBit < 0) return true;
  return Object.values(byFaction).some((mask) => (mask & (1 << eraBit)) !== 0);
}

/** Inject a BV badge just after the card's title (works for every card kind:
 * .ms-title for most, .ba-title for Battle Armor). */
function withBv(html: string, bv: number | undefined): string {
  if (!bv) return html;
  const badge = `<div class="card-bv">BV <b>${bv.toLocaleString()}</b></div>`;
  return html.replace(/(<div class="(?:ms-title|ba-title)\b[^>]*>[\s\S]*?<\/div>)/, `$1${badge}`);
}

/** True if the card mounts a Targeting Computer (−1 to-hit on direct-fire). */
function cardHasTC(result: AnyCard): boolean {
  const eq = (result.card as { equipment?: { label: string }[] }).equipment ?? [];
  return eq.some((e) => /targeting computer/i.test(e.label));
}
/** Add a "TC −1" badge by the card title when the unit has a Targeting Computer. */
function withTC(html: string, hasTC: boolean): string {
  if (!hasTC) return html;
  const badge = `<div class="card-tc" title="Targeting Computer: −1 to-hit on direct-fire weapons">TC −1</div>`;
  return html.replace(/(<div class="(?:ms-title|ba-title)\b[^>]*>[\s\S]*?<\/div>)/, `$1${badge}`);
}

/** Fill the card's (blank) skill boxes — first = Gunnery, second = Piloting (or
 * the unit's second skill, e.g. Anti-'Mech). Pass undefined to leave a box blank. */
/** Render a skill value, marked red when a pilot-hit penalty is folded in. */
const skillVal = (v: number, penalty: number): string =>
  penalty > 0 ? `<span class="leg-mod" title="includes +${penalty} from pilot hits">${v}</span>` : String(v);
function withSkills(html: string, gunnery?: number, piloting?: number, penalty = 0): string {
  const vals = [gunnery, piloting];
  let i = 0;
  return html.replace(/<div class="(ms-skill-box|ba-skill-box)">\s*<\/div>/g, (m, cls: string) => {
    const v = vals[i++];
    return v === undefined || v === null ? m : `<div class="${cls}">${skillVal(v, penalty)}</div>`;
  });
}

/** Parse + convert one source, auto-detecting MTF ('Mech) vs BLK (Battle Armor).
 * `file` is the source filename/path when known — used for the BV lookup. */
function convertOne(text: string, file: string): ConvertResult {
  try {
    const result = convertAny(text, file);
    const c = result.card as { bv?: number; sourceFile?: string };
    c.bv = lookupBv(result.card.name, file);
    c.sourceFile ??= file; // enable file-keyed lookups (quirks, weapon-quirk binding, role)
    return { ok: true, result };
  } catch (err) {
    const message =
      err instanceof ParseError ? err.message : err instanceof Error ? err.message : String(err);
    return { ok: false, html: errorCard(file, message) };
  }
}

/** Raw card HTML, dispatched on unit kind (no BV/skills injected). */
function rawCardHtml(result: AnyCard): string {
  const r = applyTargetingComputer(applyQuirkEffects(result)); // bake quirk + TC effects into the displayed card
  return r.kind === "battlearmor"
    ? renderBACard(r.card)
    : r.kind === "vehicle"
      ? renderVehicleCard(r.card)
      : r.kind === "fighter"
        ? renderFighterCard(r.card)
        : r.kind === "infantry"
          ? renderInfantryCard(r.card)
          : r.kind === "protomech"
            ? renderProtoCard(r.card)
            : r.kind === "dropship"
              ? renderDropshipCard(r.card)
              : renderMechCard(r.card);
}

/** True when the "Show quirks" option is on (quirks then modify card values). */
const quirksOn = (): boolean => document.body.classList.contains("show-quirks");

/** Return a clone of the result with quirk effects baked into the card values
 * ('Mech only — heat, to-hit brackets, head armor). Non-destructive: the original
 * card is untouched. Returns the result unchanged when the toggle is off or there
 * is nothing to apply. */
function applyQuirkEffects(result: AnyCard): AnyCard {
  if (result.kind !== "mech" || !quirksOn()) return result;
  const file = (result.card as { sourceFile?: string }).sourceFile;
  const unitQ = lookupQuirks(result.card.name, file)?.u ?? [];
  const wq = file ? weaponQuirkIndex[bvKey(fileStem(file))] : undefined;
  if (unitQ.length === 0 && !wq?.length) return result;
  const clone = structuredClone(result);
  for (const [code, raw] of wq ?? []) {
    const label = WEAPON_QUIRK_LABEL[code];
    if (!label) continue;
    const wnorm = normalizeWeaponName(raw);
    for (const tic of clone.card.tics) {
      if (tic.weapons.some((w) => normalizeWeaponName(w.name) === wnorm)) applyWeaponQuirkToTic(tic, label);
    }
  }
  for (const q of unitQ) applyUnitQuirkToCard(clone.card, q);
  return clone;
}

/** Bake the Targeting Computer −1 to-hit into each DIRECT-FIRE weapon's range
 * brackets, so the printed profile reflects it. Always on (it's equipment, not
 * a quirk). Non-destructive: clones, leaving the original untouched. */
function applyTargetingComputer(result: AnyCard): AnyCard {
  if (!cardHasTC(result)) return result;
  const clone = structuredClone(result);
  if (clone.kind === "mech") {
    for (const tic of clone.card.tics) {
      if (tic.weapons.some((w) => isDirectFireLabel(w.name))) {
        adjustRange(tic.range, -1, RANGE_BANDS.all);
        tic.tc = true; // mark "(TC)" on the card
      }
    }
  } else if (clone.kind === "vehicle" || clone.kind === "fighter" || clone.kind === "protomech" || clone.kind === "dropship") {
    for (const w of clone.card.weapons) {
      if (isDirectFireLabel(w.label)) {
        adjustRange(w.range, -1, RANGE_BANDS.all);
        w.tc = true; // mark "(TC)" on the card
      }
    }
  }
  return clone;
}

/** Card HTML with the BV badge + (hidden) quirks line (used for previews/print). */
/** Add the BV / quirks / role / TC badges around a rendered card body, so the
 * preview and the force view look identical. `raw` may be a TIC-edited card. */
function decorateCard(raw: string, result: AnyCard): string {
  const c = result.card as { bv?: number; sourceFile?: string };
  return withTC(withRole(withQuirks(withBv(raw, c.bv), lookupQuirks(result.card.name, c.sourceFile), c.sourceFile), lookupRole(result.card.name, c.sourceFile)), cardHasTC(result));
}
function cardHtml(result: AnyCard): string {
  return decorateCard(rawCardHtml(result), result);
}

// ---- Manual TIC editor wiring ---------------------------------------------

/** An active edit session: the grouping is the source of truth and rebuilds the
 * card's weapon display on every change (card.tics for mechs, weapon rows else). */
interface EditSession {
  weapons: CardWeapon[];
  facets: EditorFacets;
  grouping: Grouping;
  autoGrouping: Grouping; // the original auto-grouping, for "Reset to auto"
  apply: (tics: Tic[]) => void; // write the regrouped result onto the card
  renderCard: () => string;
}
let edit: EditSession | null = null;
// When set, the active edit session belongs to force[editingForceIdx]; TIC moves
// and skills are persisted back onto that force unit (not just the transient card).
let editingForceIdx: number | null = null;
// Whether the unit being edited has a torso-mounted cockpit (head loss ≠ pilot
// death). Set per render; read by the damage pass.
let editTorsoCockpit = false;

// 'Mech locations collapse the torso; the facet key matches isLegalTic's rule.
const mechFacets: EditorFacets = {
  keyOf: (w) => groupingLocation(w.location) + (w.rearMounted ? "|R" : ""),
  facetLabel: (w) => {
    const g = groupingLocation(w.location);
    const base = g === "T" || g === "Tr" ? "Torso" : w.location;
    return w.rearMounted ? `${base} (R)` : base;
  },
  enforceCaps: true,
};
// Vehicles / aero / proto / dropship group per arc (the weapon's rawLocation).
const titleCase = (s: string) =>
  s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
const facingBase = {
  keyOf: (w: CardWeapon) => w.rawLocation ?? "",
  facetLabel: (w: CardWeapon) => titleCase(w.rawLocation ?? "—"),
};
// Vehicles / aero / proto fire 'Mech-scale TICs (capped); DropShip bays do not.
const facingFacets: EditorFacets = { ...facingBase, enforceCaps: true };
const bayFacets: EditorFacets = { ...facingBase, enforceCaps: false };

/** Build an edit session for an editable card kind, or null when not editable. */
function makeSession(r: AnyCard): EditSession | null {
  const start = (weapons: CardWeapon[], tics: Tic[], facets: EditorFacets, apply: EditSession["apply"], renderCard: () => string): EditSession => {
    const grouping = groupingFromTics(tics, weapons);
    return { weapons, facets, grouping, autoGrouping: grouping, apply, renderCard };
  };
  // renderCard goes through rawCardHtml so quirk effects apply in the preview /
  // play view, not just the static card paths.
  switch (r.kind) {
    case "mech":
      return start(r.card.weapons, r.card.tics, mechFacets, (t) => (r.card.tics = t), () => rawCardHtml(r));
    case "vehicle":
      return start(r.card.weaponMounts, r.card.tics, facingFacets, (t) => (r.card.weapons = vehicleWeaponRows(t, r.card.techBase)), () => rawCardHtml(r));
    case "fighter":
      return start(r.card.weaponMounts, r.card.tics, facingFacets, (t) => (r.card.weapons = fighterWeaponRows(t, r.card.techBase)), () => rawCardHtml(r));
    case "protomech":
      return start(r.card.weaponMounts, r.card.tics, facingFacets, (t) => (r.card.weapons = protoWeaponRows(t, r.card.techBase)), () => rawCardHtml(r));
    case "dropship":
      return start(r.card.weaponMounts, r.card.tics, bayFacets, (t) => (r.card.weapons = dropshipWeaponRows(t, r.card.techBase)), () => rawCardHtml(r));
    default:
      return null; // BA / infantry: no TICs
  }
}

/** Render the converted cards, attaching the TIC editor for a single editable unit. */
let lastResults: ConvertResult[] | null = null; // for re-rendering the preview on the quirks toggle
function showResults(results: ConvertResult[]): void {
  lastResults = results;
  edit = null;
  editingForceIdx = null; // a normal preview exits force-edit mode
  output.classList.remove("force-play");
  if (results.length === 0) {
    output.innerHTML = `<p class="muted">Nothing to convert.</p>`;
    return;
  }
  if (results.length === 1 && results[0]!.ok) {
    const session = makeSession(results[0]!.result);
    if (session && session.weapons.length > 0) {
      edit = session;
      renderEdit();
      return;
    }
  }
  output.innerHTML = results.map((r) => (r.ok ? cardHtml(r.result) : r.html)).join("");
}

/** Re-render the editable card + its TIC editor from the current grouping. */
function renderEdit(): void {
  if (!edit) return;
  edit.apply(ticsFromGrouping(edit.weapons, edit.grouping));
  // Decorate the (TIC-edited) preview card with the same BV/quirks/role/TC
  // badges the force view shows, so the preview matches exactly.
  const first = lastResults?.length === 1 ? lastResults[0]! : null;
  const card = first?.ok ? decorateCard(edit.renderCard(), first.result) : edit.renderCard();
  output.innerHTML = card + renderTicEditorHtml(edit.weapons, edit.grouping, edit.facets);
}

// ---- Editing a unit that's in the force (TICs + skills, persisted) --------

/** Apply a force unit's saved TIC grouping onto a freshly converted card. */
function applySavedGrouping(result: AnyCard, grouping?: number[][]): void {
  if (!grouping) return;
  const session = makeSession(result);
  if (!session || session.weapons.length === 0) return;
  if (grouping.flat().length !== session.weapons.length) return; // stale grouping — ignore
  session.apply(ticsFromGrouping(session.weapons, grouping as Grouping));
}

const clampSkill = (v: string): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(8, Math.round(n))) : undefined;
};

function forceEditBar(u: ForceUnit): string {
  return `<div class="force-edit-bar"><span><b>${esc(u.name)}</b> — set each part's damage (or click pips), plus engine/gyro boxes &amp; weapons</span>
    <span class="force-edit-btns">
      <button id="force-reset-dmg" type="button">Reset damage</button>
      <button id="force-edit-done" type="button">Done</button>
    </span></div>`;
}

function skillsEditorHtml(u: ForceUnit): string {
  const p = pilotFor(u);
  const sk = unitSkills(u);
  const opts =
    `<option value="">— Custom —</option>` +
    pilots
      .map((pl) => `<option value="${pl.id}"${pl.id === u.pilotId ? " selected" : ""}>${esc(pl.name)} (${pl.gunnery}/${pl.piloting})</option>`)
      .join("");
  const dis = p ? " disabled" : "";
  return `<div class="skills-editor">
    <label>Pilot <select id="pilot-pick">${opts}</select></label>
    <label>Gunnery <input type="number" id="sk-gun" min="0" max="8" step="1" value="${sk.gunnery}"${dis}></label>
    <label>Piloting <input type="number" id="sk-pil" min="0" max="8" step="1" value="${sk.piloting}"${dis}></label>
    ${p?.abilities ? `<span class="pilot-abil">${esc(p.abilities)}</span>` : ""}
  </div>`;
}

/** Open the TIC + skills editor for a force unit. */
function openForceEditor(i: number): void {
  if (i < 0 || i >= force.length) return;
  editingForceIdx = i;
  renderForceEdit();
  output.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Render the force unit's card (with its saved TICs + skills) plus the editors. */
function renderForceEdit(): void {
  const fi = editingForceIdx;
  if (fi == null) return;
  const u = force[fi];
  const r = convertOne(u.text, u.file ?? u.name);
  if (!r.ok) {
    edit = null;
    output.innerHTML = forceEditBar(u) + r.html;
    return;
  }
  editMechCard = null;
  if (r.result.kind === "mech") {
    r.result.card.legHits = u.damage?.legHits; // play-mode leg penalty
    r.result.card.heat = u.damage?.heat; // play-mode heat: −2 Move / −1 TMM at 1+, +1 to-hit at 2+
    // The displayed card has TC + quirk effects baked in; keep that same adjusted
    // copy so updateTabletop can refresh Move/TMM + weapon to-hit mods in place.
    const adj = applyTargetingComputer(applyQuirkEffects(r.result));
    editMechCard = adj.kind === "mech" ? adj.card : null;
  }
  editTorsoCockpit =
    r.result.kind === "mech" && r.result.card.equipment.some((e) => /torso-mounted cockpit/i.test(e.label));
  let raw: string;
  let ticEditorHtml = "";
  const session = makeSession(r.result);
  if (session && session.weapons.length > 0) {
    if (u.grouping && u.grouping.flat().length === session.weapons.length) {
      session.grouping = u.grouping.map((g) => [...g]) as Grouping;
    }
    session.apply(ticsFromGrouping(session.weapons, session.grouping));
    edit = session; // the shared TIC-move/reset listeners act on this
    raw = session.renderCard();
    ticEditorHtml = renderTicEditorHtml(session.weapons, session.grouping, session.facets);
  } else {
    edit = null; // BA / infantry: skills only, no TICs
    raw = rawCardHtml(r.result);
  }
  const sk = unitSkills(u);
  const pHits = u.damage?.condition ?? 0; // each pilot hit: +1 gunnery & piloting
  const card = withTC(withRole(withQuirks(withSkills(withBv(raw, unitBv(u)), sk.gunnery + pHits, sk.piloting + pHits, pHits), lookupQuirks(u.name, u.file), u.file), lookupRole(u.name, u.file)), cardHasTC(r.result));
  editWeapons = weaponsForToHit(applyTargetingComputer(r.result)); // ranges already include any TC −1
  editSinks = unitSinks(r.result);
  editHasTC = /targeting\s*computer/i.test(u.text); // Targeting Computer → −1 to-hit
  output.classList.add("force-play"); // enables pip cursors / damage tracking
  output.innerHTML =
    forceEditBar(u) + skillsEditorHtml(u) + card + tabletopPanel(u, r.result) + ammoTrackerHtml(u, r.result) + ticEditorHtml;
  applyDamageMarks();
  updateTabletop();
}

// ---- Damage tracking (Tier 1): clickable armor/structure/condition pips -----
// Renderers stay pure; we tag each pip GROUP (.hexrow / BA .pips) by its ordinal
// position on the card (stable across re-renders) and mark the first N pips as
// hit from the unit's saved state. Crew condition is a single track.

/** (Re)apply the active force unit's damage marks to the rendered card, and
 * (for 'Mechs) disable TICs in destroyed limbs + flag the unit destroyed. */
function applyDamageMarks(): void {
  if (editingForceIdx == null) return;
  const dmg = force[editingForceIdx]!.damage ?? {};
  const destroyed = new Set<string>(); // paper-doll area codes whose STRUCTURE is gone
  let infTotal = 0; // infantry troopers + casualties (platoon wiped out when equal)
  let infDead = 0;
  // Biped SVG doll: ONE damage value per location (set by the per-part dropdowns).
  // Fills armor circles first, then structure squares; the location is destroyed
  // when the total reaches armor+structure (all structure gone).
  const bdoll = output.querySelector<HTMLElement>("svg.bdoll");
  if (bdoll) {
    // Rear armor bleeds into the (shared) torso structure once it's gone.
    const rearArmorCount = bdoll.querySelector(".mloc.tr .hexrow")?.children.length ?? 0;
    const structFromRear = Math.max(0, (dmg.loc?.tr ?? 0) - rearArmorCount);
    for (const mloc of Array.from(bdoll.querySelectorAll<HTMLElement>(".mloc"))) {
      const area = [...mloc.classList].find((c) => c !== "mloc");
      if (!area) continue;
      const rows = mloc.querySelectorAll<HTMLElement>(".hexrow");
      const armorPips = rows[0] ? (Array.from(rows[0].children) as HTMLElement[]) : [];
      const structPips = rows[1] ? (Array.from(rows[1].children) as HTMLElement[]) : [];
      const d = dmg.loc?.[area] ?? 0;
      armorPips.forEach((p, k) => p.classList.toggle("pip-hit", k < Math.min(d, armorPips.length)));
      // Structure consumed: front overflow + (torso only) rear overflow.
      const structHit = Math.max(0, d - armorPips.length) + (area === "ct" ? structFromRear : 0);
      structPips.forEach((p, k) => p.classList.toggle("pip-hit", k < Math.min(structHit, structPips.length)));
      if (structPips.length > 0 && structHit >= structPips.length) destroyed.add(area);
      const sel = output.querySelector<HTMLSelectElement>(`.dmg-ctl[data-area="${area}"] select`);
      if (sel) sel.value = String(d);
    }
  }
  Array.from(output.querySelectorAll<HTMLElement>(".hexrow, .ba-armor-pips .pips, .inf-pips")).forEach((g, gi) => {
    if (g.closest("svg.bdoll")) return; // biped doll handled above (per-location, not per-group)
    g.dataset.dg = String(gi);
    const pips = Array.from(g.children) as HTMLElement[];
    const hit = dmg.groups?.[`g${gi}`] ?? 0;
    pips.forEach((p, i) => {
      p.dataset.di = String(i);
      p.classList.toggle("pip-hit", i < hit);
    });
    // A fully-marked STRUCTURE row destroys its paper-doll location ('Mech).
    if (pips.length > 0 && pips[0]!.classList.contains("struct") && hit >= pips.length) {
      const mloc = g.closest<HTMLElement>(".mloc");
      const area = mloc && [...mloc.classList].find((c) => c !== "mloc");
      if (area) destroyed.add(area);
    }
    if (g.classList.contains("inf-pips")) {
      infTotal += pips.length;
      infDead += Math.min(hit, pips.length);
    }
  });
  // Crew condition track.
  const cond = dmg.condition ?? 0;
  Array.from(output.querySelectorAll<HTMLElement>(".condmon .cm-pip")).forEach((p, i) => {
    p.dataset.dc = String(i);
    p.classList.toggle("pip-hit", i < cond);
  });
  // Engine / gyro / avionics hit boxes ('Mech engine+gyro, aerospace engine+avionics).
  Array.from(output.querySelectorAll<HTMLElement>(".condmon .cm-grp")).forEach((grp) => {
    const boxes = Array.from(grp.querySelectorAll<HTMLElement>(".cm-box"));
    const label = grp.textContent?.trimStart() ?? "";
    const sys = label.startsWith("Engine")
      ? "engine"
      : label.startsWith("Gyro")
        ? "gyro"
        : label.startsWith("Avionics")
          ? "avionics"
          : label.startsWith("Leg")
            ? "legHits"
            : null;
    if (!boxes.length || !sys) return;
    const hit = dmg[sys] ?? 0;
    boxes.forEach((b, i) => {
      b.dataset.dsys = sys;
      b.dataset.di = String(i);
      b.classList.toggle("pip-hit", i < hit);
    });
  });
  // Ammo counters: remaining = total − expended.
  Array.from(output.querySelectorAll<HTMLElement>(".ammo-row")).forEach((row) => {
    const total = Number(row.dataset.total) || 0;
    const rem = Math.max(0, total - (row.dataset.ammo ? (dmg.ammo?.[row.dataset.ammo] ?? 0) : 0));
    const remEl = row.querySelector<HTMLElement>(".ammo-rem");
    if (remEl) remEl.textContent = String(rem);
    row.querySelector(".ammo-val")?.classList.toggle("ammo-empty", rem === 0);
  });
  // Weapon rows: struck out if their limb is destroyed OR manually disabled.
  const manual = new Set(dmg.tics ?? []);
  Array.from(output.querySelectorAll<HTMLElement>(".mweapons tbody tr")).forEach((tr, ti) => {
    tr.dataset.ti = String(ti);
    const loc = (tr.querySelector(".loc")?.textContent ?? "").replace(/\(R\)/, "").trim();
    const area = LOC_TO_AREA[loc];
    tr.classList.toggle("tic-dead", (!!area && destroyed.has(area)) || manual.has(ti));
  });
  // Unit status banner. DESTROYED (mech wrecked): center torso gone or 2 engine
  // hits. KIA (pilot dead): consciousness track fully marked, or head destroyed
  // unless a torso-mounted cockpit keeps the pilot alive. Wreck outranks KIA.
  const sheet = output.querySelector<HTMLElement>(".mech-sheet");
  if (sheet) {
    const condTotal = output.querySelectorAll(".condmon .cm-pip").length;
    const pilotDead = condTotal > 0 && (dmg.condition ?? 0) >= condTotal;
    const wrecked = destroyed.has("ct") || (dmg.engine ?? 0) >= 2 || (infTotal > 0 && infDead >= infTotal);
    const kia = pilotDead || (destroyed.has("hd") && !editTorsoCockpit);
    const status = wrecked ? "DESTROYED" : kia ? "KIA" : "";
    if (status) sheet.dataset.dead = status;
    else delete sheet.dataset.dead;
  }
  syncTrackedDamage();
}

/** Refresh the battle rosters and broadcast the tracked unit's damage (incl.
 * heat) to the opponent. mpBroadcast skips the echo while applying a remote
 * change. Called after ANY damage edit — pips, crits, heat, leg actuators. */
function syncTrackedDamage(): void {
  if (!inBattle()) return;
  renderBattle();
  const marker = forces[activeForce]?.battle;
  const u = editingForceIdx != null ? force[editingForceIdx] : undefined;
  if (marker && u && editingForceIdx != null) mpBroadcast(marker, editingForceIdx, u);
}

// Weapon-row location code (the .loc cell) -> paper-doll area class.
const LOC_TO_AREA: Readonly<Record<string, string>> = {
  LA: "la", RA: "ra", LL: "ll", RL: "rl", H: "hd", T: "ct", CL: "cl",
};

// ---- Tabletop assistant: heat dial + to-hit helper ------------------------
type WeaponRangeRow = { label: string; range: RangeBrackets | null; directFire: boolean };
let editWeapons: WeaponRangeRow[] = []; // weapons of the edited unit (for to-hit)
let editSinks = 0; // its heat dissipation (for the Cool button)
let editHasTC = false; // unit mounts a Targeting Computer (−1 to-hit)
let editMechCard: OverrideCard | null = null; // open mech card, for in-place Move/TMM refresh on heat change

const HEAT_EFFECT = [
  "No effects",
  "−2 Move / −1 TMM",
  "+1 Ranged Attack Mod",
  "Shutdown (avoid 8+)",
  "Ammo Explosion (avoid 8+)",
  "Automatic Shutdown",
];

/** A Targeting Computer aids DIRECT-FIRE weapons — energy (incl. pulse) and
 * ballistic — but not missiles or physical attacks. Heuristic on the printed
 * (abbreviated) label. */
function isDirectFireLabel(label: string): boolean {
  const s = label.toLowerCase();
  if (/rm[-\s]?\d|streak|rocket|\brl[-\s/]?\d|narc|\batm\b|\bmml\b|arrow|thunderbolt|tbolt|inferno/.test(s)) return false; // missiles
  if (/hatchet|sword|\bmace\b|blade|claw|talon|lance|flail|punch|kick|physical/.test(s)) return false; // physical
  return true;
}

/** The unit's weapons with range brackets, for the to-hit table. */
function weaponsForToHit(result: AnyCard): WeaponRangeRow[] {
  const row = (label: string, range: RangeBrackets | null): WeaponRangeRow => ({ label, range, directFire: isDirectFireLabel(label) });
  if (result.kind === "mech")
    return result.card.tics.map((t) => row(abbreviatedTicLabel(t, result.card.techBase), t.range));
  if (result.kind === "vehicle" || result.kind === "fighter" || result.kind === "protomech" || result.kind === "dropship")
    return result.card.weapons.map((w) => row(w.label, w.range));
  return [];
}

/** Heat dissipation (sinks) for the unit, or 0. */
function unitSinks(result: AnyCard): number {
  const c = result.card as { heatDissipation?: number; sinks?: number };
  return c.heatDissipation ?? c.sinks ?? 0;
}

/** Heat dial (mech/fighter/dropship) + per-weapon to-hit helper for play mode. */
function tabletopPanel(u: ForceUnit, result: AnyCard): string {
  const hasHeat = result.kind === "mech" || result.kind === "fighter" || result.kind === "dropship";
  if (!hasHeat && editWeapons.length === 0) return "";
  const heat = u.damage?.heat ?? 0;
  const heatBlock = hasHeat
    ? `<div class="ttop-heat"><span class="ttop-h">Heat</span>
        <button class="heat-btn" type="button" data-heat="-1">−</button>
        <span class="heat-val">${heat}</span>
        <button class="heat-btn" type="button" data-heat="1">+</button>
        <button class="heat-btn" type="button" data-heat="cool">Cool −${editSinks}</button>
        <span class="heat-eff"></span></div>`
    : "";
  const toHit = editWeapons.length
    ? `<div class="ttop-tohit"><span class="ttop-h">To-hit</span>
        <label>Range <select id="th-range"><option value="pb">PB</option><option value="s">S</option><option value="m" selected>M</option><option value="l">L</option><option value="x">X</option></select></label>
        <label>Move <select id="th-move"><option value="0">Still</option><option value="1">Walk</option><option value="2">Run</option><option value="3">Jump</option></select></label>
        <label>Tgt TMM <input id="th-tmm" type="number" value="0" class="th-num"></label>
        <label>Other <input id="th-other" type="number" value="0" class="th-num"></label>
        ${editHasTC ? '<span class="th-tc" title="Targeting Computer: −1 to-hit on direct-fire weapons (marked TC below)">TC −1 · direct-fire</span>' : ""}
        <div id="tohit-out" class="tohit-out"></div></div>`
    : "";
  return `<div class="ttop">${heatBlock}${toHit}</div>`;
}

// ---- Ammo counter ---------------------------------------------------------
/** The unit's ammo lines (any card kind carries CardEquipment). */
function unitAmmo(result: AnyCard): CardEquipment[] {
  return ((result.card as { equipment?: CardEquipment[] }).equipment ?? []).filter((e) => e.category === "ammo");
}
const ammoKey = (e: CardEquipment): string => `${e.label}@${e.location}`;
const ammoTotal = (e: CardEquipment): number => e.shots ?? e.count; // rounds if known, else tons

/** Per-bin ammo counter for play mode: remaining rounds with fire (−) / reload (+). */
function ammoTrackerHtml(u: ForceUnit, result: AnyCard): string {
  const ammo = unitAmmo(result);
  if (ammo.length === 0) return "";
  const rows = ammo
    .map((e) => {
      const total = ammoTotal(e);
      const unit = e.shots ? "rds" : e.count === 1 ? "ton" : "tons";
      const rem = Math.max(0, total - (u.damage?.ammo?.[ammoKey(e)] ?? 0));
      const loc = e.location === "CT" ? "T" : e.location;
      const bins = e.count > 1 ? ` ×${e.count}` : "";
      return `<div class="ammo-row" data-ammo="${esc(ammoKey(e))}" data-total="${total}">
        <span class="ammo-name">${esc(e.label)}${bins} <span class="eq-loc">(${esc(loc)})</span></span>
        <button class="ammo-btn" type="button" data-ammo-d="1" title="Fire one shot">−</button>
        <span class="ammo-val${rem === 0 ? " ammo-empty" : ""}"><span class="ammo-rem">${rem}</span><span class="ammo-tot">/${total} ${unit}</span></span>
        <button class="ammo-btn" type="button" data-ammo-d="-1" title="Reload one shot">+</button>
      </div>`;
    })
    .join("");
  return `<div class="ammo-track"><span class="ttop-h">Ammo</span>${rows}</div>`;
}

/** Refresh the heat readout, heat-scale highlight, and the to-hit table. */
function updateTabletop(): void {
  if (editingForceIdx == null) return;
  const u = force[editingForceIdx]!;
  const heat = u.damage?.heat ?? 0;
  const lvl = Math.max(0, Math.min(5, heat));
  const hv = output.querySelector(".heat-val");
  if (hv) hv.textContent = String(heat);
  const eff = output.querySelector(".heat-eff");
  if (eff) eff.textContent = HEAT_EFFECT[lvl] ?? "";
  output.querySelectorAll<HTMLElement>(".heatscale .hs-row").forEach((row) => {
    row.classList.toggle("hs-active", Number(row.querySelector(".hs-n")?.textContent) === lvl);
  });
  // Refresh the Move/TMM lines and the weapons to-hit table in place so heat (and
  // leg) penalties change the card itself without re-rendering — which keeps the
  // to-hit controls' state and avoids flicker on remote updates.
  if (editMechCard) {
    editMechCard.heat = heat;
    editMechCard.legHits = u.damage?.legHits;
    const replace = (sel: string, html: string, n = 1): void => {
      const tmpl = document.createElement("template");
      tmpl.innerHTML = html;
      const nodes = Array.from(tmpl.content.children).slice(0, n);
      const targets = Array.from(output.querySelectorAll(sel)).slice(0, n);
      if (nodes.length === n && targets.length === n) targets.forEach((t, i) => t.replaceWith(nodes[i]!));
    };
    replace(".ms-ud-move, .ms-ud-tmm", movementLines(editMechCard), 2);
    replace(".mweapons", weaponsTable(editMechCard));
  }
  // Pilot hits add +1 to gunnery & piloting — reflect that on the skill boxes.
  const pHits = u.damage?.condition ?? 0;
  const sk = unitSkills(u);
  const skBoxes = Array.from(output.querySelectorAll<HTMLElement>(".ms-skill-box, .ba-skill-box"));
  if (skBoxes[0]) skBoxes[0].innerHTML = skillVal(sk.gunnery + pHits, pHits);
  if (skBoxes[1]) skBoxes[1].innerHTML = skillVal(sk.piloting + pHits, pHits);
  const out = output.querySelector("#tohit-out");
  if (!out) return;
  const bracket = ((output.querySelector("#th-range") as HTMLSelectElement | null)?.value ?? "m") as keyof RangeBrackets;
  const move = Number((output.querySelector("#th-move") as HTMLSelectElement | null)?.value) || 0;
  const tmm = Number((output.querySelector("#th-tmm") as HTMLInputElement | null)?.value) || 0;
  const other = Number((output.querySelector("#th-other") as HTMLInputElement | null)?.value) || 0;
  const base = sk.gunnery + pHits + move + tmm + other + (heat >= 2 ? 1 : 0);
  out.innerHTML = `<table class="tohit-tbl"><tbody>${editWeapons
    .map((w) => {
      const m = w.range ? w.range[bracket] : null;
      const tcTag = editHasTC && w.directFire; // the −1 is already baked into the range bracket
      return `<tr><td>${esc(w.label)}${tcTag ? ' <span class="th-tc-row">TC</span>' : ""}</td><td class="num">${m == null ? "—" : `${base + m}+`}</td></tr>`;
    })
    .join("")}</tbody></table>`;
}

/** A click toggles a pip "level": clicking the last-hit pip un-marks it. */
const nextLevel = (cur: number, clicked: number): number => (cur === clicked + 1 ? clicked : clicked + 1);

output.addEventListener("click", (e) => {
  if (editingForceIdx == null) return;
  const t = e.target as HTMLElement;
  const u = force[editingForceIdx]!;
  if (t.closest("#force-reset-dmg")) {
    delete u.damage;
    saveForce();
    applyDamageMarks();
    updateTabletop();
    return;
  }
  const hb = t.closest<HTMLElement>(".heat-btn");
  if (hb?.dataset.heat) {
    u.damage ??= {};
    const cur = u.damage.heat ?? 0;
    u.damage.heat = hb.dataset.heat === "cool" ? Math.max(0, cur - editSinks) : Math.max(0, cur + Number(hb.dataset.heat));
    saveForce();
    updateTabletop();
    syncTrackedDamage(); // heat now syncs to the opponent in battle
    return;
  }
  const ab = t.closest<HTMLElement>(".ammo-btn");
  if (ab?.dataset.ammoD) {
    const row = ab.closest<HTMLElement>(".ammo-row");
    if (row?.dataset.ammo) {
      const total = Number(row.dataset.total) || 0;
      u.damage ??= {};
      u.damage.ammo ??= {};
      const cur = u.damage.ammo[row.dataset.ammo] ?? 0;
      const next = Math.min(total, Math.max(0, cur + Number(ab.dataset.ammoD)));
      if (next === 0) delete u.damage.ammo[row.dataset.ammo];
      else u.damage.ammo[row.dataset.ammo] = next;
      saveForce();
      applyDamageMarks();
    }
    return;
  }
  const cm = t.closest<HTMLElement>(".cm-pip");
  if (cm?.dataset.dc != null) {
    u.damage ??= {};
    u.damage.condition = nextLevel(u.damage.condition ?? 0, Number(cm.dataset.dc));
    saveForce();
    applyDamageMarks();
    updateTabletop(); // pilot hits change gunnery/piloting + to-hit
    return;
  }
  const box = t.closest<HTMLElement>(".cm-box");
  if (box?.dataset.dsys === "engine" || box?.dataset.dsys === "gyro" || box?.dataset.dsys === "avionics" || box?.dataset.dsys === "legHits") {
    const sys = box.dataset.dsys;
    u.damage ??= {};
    u.damage[sys] = nextLevel(u.damage[sys] ?? 0, Number(box.dataset.di));
    saveForce();
    if (sys === "legHits") renderForceEdit(); // leg hits change the Move/TMM line
    else applyDamageMarks();
    return;
  }
  const pip = t.closest<HTMLElement>(".hex, .pip, .ms-body");
  const grp = pip?.closest<HTMLElement>(".hexrow, .pips, .inf-pips");
  if (pip?.dataset.di != null && grp?.dataset.dg != null) {
    u.damage ??= {};
    u.damage.groups ??= {};
    const key = `g${grp.dataset.dg}`;
    u.damage.groups[key] = nextLevel(u.damage.groups[key] ?? 0, Number(pip.dataset.di));
    saveForce();
    applyDamageMarks();
    return;
  }
  // Manually disable / re-enable a specific weapon TIC.
  const row = t.closest<HTMLElement>(".mweapons tbody tr");
  if (row?.dataset.ti != null) {
    const ti = Number(row.dataset.ti);
    u.damage ??= {};
    const set = new Set(u.damage.tics ?? []);
    if (set.has(ti)) set.delete(ti);
    else set.add(ti);
    u.damage.tics = [...set];
    saveForce();
    applyDamageMarks();
  }
});

/** Persist + re-render after a TIC move/reset, in force-edit mode or the plain preview. */
function afterTicChange(): void {
  if (editingForceIdx != null && edit) {
    force[editingForceIdx]!.grouping = edit.grouping.map((g) => [...g]);
    saveForce();
    renderForceEdit();
  } else {
    renderEdit();
  }
}

// Delegated editor controls (the panel is re-rendered on each change, so listen
// on the stable `output` container rather than the transient selects/buttons).
// To-hit inputs (range / move / TMM / other) recompute the table live.
output.addEventListener("input", (e) => {
  const t = e.target as HTMLElement;
  if (editingForceIdx != null && t.id.startsWith("th-")) updateTabletop();
});
output.addEventListener("change", (e) => {
  const target = e.target as HTMLElement;
  if (editingForceIdx != null && target.id.startsWith("th-")) {
    updateTabletop();
    return;
  }
  // Biped-doll per-location damage dropdown.
  const dctl = target.closest<HTMLElement>(".dmg-ctl");
  if (editingForceIdx != null && dctl?.dataset.area) {
    const u = force[editingForceIdx]!;
    u.damage ??= {};
    u.damage.loc ??= {};
    u.damage.loc[dctl.dataset.area] = Number((target as HTMLSelectElement).value) || 0;
    saveForce();
    applyDamageMarks();
    return;
  }
  // Assign a stable pilot to the force unit.
  if (editingForceIdx != null && target.id === "pilot-pick") {
    force[editingForceIdx]!.pilotId = (target as HTMLSelectElement).value || undefined;
    saveForce();
    renderForceEdit();
    renderForce();
    return;
  }
  // Skill inputs (force editor): persist onto the force unit (custom pilot only).
  if (editingForceIdx != null && (target.id === "sk-gun" || target.id === "sk-pil")) {
    const val = clampSkill((target as HTMLInputElement).value);
    if (target.id === "sk-gun") force[editingForceIdx]!.gunnery = val;
    else force[editingForceIdx]!.piloting = val;
    saveForce();
    renderForceEdit();
    renderForce();
    return;
  }
  const sel = target.closest<HTMLSelectElement>("select.tic-move");
  if (!sel || !edit || !sel.value) return;
  const wi = Number(sel.dataset.wi);
  const tgt = sel.value === "new" ? "new" : Number(sel.value.replace(/^g:/, ""));
  edit.grouping = applyMove(edit.grouping, wi, tgt);
  afterTicChange();
});
output.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest("#force-edit-done")) {
    editingForceIdx = null;
    edit = null;
    output.innerHTML = "";
    return;
  }
  if (!target.closest("#tic-reset") || !edit) return;
  edit.grouping = edit.autoGrouping.map((g) => [...g]);
  if (editingForceIdx != null) delete force[editingForceIdx]!.grouping;
  afterTicChange();
});

// ---- Force builder + print sheet ------------------------------------------
// A persistent collection of units (source text + name) the user assembles from
// the browser / input area, rendered all at once onto a print-optimized sheet.
// Stored as SOURCE text (not converted cards) so it survives reloads and stays
// independent of any in-progress TIC edits.

interface ForceUnit {
  name: string;
  text: string;
  file?: string;
  /** Formation this unit belongs to (lance / star / Level II / …). Free-form;
   * undefined = unassigned. Carried into battle (forces are deep-cloned). */
  lance?: string;
  /** Pilot skills (default 4 / 5 when unset). Overridden by an assigned pilot. */
  gunnery?: number;
  piloting?: number;
  /** Assigned stable pilot (id); its skills take precedence over the unit's. */
  pilotId?: string;
  /** Saved TIC grouping override (weapon-index groups) from the editor. */
  grouping?: number[][];
  /** Opaque campaign ids (set only when loaded from an OVERRIDE GM Tool handoff),
   * carried untouched so the played-out result can be posted back to the campaign. */
  campaignUnitId?: string;
  campaignPilotIds?: string[];
  /** Live damage state (Tier-1 tracking): hit-pip counts per pip group, crew
   * condition, engine/gyro hits, and manually-disabled weapon-row ordinals. */
  damage?: {
    groups?: Record<string, number>;
    /** Biped paper-doll: total damage per location area (fills armor then structure). */
    loc?: Record<string, number>;
    condition?: number;
    engine?: number;
    gyro?: number;
    avionics?: number;
    /** Leg actuator hits (count). Each lowers TMM by 1 and movement by 2. */
    legHits?: number;
    tics?: number[];
    /** Current heat level (tabletop assistant). */
    heat?: number;
    /** Rounds expended per ammo line (key = "label@location"); remaining = total − this. */
    ammo?: Record<string, number>;
    /** Battle tracker: marked out of action (destroyed / withdrawn). */
    out?: boolean;
  };
}
/** A named force: a roster of units the user can save, switch, export, share. */
interface SavedForce { name: string; units: ForceUnit[]; battle?: "you" | "foe" }
const FORCE_KEY = "mtf2override.force"; // legacy single-force key (migrated once)
const FORCES_KEY = "mtf2override.forces"; // { active, forces: SavedForce[] }

function loadForces(): { active: number; forces: SavedForce[] } {
  try {
    const raw = localStorage.getItem(FORCES_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { active?: number; forces?: SavedForce[] };
      if (Array.isArray(p.forces) && p.forces.length) {
        const fs = p.forces.map((f) => ({ name: f.name || "Force", units: Array.isArray(f.units) ? f.units : [] }));
        return { active: Math.max(0, Math.min(fs.length - 1, p.active ?? 0)), forces: fs };
      }
    }
    // Migrate a legacy single force (old key), if present.
    const old = localStorage.getItem(FORCE_KEY);
    const units = old ? (JSON.parse(old) as ForceUnit[]) : [];
    return { active: 0, forces: [{ name: "My Force", units: Array.isArray(units) ? units : [] }] };
  } catch {
    return { active: 0, forces: [{ name: "My Force", units: [] }] };
  }
}

const _forceState = loadForces();
let forces: SavedForce[] = _forceState.forces;
let activeForce = _forceState.active;
let force: ForceUnit[] = forces[activeForce]!.units; // the active roster (mutated in place)

function saveForce(): void {
  try {
    localStorage.setItem(FORCES_KEY, JSON.stringify({ active: activeForce, forces }));
  } catch {
    /* storage may be unavailable (private mode / quota) — the in-memory forces still work */
  }
}

/** Switch the active force (rebinding `force` to its roster, in place). */
function setActiveForce(i: number): void {
  if (i < 0 || i >= forces.length) return;
  exitForceEditor();
  activeForce = i;
  force = forces[activeForce]!.units;
  saveForce();
  renderForce();
}
function newForce(): void {
  const name = (prompt("Name for the new force:", `Force ${forces.length + 1}`) ?? "").trim();
  if (!name) return;
  forces.push({ name, units: [] });
  setActiveForce(forces.length - 1);
}
function renameForce(): void {
  const cur = forces[activeForce]!;
  const name = (prompt("Rename force:", cur.name) ?? "").trim();
  if (!name) return;
  cur.name = name;
  saveForce();
  renderForce();
}
function deleteForce(): void {
  if (!confirm(`Delete force "${forces[activeForce]!.name}"? This can't be undone.`)) return;
  exitForceEditor();
  forces.splice(activeForce, 1);
  if (forces.length === 0) forces.push({ name: "My Force", units: [] });
  activeForce = Math.max(0, Math.min(forces.length - 1, activeForce));
  force = forces[activeForce]!.units;
  saveForce();
  renderForce();
}

function addToForce(name: string, text: string, file?: string, grouping?: number[][]): void {
  force.push({ name: name || "Unit", text, file, ...(grouping ? { grouping } : {}) });
  saveForce();
  renderForce();
}

/** Add the currently-previewed unit (from Browse or Upload) to the force. */
function addCurrentToForce(): void {
  if (!currentPreview) {
    output.innerHTML = `<p class="muted">Browse or upload a unit first, then add it.</p>`;
    return;
  }
  const { text, file } = currentPreview;
  const r = convertOne(text, file);
  // Carry over any TIC regrouping done in the preview.
  const grouping = edit ? edit.grouping.map((g) => [...g]) : undefined;
  addToForce(r.ok ? r.result.card.name : "Unit", text, file, grouping); // file enables filename-based BV match
}

/** Render the force list panel (with per-unit BV + total) and toggle Print. */
/** Rebuild the force-picker dropdown (names + unit counts). */
function renderForcePicker(): void {
  const pick = document.getElementById("force-pick") as HTMLSelectElement | null;
  if (!pick) return;
  pick.innerHTML = forces
    .map((f, i) => `<option value="${i}"${i === activeForce ? " selected" : ""}>${esc(f.name)} (${f.units.length})</option>`)
    .join("");
}

/** Distinct lance/star names in the active force, in first-appearance order. */
function forceLances(): string[] {
  const seen: string[] = [];
  for (const u of force) if (u.lance && !seen.includes(u.lance)) seen.push(u.lance);
  return seen;
}

function renderForce(): void {
  renderForcePicker();
  const listEl = document.getElementById("force-list");
  const countEl = document.getElementById("force-count");
  const printBtn = document.getElementById("force-print") as HTMLButtonElement | null;
  if (!listEl) return;
  if (printBtn) printBtn.disabled = force.length === 0;
  let total = 0;
  let withBvCount = 0;
  if (countEl) countEl.textContent = force.length ? `(${force.length})` : "";
  const lances = forceLances(); // distinct lance names, in first-appearance order
  const lanceOpts = (cur?: string): string =>
    [`<option value=""${!cur ? " selected" : ""}>— Unassigned —</option>`]
      .concat(lances.map((l) => `<option value="${esc(l)}"${cur === l ? " selected" : ""}>${esc(l)}</option>`))
      .concat('<option value="__new__">＋ New lance…</option>')
      .join("");
  const unitRow = (u: ForceUnit, i: number): string => {
    const bv = unitBv(u); // skill-adjusted
    if (bv) { total += bv; withBvCount += 1; }
    const bvTag = bv ? `<span class="force-item-bv">${bv.toLocaleString()}</span>` : "";
    return (
      `<div class="force-item"><button class="force-item-name" type="button" data-i="${i}" title="Edit TICs / skills for ${esc(u.name)}">${esc(u.name)}</button>${bvTag}` +
      `<select class="lance-pick" data-i="${i}" title="Assign to a lance / star">${lanceOpts(u.lance)}</select>` +
      `<button class="force-remove" type="button" data-i="${i}" title="Remove" aria-label="Remove ${esc(u.name)}">✕</button></div>`
    );
  };
  if (force.length === 0) {
    listEl.innerHTML = `<p class="muted force-empty">No units yet. Add units from the browser (＋).</p>`;
  } else if (lances.length === 0) {
    listEl.innerHTML = force.map((u, i) => unitRow(u, i)).join(""); // flat list until you make lances
  } else {
    // Grouped by lance (assigned lances first in their order, Unassigned last).
    listEl.innerHTML = [...lances, ""]
      .map((lance) => {
        const members = force.map((u, i) => ({ u, i })).filter(({ u }) => (u.lance ?? "") === lance);
        if (members.length === 0) return "";
        const gbv = members.reduce((s, { u }) => s + (unitBv(u) ?? 0), 0);
        const head = `<div class="lance-head"><span class="lance-name">${lance ? esc(lance) : "Unassigned"}</span><span class="muted lance-meta">${members.length}${gbv ? ` · ${gbv.toLocaleString()} BV` : ""}</span></div>`;
        return `<div class="lance-group">${head}${members.map(({ u, i }) => unitRow(u, i)).join("")}</div>`;
      })
      .join("");
  }
  // Total BV line (notes if some units had no BV match).
  const totalEl = document.getElementById("force-total");
  if (totalEl) {
    totalEl.innerHTML =
      force.length && total
        ? `Total BV <b>${total.toLocaleString()}</b>` +
          (withBvCount < force.length ? ` <span class="muted">(${force.length - withBvCount} without BV)</span>` : "")
        : "";
  }
  if (analyticsOpen()) renderAnalytics(); // keep the analytics panel live
}

// ---- Force analytics ------------------------------------------------------
interface RosterRow { name: string; type: string; tons: number; cls: string; role: string; move: string; skills: string; bv?: number }
interface ForceStats {
  count: number; totalBv: number; withBv: number; totalTons: number;
  fp: { short: number; med: number; long: number };
  byType: Map<string, number>; byClass: Map<string, number>; byRole: Map<string, number>; roster: RosterRow[];
}
const TYPE_LABEL: Record<string, string> = {
  mech: "’Mech", vehicle: "Vehicle", fighter: "Fighter", protomech: "ProtoMech",
  battlearmor: "Battle Armor", infantry: "Infantry", dropship: "DropShip",
};
const CLASS_ORDER = ["Light", "Medium", "Heavy", "Assault"];
/** 'Mech-style weight class by tonnage (null for protos / BA / infantry). */
function weightClass(tons: number): string | null {
  if (!tons || tons < 20) return null;
  if (tons <= 35) return "Light";
  if (tons <= 55) return "Medium";
  if (tons <= 75) return "Heavy";
  return "Assault";
}
interface FpWeapon { profile: { kind: string; byRange: number[]; max: number }; range: { s: number | null; m: number | null; l: number | null } | null }
/** TICs (which carry the damage `profile` + `range`) for the firepower curve.
 * Every weapon-bearing card exposes `.tics`; cards without it (e.g. infantry)
 * fall through to an empty list. NB: the weapon *rows* (card.weapons) have no
 * `profile`, so the curve must read TICs. */
function unitWeapons(result: AnyCard): FpWeapon[] {
  return (result.card as { tics?: FpWeapon[] }).tics ?? [];
}
function damageAt(p: FpWeapon["profile"], band: 0 | 1 | 2): number {
  if (p.kind === "variable" && p.byRange.length) return p.byRange[Math.min(band, p.byRange.length - 1)] ?? 0;
  return p.max ?? 0;
}
function analyzeForce(units: ForceUnit[]): ForceStats {
  const roster: RosterRow[] = [];
  const byType = new Map<string, number>();
  const byClass = new Map<string, number>();
  const byRole = new Map<string, number>();
  let totalBv = 0, withBv = 0, totalTons = 0;
  const fp = { short: 0, med: 0, long: 0 };
  for (const u of units) {
    const r = convertOne(u.text, u.file ?? u.name);
    if (!r.ok) { roster.push({ name: u.name, type: "—", tons: 0, cls: "—", role: "—", move: "—", skills: "—" }); continue; }
    const card = r.result.card as { tonnage?: number; mass?: number; move?: string };
    const tons = card.tonnage ?? card.mass ?? 0;
    const cls = weightClass(tons);
    const type = TYPE_LABEL[r.result.kind] ?? r.result.kind;
    const role = lookupRole(u.name, u.file);
    const bv = unitBv(u);
    const sk = unitSkills(u);
    if (bv) { totalBv += bv; withBv += 1; }
    totalTons += tons;
    byType.set(type, (byType.get(type) ?? 0) + 1);
    if (cls) byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
    if (role) byRole.set(role, (byRole.get(role) ?? 0) + 1);
    for (const w of unitWeapons(r.result)) {
      if (!w.range) continue;
      if (w.range.s !== null) fp.short += damageAt(w.profile, 0);
      if (w.range.m !== null) fp.med += damageAt(w.profile, 1);
      if (w.range.l !== null) fp.long += damageAt(w.profile, 2);
    }
    roster.push({ name: u.name, type, tons, cls: cls ?? "—", role: role ?? "—", move: card.move ?? "—", skills: `${sk.gunnery}/${sk.piloting}`, bv });
  }
  return { count: units.length, totalBv, withBv, totalTons, fp, byType, byClass, byRole, roster };
}

const anStat = (label: string, value: string): string =>
  `<div class="an-stat"><div class="an-stat-v">${value}</div><div class="an-stat-l">${label}</div></div>`;
function summaryHtml(a: ForceStats): string {
  const avg = a.withBv ? Math.round(a.totalBv / a.withBv) : 0;
  const perTon = a.totalTons ? (a.totalBv / a.totalTons).toFixed(1) : "—";
  return `<div class="an-stats">${anStat("Units", String(a.count))}${anStat("Total BV", a.totalBv.toLocaleString())}` +
    `${anStat("Tonnage", a.totalTons.toLocaleString())}${anStat("Avg BV", avg.toLocaleString())}${anStat("BV / ton", String(perTon))}</div>`;
}
function firepowerHtml(a: ForceStats): string {
  const { short, med, long } = a.fp;
  const max = Math.max(short, med, long, 1);
  const bar = (label: string, v: number): string =>
    `<div class="an-fp-row"><span class="an-fp-lbl">${label}</span>` +
    `<span class="an-fp-bar"><span style="width:${((v / max) * 100).toFixed(1)}%"></span></span><span class="an-fp-v">${v}</span></div>`;
  return `<div class="an-sec"><h4>Firepower by range <span class="muted">(alpha damage)</span></h4>${bar("Short", short)}${bar("Medium", med)}${bar("Long", long)}</div>`;
}
function compositionHtml(a: ForceStats): string {
  const types = [...a.byType].map(([t, n]) => `<span class="an-chip">${esc(t)} <b>${n}</b></span>`).join("");
  const cls = CLASS_ORDER.filter((c) => a.byClass.get(c)).map((c) => `<span class="an-chip">${c} <b>${a.byClass.get(c)}</b></span>`).join("");
  const roles = [...a.byRole]
    .sort((x, y) => y[1] - x[1])
    .map(([role, n]) => `<span class="an-chip an-role">${esc(role)} <b>${n}</b></span>`)
    .join("");
  return `<div class="an-sec"><h4>Composition</h4><div class="an-chips">${types}</div>` +
    `${cls ? `<div class="an-chips">${cls}</div>` : ""}` +
    `${roles ? `<div class="an-chips">${roles}</div>` : ""}</div>`;
}
function musterHtml(a: ForceStats): string {
  const rows = a.roster
    .map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.type)}</td>` +
      `<td class="num">${r.tons || "—"}</td><td>${esc(r.cls)}</td><td>${esc(r.role)}</td><td>${esc(r.move)}</td><td class="num">${esc(r.skills)}</td>` +
      `<td class="num">${r.bv ? r.bv.toLocaleString() : "—"}</td></tr>`)
    .join("");
  return `<div class="an-sec"><h4>Muster sheet</h4><table class="an-muster"><thead><tr>` +
    `<th class="num">#</th><th>Unit</th><th>Type</th><th class="num">Tons</th><th>Class</th><th>Role</th><th>Move</th><th class="num">G/P</th><th class="num">BV</th>` +
    `</tr></thead><tbody>${rows}</tbody><tfoot><tr><td></td><td><b>Total</b></td><td></td>` +
    `<td class="num"><b>${a.totalTons.toLocaleString()}</b></td><td colspan="4"></td><td class="num"><b>${a.totalBv.toLocaleString()}</b></td></tr></tfoot></table></div>`;
}
function analyticsOpen(): boolean {
  return document.getElementById("analytics-toggle")?.getAttribute("aria-expanded") === "true";
}
function renderAnalytics(): void {
  const out = document.getElementById("analytics-out");
  if (!out) return;
  if (force.length === 0) {
    out.innerHTML = `<p class="muted">No units in this force yet.</p>`;
    return;
  }
  const a = analyzeForce(force);
  out.innerHTML = summaryHtml(a) + firepowerHtml(a) + compositionHtml(a) + musterHtml(a);
}
function printMuster(): void {
  if (force.length === 0) return;
  const area = document.getElementById("print-area");
  if (!area) return;
  const a = analyzeForce(force);
  pageStyle.textContent = `@page { size: portrait; margin: 12mm; }`;
  area.innerHTML = `${sheetHeader()}<div class="muster-print">${summaryHtml(a)}${firepowerHtml(a)}${compositionHtml(a)}${musterHtml(a)}</div>`;
  document.body.classList.add("print-mode");
  const cleanup = (): void => {
    document.body.classList.remove("print-mode");
    pageStyle.textContent = "";
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}
document.getElementById("analytics-toggle")?.addEventListener("click", () => {
  const body = document.getElementById("analytics-body");
  const tg = document.getElementById("analytics-toggle");
  if (!body || !tg) return;
  const show = body.hasAttribute("hidden");
  body.toggleAttribute("hidden", !show);
  tg.setAttribute("aria-expanded", String(show));
  if (show) renderAnalytics();
});
document.getElementById("analytics-print")?.addEventListener("click", printMuster);

// A dedicated <style> whose @page rule sets the print orientation (CSS @page
// can't be toggled by a class, so we rewrite this rule per print).
const pageStyle = document.createElement("style");
document.head.appendChild(pageStyle);

/** The selected print layout: "fit" = 2×2 portrait, "fitL" = 2×2 landscape,
 * "p2" = 2 per row (portrait), "p1" = 1 per row (portrait). */
function forceMode(): "fit" | "fitL" | "p2" | "p1" {
  const v = (document.getElementById("force-cols") as HTMLSelectElement | null)?.value;
  return v === "fitL" || v === "p2" || v === "p1" ? v : "fit";
}

/** Convert one force unit to card HTML (or its error card), applying its saved
 * TIC grouping + pilot skills + BV. Uses the stored filename for the BV match. */
function forceCardHtml(u: ForceUnit): string {
  const r = convertOne(u.text, u.file ?? u.name);
  if (!r.ok) return r.html;
  applySavedGrouping(r.result, u.grouping);
  (r.result.card as { bv?: number }).bv = unitBv(u); // skill-adjusted BV on the badge
  const sk = unitSkills(u);
  return withSkills(cardHtml(r.result), sk.gunnery, sk.piloting);
}

/** Fit every card into its fixed quarter-page cell, measured off-screen.
 *
 * Cards are tall, so the cell aspect rarely matches the card's natural aspect.
 * But a card rendered WIDER wraps less and gets shorter — so for each card we
 * try a range of render widths and keep the one whose scaled result fills the
 * most cell area. That both avoids the 2-column collision (the narrow widths
 * lose) and uses nearly the whole cell. The winner is centered and uniformly
 * scaled (with a little headroom so print metric drift never clips). */
function fitCardsToCells(area: HTMLElement): void {
  const SAFETY = 0.97; // headroom against print font-metric drift
  // Render widths to try (mm). Finer steps + a narrower low end let the fitter
  // match each card's aspect to the cell more closely — short/wide cards
  // (vehicles, infantry) reflow taller to fill the cell height instead of
  // floating with a big bottom gap.
  const WIDTHS_MM = [120, 132, 144, 156, 168, 180, 195, 210];
  // Lay the sheet out off-screen so offset/scroll sizes are real (it is
  // display:none in normal flow); mm → px is the 96dpi CSS constant either way.
  area.style.cssText = "display:block;position:fixed;left:-10000px;top:0;";
  for (const cell of Array.from(area.querySelectorAll<HTMLElement>(".fit-cell"))) {
    const el = cell.querySelector<HTMLElement>(".fit-scale");
    if (!el) continue;
    const cw = cell.clientWidth;
    const ch = cell.clientHeight;
    let best: { wmm: number; w: number; h: number; s: number; area: number } | null = null;
    for (const wmm of WIDTHS_MM) {
      el.style.width = `${wmm}mm`;
      const w = el.scrollWidth || 1;
      const h = el.scrollHeight || 1;
      const s = Math.min(cw / w, ch / h);
      const filled = w * h * s * s; // printed area in the cell
      if (!best || filled > best.area) best = { wmm, w, h, s, area: filled };
    }
    el.style.width = `${best!.wmm}mm`;
    const { w, h } = best!;
    // Scale up to fill the cell on BOTH axes (not just the constraining one),
    // letting the card stretch up to `sheetFill` on the under-filled axis to eat
    // the leftover gap. Beyond that it stays uniform so distortion never gets
    // harsh. `sheetFill` is driven live by the print-preview "Fill" slider.
    const STRETCH = sheetFill;
    const sx = cw / w;
    const sy = ch / h;
    const base = Math.min(sx, sy);
    const scaleX = Math.min(sx, base * STRETCH) * SAFETY;
    const scaleY = Math.min(sy, base * STRETCH) * SAFETY;
    const tx = Math.max(0, (cw - w * scaleX) / 2);
    const ty = Math.max(0, (ch - h * scaleY) / 2);
    el.style.transform = `translate(${tx}px, ${ty}px) scale(${scaleX}, ${scaleY})`;
  }
  area.style.cssText = ""; // hand display back to the stylesheet (#print-area)
}

/** The active force's total (skill-adjusted) BV. */
function forceTotalBv(): number {
  let total = 0;
  for (const u of force) {
    const bv = unitBv(u);
    if (bv) total += bv;
  }
  return total;
}

/** A print-sheet header row: force name, total BV, and (fit modes) page x of y. */
function sheetHeader(pageNum?: number, pageCount?: number): string {
  const total = forceTotalBv();
  const bvTag = total ? `<span class="sheet-head-bv">Total BV ${total.toLocaleString()}</span>` : "";
  const pageTag =
    pageNum && pageCount ? `<span class="sheet-head-page">Page ${pageNum} of ${pageCount}</span>` : "";
  return `<div class="sheet-head"><span class="sheet-head-name">${esc(forces[activeForce]!.name)}</span>${bvTag}${pageTag}</div>`;
}

/** Build all force cards, swap the page to the print container, and print. */
let sheetFill = 1.16; // print fill/stretch cap (1.0 = no stretch); driven by the preview slider
let previewZoom = 0.75; // on-screen preview zoom

/** Build the print pages into #print-area for the current layout + fill, and fit
 * the cards. Pure layout — no printing. */
function buildSheet(): void {
  const area = document.getElementById("print-area");
  if (!area) return;
  const mode = forceMode();
  const isFit = mode === "fit" || mode === "fitL";
  const orientation = mode === "fitL" ? "landscape" : "portrait";
  pageStyle.textContent = `@page { size: ${orientation}; margin: 10mm; }`;
  if (isFit) {
    // 2×2 per page: chunk into fours, each its own page (with a header), each card fit to a cell.
    const sheetClass = mode === "fitL" ? "sheet fit-landscape" : "sheet fit-portrait";
    const pageCount = Math.ceil(force.length / 4);
    const pages: string[] = [];
    for (let i = 0; i < force.length; i += 4) {
      const cells = force
        .slice(i, i + 4)
        .map((u) => `<div class="fit-cell"><div class="fit-scale">${forceCardHtml(u)}</div></div>`)
        .join("");
      pages.push(
        `<div class="print-page">${sheetHeader(i / 4 + 1, pageCount)}<div class="${sheetClass}">${cells}</div></div>`,
      );
    }
    area.innerHTML = pages.join("");
    fitCardsToCells(area);
  } else {
    // Flowing layout: one header at the top (page numbers need explicit pages).
    area.innerHTML = `${sheetHeader()}<div class="sheet cols-${mode === "p1" ? "1" : "2"}">${force.map(forceCardHtml).join("")}</div>`;
  }
}

/** Apply the preview zoom (cleared by fitCardsToCells' cssText reset, so re-set it). */
function applyPreviewZoom(): void {
  const area = document.getElementById("print-area");
  if (area) (area.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(previewZoom);
  const z = document.getElementById("pp-zoom-val");
  if (z) z.textContent = `${Math.round(previewZoom * 100)}%`;
}

/** Open the on-screen print preview (WYSIWYG; the Fill slider tunes the fit). */
function openPreview(): void {
  if (force.length === 0) return;
  buildSheet();
  document.body.classList.add("previewing");
  // Auto-fit the zoom so a page fits the viewport width.
  const page = document.querySelector<HTMLElement>("#print-area .print-page, #print-area .sheet");
  if (page) previewZoom = Math.min(1, Math.max(0.35, (window.innerWidth - 90) / (page.scrollWidth || 900)));
  applyPreviewZoom();
  const fill = document.getElementById("pp-fill") as HTMLInputElement | null;
  if (fill) fill.value = String(Math.round(sheetFill * 100));
  const fv = document.getElementById("pp-fill-val");
  if (fv) fv.textContent = `${Math.round(sheetFill * 100)}%`;
  const lay = document.getElementById("pp-layout") as HTMLSelectElement | null;
  const cols = document.getElementById("force-cols") as HTMLSelectElement | null;
  if (lay && cols) lay.value = cols.value;
}
function closePreview(): void {
  document.body.classList.remove("previewing");
  pageStyle.textContent = "";
}
/** Re-fit + re-zoom the live preview without rebuilding cards (Fill changes). */
function refitPreview(): void {
  const area = document.getElementById("print-area");
  const mode = forceMode();
  if (area && (mode === "fit" || mode === "fitL")) fitCardsToCells(area);
  applyPreviewZoom();
}
/** Rebuild + re-fit the live preview (layout changes). */
function refreshPreview(): void {
  buildSheet();
  applyPreviewZoom();
}
function printFromPreview(): void {
  document.body.classList.remove("previewing");
  const area = document.getElementById("print-area");
  if (area) area.style.cssText = ""; // drop the preview zoom/overlay inline styles
  // Recompute the fit in a clean (non-preview) context so the print matches the
  // current Fill — the preview-context transforms don't translate to the print
  // render. This mirrors the original (working) build → fit → print flow.
  buildSheet();
  document.body.classList.add("print-mode");
  const cleanup = (): void => {
    document.body.classList.remove("print-mode");
    pageStyle.textContent = "";
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}

// Force-panel controls.
$("add-force").addEventListener("click", addCurrentToForce);
$("force-print").addEventListener("click", openPreview);
document.getElementById("pp-close")?.addEventListener("click", closePreview);
document.getElementById("pp-print")?.addEventListener("click", printFromPreview);
document.getElementById("pp-fill")?.addEventListener("input", (e) => {
  sheetFill = Number((e.target as HTMLInputElement).value) / 100;
  const fv = document.getElementById("pp-fill-val");
  if (fv) fv.textContent = `${(e.target as HTMLInputElement).value}%`;
  refitPreview();
});
document.getElementById("pp-layout")?.addEventListener("change", (e) => {
  const cols = document.getElementById("force-cols") as HTMLSelectElement | null;
  if (cols) cols.value = (e.target as HTMLSelectElement).value;
  refreshPreview();
});
const ppZoom = (delta: number): void => {
  previewZoom = Math.min(1.5, Math.max(0.3, previewZoom + delta));
  applyPreviewZoom();
};
document.getElementById("pp-zoom-in")?.addEventListener("click", () => ppZoom(0.1));
document.getElementById("pp-zoom-out")?.addEventListener("click", () => ppZoom(-0.1));
function exitForceEditor(): void {
  if (editingForceIdx == null) return;
  editingForceIdx = null;
  edit = null;
  output.classList.remove("force-play");
  output.innerHTML = "";
}
$("force-clear").addEventListener("click", () => {
  if (force.length === 0) return;
  if (!confirm(`Remove all units from "${forces[activeForce]!.name}"?`)) return;
  force.length = 0; // clear in place — keep the reference into forces[activeForce]
  exitForceEditor();
  saveForce();
  renderForce();
});
$("force-list").addEventListener("change", (e) => {
  const sel = (e.target as HTMLElement).closest<HTMLSelectElement>(".lance-pick");
  if (!sel) return;
  const u = force[Number(sel.dataset.i)];
  if (!u) return;
  let val = sel.value;
  if (val === "__new__") {
    const name = prompt("New lance / star name:", `Lance ${forceLances().length + 1}`)?.trim();
    if (!name) { renderForce(); return; } // cancelled — reset the dropdown
    val = name;
  }
  u.lance = val || undefined;
  saveForce();
  renderForce();
});
$("force-list").addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const nameBtn = target.closest<HTMLElement>(".force-item-name");
  if (nameBtn) {
    openForceEditor(Number(nameBtn.dataset.i));
    return;
  }
  const btn = target.closest<HTMLElement>(".force-remove");
  if (!btn) return;
  force.splice(Number(btn.dataset.i), 1);
  exitForceEditor(); // indices shifted — close the editor to avoid a stale target
  saveForce();
  renderForce();
});
// ---- Force management: switch / new / rename / delete / export / import / share

$("force-pick").addEventListener("change", (e) =>
  setActiveForce(Number((e.target as HTMLSelectElement).value)),
);
$("force-new").addEventListener("click", newForce);
$("force-rename").addEventListener("click", renameForce);
$("force-delete").addEventListener("click", deleteForce);

/** Trigger a browser download of an object as pretty JSON. */
function downloadJson(filename: string, obj: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("force-export").addEventListener("click", () => {
  const f = forces[activeForce]!;
  downloadJson(`${(f.name.replace(/[^\w.-]+/g, "_") || "force")}.json`, { name: f.name, units: f.units });
});

/** Add a parsed force object (or bare units array) as a new active force. */
function importForceObj(obj: unknown): void {
  const o = obj as { name?: unknown; units?: unknown };
  const units = (Array.isArray(o?.units) ? o.units : Array.isArray(obj) ? obj : null) as ForceUnit[] | null;
  if (!units || !units.every((u) => u && typeof u.text === "string")) {
    alert("That doesn't look like a valid force file.");
    return;
  }
  forces.push({ name: String(o?.name ?? "Imported Force"), units });
  setActiveForce(forces.length - 1);
}
$("force-import").addEventListener("click", () => $("force-import-file").click());
$("force-import-file").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    try {
      importForceObj(JSON.parse(await file.text()));
    } catch {
      alert("Could not read that force file.");
    }
  }
  input.value = "";
});

// Share link: the active force, gzip-compressed (raw fallback) into the URL hash.
const toB64url = (b: Uint8Array): string =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
async function gzip(str: string): Promise<Uint8Array> {
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
$("force-share").addEventListener("click", () => {
  void (async () => {
    const f = forces[activeForce]!;
    const json = JSON.stringify({ name: f.name, units: f.units });
    let payload: string;
    try {
      payload = "g" + toB64url(await gzip(json)); // 'g' = gzip
    } catch {
      payload = "r" + toB64url(new TextEncoder().encode(json)); // 'r' = raw (no CompressionStream)
    }
    const url = `${location.origin}${location.pathname}#f=${payload}`;
    try {
      await navigator.clipboard.writeText(url);
      alert("Share link copied to clipboard.");
    } catch {
      prompt("Copy this share link:", url);
    }
  })();
});

/** Decode a `f=…` share payload into a force object (gzip 'g' or raw 'r' prefix). */
async function decodeForcePayload(payload: string): Promise<{ name: string; units: ForceUnit[] } | null> {
  try {
    const bytes = fromB64url(payload.slice(1));
    const json = payload[0] === "g" ? await gunzip(bytes) : new TextDecoder().decode(bytes);
    const o = JSON.parse(json) as { name?: unknown; units?: unknown };
    const units = (Array.isArray(o?.units) ? o.units : Array.isArray(o) ? o : null) as ForceUnit[] | null;
    if (!units || !units.every((u) => u && typeof u.text === "string")) return null;
    return { name: String(o?.name ?? "Imported Force"), units };
  } catch {
    return null;
  }
}

/** Import a force from a #f=… share link, then strip it from the URL. */
async function importFromHash(): Promise<void> {
  const m = location.hash.match(/[#&]f=([^&]+)/);
  if (!m) return;
  const decoded = await decodeForcePayload(m[1]!);
  if (decoded) {
    forces.push({ name: decoded.name, units: decoded.units });
    setActiveForce(forces.length - 1);
  }
  history.replaceState(null, "", location.pathname + location.search);
}

// Set only while playing a battle opened from an OVERRIDE GM Tool handoff. Its
// presence is what surfaces the "Send result to campaign" action; the handoffId
// is echoed back so the campaign can match the BattleResult to its engagement,
// and the side ids let the tracker name a victor.
let handoffContext: { handoffId: string; youSideId?: string; foeSideId?: string } | null = null;
// The campaign's tabletop setup for this battle (entry edges, initiative, posture,
// off-board support, special rules) — rendered as the briefing panel. Null off a handoff.
let handoffBriefing: HandoffRoster | null = null;

/**
 * Load a battle directly from an OVERRIDE GM Tool handoff (#h=… hash). The
 * campaign emits a compact per-side roster (model names + pilot skills); we
 * resolve each model against the bundled library, build both forces, and drop
 * straight into the interactive battle tracker. Unresolved models are skipped
 * and surfaced to the GM rather than failing the whole battle.
 */
async function importHandoffFromHash(): Promise<void> {
  const m = location.hash.match(/[#&]h=([^&]+)/);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search);

  let roster: HandoffRoster | null = null;
  try {
    const payload = m[1]!;
    const bytes = fromB64url(payload.slice(1));
    const json = payload[0] === "g" ? await gunzip(bytes) : new TextDecoder().decode(bytes);
    roster = JSON.parse(json) as HandoffRoster;
  } catch {
    roster = null;
  }
  if (!roster || !Array.isArray(roster.sides) || roster.sides.length === 0) {
    alert("This battle link is malformed.");
    return;
  }

  const index = (await loadUnitsIndex()) ?? [];
  const byName = buildNameIndex(index);

  const warnings: string[] = [];
  const builtSides: { name: string; units: ForceUnit[] }[] = [];
  for (const side of roster.sides) {
    const units: ForceUnit[] = [];
    for (const ru of side.units ?? []) {
      const hit = resolveModel(ru.model, byName);
      if (!hit) {
        warnings.push(`${side.name}: “${ru.model}” — no library match, skipped`);
        continue;
      }
      try {
        const resp = await fetch(`./units/${hit.path}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        units.push({
          name: ru.name || hit.name,
          text,
          file: hit.path,
          ...(ru.gunnery !== undefined ? { gunnery: ru.gunnery } : {}),
          ...(ru.piloting !== undefined ? { piloting: ru.piloting } : {}),
          ...(ru.unitId ? { campaignUnitId: ru.unitId } : {}),
          ...(ru.pilotIds ? { campaignPilotIds: ru.pilotIds } : {}),
        });
      } catch (err) {
        warnings.push(
          `${side.name}: “${ru.model}” — load failed (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }
    builtSides.push({ name: side.name, units });
  }

  if (builtSides.every((s) => s.units.length === 0)) {
    alert("Battle received, but none of its units matched the bundled library.");
    return;
  }

  const you = builtSides[0]!;
  const foe = builtSides[1] ?? { name: "Enemy Force", units: [] };
  // Two transient battle copies (deep-cloned), exactly like startBattle().
  forces.push(
    { name: you.name, units: structuredClone(you.units), battle: "you" },
    { name: foe.name, units: structuredClone(foe.units), battle: "foe" },
  );
  myRole = "host";
  handoffContext = roster.handoffId
    ? { handoffId: roster.handoffId, youSideId: roster.sides[0]?.sideId, foeSideId: roster.sides[1]?.sideId }
    : null;
  handoffBriefing = roster;
  resetInit(); // a handoff always opens a fresh battle at round 1
  saveForce();
  enterBattle();

  if (warnings.length) {
    const note =
      `<div class="bt-handoff-warn"><strong>Battle loaded from the campaign.</strong> ` +
      `${warnings.length} unit(s) had no library match and were skipped:` +
      `<ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>`;
    output.innerHTML = note + output.innerHTML;
  }
}

/**
 * Post the played-out battle back to the campaign as a BattleResult (the return
 * leg of the handoff loop). Only available when the battle was opened from a
 * handoff; the campaign server that served /battle also owns /api/gm/battle-result,
 * so this is a same-origin call. The GM confirms an inferred summary first.
 */
async function sendResultToCampaign(): Promise<void> {
  if (!handoffContext) return;
  const you = forces[battleIdx("you")];
  const foe = forces[battleIdx("foe")];
  if (!you || !foe) return;

  const payload = battleResultFromForces({
    handoffId: handoffContext.handoffId,
    you: { sideId: handoffContext.youSideId, units: you.units },
    foe: { sideId: handoffContext.foeSideId, units: foe.units },
    turnsElapsed: battleInit.round,
  });
  if (payload.unitOutcomes.length === 0) {
    alert("No campaign units in this battle to report on.");
    return;
  }
  const dead = payload.unitOutcomes.filter((o) => o.damage === "DESTROYED").length;
  const victor = payload.victorSideId
    ? payload.victorSideId === handoffContext.youSideId ? you.name : foe.name
    : "no clear victor (GM decides)";
  if (!confirm(
    `Send this result to the campaign?\n\n` +
    `Victor: ${victor}\nUnits destroyed: ${dead} of ${payload.unitOutcomes.length}\n` +
    `Rounds: ${payload.turnsElapsed}\n\n` +
    `This ingests into the campaign and freezes the outcome.`,
  )) return;

  try {
    const resp = await fetch("/api/gm/battle-result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await resp.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
    if (resp.ok && body.ok !== false) {
      handoffContext = null; // resolved — don't offer to send again
      renderBattle();
      alert("Result sent — the campaign engagement is resolved. You can keep the table up or End battle.");
    } else {
      alert("The campaign refused the result: " + (body.reason ?? `HTTP ${resp.status}`));
    }
  } catch (err) {
    alert("Couldn't reach the campaign server: " + (err instanceof Error ? err.message : String(err)));
  }
}

// ---- Battle tracker -------------------------------------------------------
// A battle is two temporary, marked SavedForces (deep copies, so your real
// roster stays undamaged): your force + an enemy decoded from a share link. The
// existing per-unit tracker (setActiveForce + openForceEditor) drives damage.
function inBattle(): boolean { return forces.some((f) => f.battle); }
function battleIdx(side: "you" | "foe"): number { return forces.findIndex((f) => f.battle === side); }

// --- Live multiplayer (Supabase Realtime). The backend is baked into the app
// (see mp-config.ts), so online battle works for anyone who opens the site with
// zero setup. A "room" is just a shared channel name (the room code). There is
// no server-side state: the two players exchange their forces peer-to-peer via
// a "hello" message, and relay per-unit damage. Each player's local "you" is
// their role; "foe" is the other role, so damage stays consistent on both ends.
type Role = "host" | "guest";
type MpMsg = {
  type?: string;
  role?: Role;
  reply?: boolean;
  idx?: number;
  damage?: unknown;
  force?: { name: string; units: ForceUnit[] };
  round?: number;
  value?: number;
  roll?: { host: number | null; guest: number | null };
  bonus?: { host: number; guest: number };
  acted?: string[];
  key?: string;
  on?: boolean;
  phase?: Phase;
  mode?: MoveMode;
  moves?: Record<string, MoveMode>;
};
let myRole: Role = "host"; // your side; "host" for a solo battle
let mpClient: RealtimeClient | null = null;
let mpChannel: RealtimeChannel | null = null;
let mpInfo: { room: string; role: Role } | null = null;
let mpStatus: "off" | "connecting" | "online" | "offline" = "off";
let mpPresence = 0;
let applyingRemote = false; // guard so applying a remote change doesn't re-broadcast (no echo loop)
const otherRole = (): Role => (myRole === "host" ? "guest" : "host");
const MP_KEY = "mtf2override.battleMp";

function mpSend(o: MpMsg): void {
  void mpChannel?.send({ type: "broadcast", event: "msg", payload: o });
}
function mpRoomLink(): string {
  return mpInfo ? `${location.origin}${location.pathname}#battle=${mpInfo.room}` : "";
}
function mpMyForce(): { name: string; units: ForceUnit[] } | null {
  const you = forces[battleIdx("you")];
  return you ? { name: you.name, units: you.units } : null;
}
function mpSendHello(reply = false): void {
  const force = mpMyForce();
  if (force) mpSend({ type: "hello", role: myRole, reply, force });
}
function mpDisconnect(): void {
  mpInfo = null;
  mpStatus = "off";
  try { localStorage.removeItem(MP_KEY); } catch { /* ignore */ }
  if (mpChannel) { try { void mpChannel.unsubscribe(); } catch { /* ignore */ } mpChannel = null; }
  if (mpClient) { try { mpClient.disconnect(); } catch { /* ignore */ } mpClient = null; }
}
function mpConnect(room: string, role: Role): void {
  mpDisconnectTransport();
  myRole = role;
  mpInfo = { room, role };
  try { localStorage.setItem(MP_KEY, JSON.stringify(mpInfo)); } catch { /* ignore */ }
  mpStatus = "connecting";
  renderBattle();
  let client: RealtimeClient;
  try {
    const url = `${SUPABASE_URL.replace(/\/$/, "")}/realtime/v1`.replace(/^http/, "ws");
    client = new RealtimeClient(url, { params: { apikey: SUPABASE_ANON_KEY } });
    client.setAuth(SUPABASE_ANON_KEY); // authorize channel joins (anon role)
  } catch {
    mpStatus = "offline";
    renderBattle();
    return;
  }
  mpClient = client;
  const channel = client.channel(`battle-${room}`, {
    config: { broadcast: { self: false }, presence: { key: role } },
  });
  mpChannel = channel;
  channel.on("broadcast", { event: "msg" }, (e: { payload: MpMsg }) => mpHandle(e.payload));
  channel.on("presence", { event: "sync" }, () => {
    mpPresence = Object.keys(channel.presenceState()).length;
    renderBattle();
  });
  channel.subscribe((status: string) => {
    if (status === "SUBSCRIBED") {
      mpStatus = "online";
      void channel.track({ role });
      mpSendHello(); // announce my force; the opponent replies with theirs
      renderBattle();
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      mpStatus = "offline";
      renderBattle();
    }
  });
}
/** Tear down the socket without clearing mpInfo (used on reconnect). */
function mpDisconnectTransport(): void {
  if (mpChannel) { try { void mpChannel.unsubscribe(); } catch { /* ignore */ } mpChannel = null; }
  if (mpClient) { try { mpClient.disconnect(); } catch { /* ignore */ } mpClient = null; }
}
function mpHandle(m: MpMsg): void {
  if (initHandle(m)) return;
  if (m.type === "hello" && m.force) {
    // The other player (the foe) announced their force. Adopt it as the enemy.
    const foeI = battleIdx("foe");
    if (foeI >= 0 && Array.isArray(m.force.units)) {
      forces[foeI]!.name = m.force.name || "Enemy Force";
      forces[foeI]!.units = m.force.units;
      saveForce();
      renderBattle();
    }
    if (!m.reply) { mpSendHello(true); initSyncSend(); } // send mine back + current initiative
  } else if (m.type === "damage" && (m.role === "host" || m.role === "guest") && typeof m.idx === "number") {
    const side = m.role === myRole ? "you" : "foe";
    const u = forces[battleIdx(side)]?.units[m.idx];
    if (u) {
      applyingRemote = true;
      u.damage = m.damage as ForceUnit["damage"];
      saveForce();
      renderBattle();
      if (editingForceIdx === m.idx && forces[activeForce]?.battle === side) {
        applyDamageMarks();
        updateTabletop(); // refresh the heat dial / scale + to-hit on the open card
      }
      applyingRemote = false;
    }
  }
}
/** Broadcast a unit's current damage (role-keyed) after a local change. */
function mpBroadcast(side: "you" | "foe", idx: number, u: ForceUnit): void {
  if (!mpChannel || mpStatus !== "online" || applyingRemote) return;
  mpSend({ type: "damage", role: side === "you" ? myRole : otherRole(), idx, damage: u.damage });
}

// --- Cinematic Initiative (BattleTech: Override). Each force rolls 2d6 + a
// bonus; high roll wins. Units then activate by TMM bracket (lowest first), and
// within each bracket the LOSER of initiative activates first, then the winner —
// matching the Override "Cinematic Initiative" rules. "Act early" is allowed
// (any of your un-acted units may activate). Optional "Modified Reactions"
// lowers a unit's bracket by its condition-monitor + critical hits.
type MoveMode = "still" | "walk" | "sprint" | "jump";
type Phase = "move" | "combat" | "end";
/** A unit's cumulative damage totals, snapshotted at round start to spot what it
 * took this round (for end-phase falling checks). */
interface DmgSnap { d: number; g: number; l: number; c: number }
interface BattleInit {
  round: number;
  phase: Phase; // each round runs movement → combat → end sub-rounds
  roll: { host: number | null; guest: number | null }; // raw 2d6 per side
  bonus: { host: number; guest: number }; // initiative bonus added to the roll
  acted: string[]; // unit keys activated THIS phase ("host:0", "guest:2", …)
  moves: Record<string, MoveMode>; // unit key → chosen movement (sets its TMM), reset each round
  modReactions: boolean; // optional rule toggle
  snap?: Record<string, DmgSnap>; // per-unit damage at round start (end-phase delta baseline)
}
const INIT_KEY = "mtf2override.battleInit";
const freshInit = (): BattleInit => ({
  round: 1,
  phase: "move",
  roll: { host: null, guest: null },
  bonus: { host: 0, guest: 0 },
  acted: [],
  moves: {},
  modReactions: false,
});
let battleInit: BattleInit = freshInit();
interface UnitCardInfo { tmm: number; tmmSprint: number; jumpTmm: number; walk: number; jump: number; move: string }
/** TMM for a chosen movement mode (leg actuators cut walk/sprint, not jump/still). */
function modeTmm(info: UnitCardInfo, legHits: number, mode: MoveMode): number {
  if (mode === "still") return 0;
  if (mode === "jump") return info.jumpTmm;
  if (mode === "sprint") return Math.max(0, info.tmmSprint - legHits);
  return Math.max(0, info.tmm - legHits); // walk
}
/** Movement distance label for a chosen mode (walk cut by 2/hit; run = walk×1.5). */
function modeMoveText(info: UnitCardInfo, legHits: number, mode: MoveMode): string {
  const w = Math.max(0, info.walk - 2 * legHits);
  if (mode === "still") return "still 0";
  if (mode === "jump") return `jump ${info.jump}`;
  if (mode === "sprint") return `sprint ${Math.ceil(w * 1.5)}`;
  return `walk ${w}`;
}
const tmmCache = new Map<string, UnitCardInfo>();
const roll2d6 = (): number => 2 + Math.floor(Math.random() * 6) + Math.floor(Math.random() * 6);
/** Side total = raw 2d6 + bonus (null until that side has rolled). */
const initTotal = (r: Role): number | null => (battleInit.roll[r] == null ? null : battleInit.roll[r]! + battleInit.bonus[r]);
/** "you"/"foe" → the owning role key (consistent across both clients). */
const sideRole = (side: "you" | "foe"): Role => (side === "you" ? myRole : otherRole());
const unitKey = (side: "you" | "foe", idx: number): string => `${sideRole(side)}:${idx}`;
/** Movement + TMM for a unit (memoised — convertOne parses the source text). */
function unitCardInfo(u: ForceUnit): UnitCardInfo {
  const key = `${u.name}|${u.file ?? ""}`;
  const hit = tmmCache.get(key);
  if (hit) return hit;
  let info: UnitCardInfo = { tmm: 0, tmmSprint: 1, jumpTmm: 0, walk: 0, jump: 0, move: "—" };
  try {
    const r = convertOne(u.text, u.file ?? u.name);
    if (r.ok) {
      const c = r.result.card as { tmm?: number; tmmSprint?: number; move?: string; jump?: number; tmmJump?: number; walkMove?: number; runMove?: number; cruiseMP?: number };
      const tmm = c.tmm ?? 0;
      // Mechs print walk/run/jump explicitly; other kinds use their move string.
      const move =
        r.result.kind === "mech" && c.walkMove != null
          ? `${c.walkMove}/${c.runMove}${(c.jump ?? 0) > 0 ? `/${c.jump}j` : ""}`
          : (c.move ?? "—");
      info = { tmm, tmmSprint: c.tmmSprint ?? tmm + 1, jumpTmm: c.tmmJump ?? 0, walk: c.walkMove ?? c.cruiseMP ?? 0, jump: c.jump ?? 0, move };
    }
  } catch { /* ignore */ }
  tmmCache.set(key, info);
  return info;
}
const unitTmm = (u: ForceUnit): number => unitCardInfo(u).tmm;
/** Activation bracket: base TMM, lowered by damage when Modified Reactions is on. */
function unitBracket(u: ForceUnit): number {
  let t = unitTmm(u) - (u.damage?.legHits ?? 0); // leg actuators: −1 TMM each
  if (battleInit.modReactions) {
    const d = u.damage ?? {};
    t -= (d.condition ?? 0) + (d.engine ?? 0) + (d.gyro ?? 0) + (d.avionics ?? 0);
    t -= (d.heat ?? 0) >= 1 ? 1 : 0; // heat 1+: −1 TMM, slows reactions
  }
  return Math.max(0, t);
}
function saveInit(): void { try { localStorage.setItem(INIT_KEY, JSON.stringify(battleInit)); } catch { /* ignore */ } }
function loadInit(): void {
  try {
    const s = JSON.parse(localStorage.getItem(INIT_KEY) ?? "null") as Partial<BattleInit> | null;
    battleInit = s && typeof s.round === "number" ? { ...freshInit(), ...s } as BattleInit : freshInit();
  } catch { battleInit = freshInit(); }
}
function resetInit(): void { battleInit = freshInit(); saveInit(); }
/** Roll initiative. Online: roll my side only and broadcast; local: roll both. */
function initRoll(): void {
  if (mpInfo) {
    const v = roll2d6();
    battleInit.roll[myRole] = v;
    saveInit();
    mpSend({ type: "init-roll", role: myRole, round: battleInit.round, value: v });
  } else {
    battleInit.roll.host = roll2d6();
    battleInit.roll.guest = roll2d6();
    while (initTotal("host") === initTotal("guest")) battleInit.roll.guest = roll2d6();
    saveInit();
  }
  renderBattle();
}
/** Advance the sub-round: Movement → Combat (same initiative), or Combat → next
 * round (re-roll, reset movement choices). */
const PHASE_LABEL: Record<Phase, string> = { move: "Movement", combat: "Combat", end: "End" };
/** Button label for advancing OUT of the given phase. */
const nextPhaseLabel = (p: Phase): string => (p === "move" ? "Combat phase ▸" : p === "combat" ? "End phase ▸" : "Next round ▸");

// --- End phase: falling checks. A 'Mech that took 10+ damage this round, or a
// gyro hit, or a leg-actuator hit must make a Piloting check or fall.
const kindCache = new Map<string, string>();
function unitKind(u: ForceUnit): string {
  let k = kindCache.get(u.text);
  if (k === undefined) {
    try { const r = convertOne(u.text, u.file ?? u.name); k = r.ok ? r.result.kind : "?"; }
    catch { k = "?"; }
    kindCache.set(u.text, k);
  }
  return k;
}
/** Total location damage a unit has taken (armor + structure pips), summing both
 * the SVG dolls' per-location `loc` and the grid doll's per-group `groups`. */
function unitDamageTotal(u: ForceUnit): number {
  const d = u.damage;
  if (!d) return 0;
  const sum = (o?: Record<string, number>) => (o ? Object.values(o).reduce((a, b) => a + b, 0) : 0);
  return sum(d.loc) + sum(d.groups);
}
const unitDmgSnap = (u: ForceUnit): DmgSnap => ({ d: unitDamageTotal(u), g: u.damage?.gyro ?? 0, l: u.damage?.legHits ?? 0, c: u.damage?.condition ?? 0 });
/** Capture every unit's cumulative damage as the new round's baseline. */
function snapshotRoundDamage(): void {
  const snap: Record<string, DmgSnap> = {};
  for (const s of ["you", "foe"] as const) {
    const f = forces[battleIdx(s)];
    f?.units.forEach((u, idx) => { snap[unitKey(s, idx)] = unitDmgSnap(u); });
  }
  battleInit.snap = snap;
}
/** Consciousness-roll target numbers by pilot-hit count (1st hit … 5th hit). */
const CONSCIOUSNESS_TN = ["3+", "5+", "7+", "9+", "11+"];
/** End-phase checks per 'Mech: a falling (Piloting) check when it took 10+ damage
 * / a gyro hit / a leg-actuator hit this round, and a consciousness check when
 * its pilot took a hit this round. */
function endPhaseChecks(): Array<{ side: "you" | "foe"; name: string; checks: string[] }> {
  const base = battleInit.snap ?? {};
  const out: Array<{ side: "you" | "foe"; name: string; checks: string[] }> = [];
  for (const s of ["you", "foe"] as const) {
    const f = forces[battleIdx(s)];
    f?.units.forEach((u, idx) => {
      if (u.damage?.out || unitKind(u) !== "mech") return;
      const b = base[unitKey(s, idx)] ?? unitDmgSnap(u); // no baseline → no delta (no false alarm)
      const checks: string[] = [];
      // Falling (Piloting) check.
      const fall: string[] = [];
      const dDelta = unitDamageTotal(u) - b.d;
      const gDelta = (u.damage?.gyro ?? 0) - b.g;
      const lDelta = (u.damage?.legHits ?? 0) - b.l;
      if (dDelta >= 10) fall.push(`${dDelta} damage`);
      if (gDelta > 0) fall.push(gDelta > 1 ? `${gDelta} gyro hits` : "gyro hit");
      if (lDelta > 0) fall.push(lDelta > 1 ? `${lDelta} actuator hits` : "leg actuator hit");
      if (fall.length) checks.push(`Falling check (Piloting) — ${fall.join(", ")}`);
      // Consciousness check — pilot took a hit this round (not yet KIA).
      const c = u.damage?.condition ?? 0;
      if (c > b.c && c >= 1 && c <= CONSCIOUSNESS_TN.length) {
        const hits = c - b.c;
        checks.push(`Consciousness check (${CONSCIOUSNESS_TN[c - 1]}) — ${hits > 1 ? `${hits} pilot hits` : "pilot hit"}`);
      }
      if (checks.length) out.push({ side: s, name: u.name, checks });
    });
  }
  return out;
}
function endPhasePanel(): string {
  const items = endPhaseChecks();
  const body = items.length === 0
    ? `<p class="muted">No checks required this round.</p>`
    : items
        .map((it) => `<div class="bt-fall bt-act-${it.side}"><span class="bt-fall-name">⚠ ${esc(it.name)}</span><span class="bt-fall-why">${it.checks.map((c) => esc(c)).join(" · ")}</span></div>`)
        .join("");
  return `<div class="bt-activation bt-endphase">
      <div class="bt-act-head"><b>End phase</b> <span class="bt-phase bt-phase-end">End</span><span class="muted">falling &amp; consciousness checks</span></div>
      ${body}
    </div>`;
}

function initAdvance(): void {
  if (battleInit.phase === "move") {
    battleInit = { ...battleInit, phase: "combat", acted: [] }; // keep roll + moves into combat
  } else if (battleInit.phase === "combat") {
    battleInit = { ...battleInit, phase: "end", acted: [] }; // end phase: falling checks
  } else {
    battleInit = { ...battleInit, round: battleInit.round + 1, phase: "move", roll: { host: null, guest: null }, acted: [], moves: {} };
    snapshotRoundDamage(); // new round → reset the falling-check damage baseline
  }
  saveInit();
  if (mpInfo) mpSend({ type: "init-advance", round: battleInit.round, phase: battleInit.phase });
  renderBattle();
}
/** Set a unit's chosen movement for the round (sets its displayed TMM). */
function initSetMove(key: string, mode: MoveMode): void {
  battleInit.moves[key] = mode;
  saveInit();
  if (mpInfo) mpSend({ type: "init-move", key, mode });
  renderBattle();
}
/** Cancel a unit's orders: clear its chosen movement AND its activation, so it
 * can be re-ordered this round (sent a new direction). */
function initCancelOrder(key: string): void {
  delete battleInit.moves[key];
  const i = battleInit.acted.indexOf(key);
  if (i >= 0) battleInit.acted.splice(i, 1);
  saveInit();
  if (mpInfo) mpSend({ type: "init-cancel", key });
  renderBattle();
}
/** Adjust the initiative bonus for a side I control (±). */
function initSetBonus(role: Role, delta: number): void {
  battleInit.bonus[role] = Math.max(-5, Math.min(5, battleInit.bonus[role] + delta));
  saveInit();
  if (mpInfo) mpSend({ type: "init-bonus", role, value: battleInit.bonus[role] });
  renderBattle();
}
function initToggleMod(): void {
  battleInit.modReactions = !battleInit.modReactions;
  saveInit();
  if (mpInfo) mpSend({ type: "init-mod", on: battleInit.modReactions });
  renderBattle();
}
/** Mark a unit activated / un-activated this round. */
function initToggleActed(key: string): void {
  const i = battleInit.acted.indexOf(key);
  if (i >= 0) battleInit.acted.splice(i, 1);
  else battleInit.acted.push(key);
  saveInit();
  if (mpInfo) mpSend({ type: "init-act", key, on: i < 0 });
  renderBattle();
}
/** Send a full initiative snapshot (so a late joiner syncs everything). */
function initSyncSend(): void {
  if (mpInfo) mpSend({
    type: "init-sync",
    round: battleInit.round,
    phase: battleInit.phase,
    roll: battleInit.roll,
    bonus: battleInit.bonus,
    acted: battleInit.acted,
    moves: battleInit.moves,
    on: battleInit.modReactions,
  });
}
/** Handle an incoming initiative message. Returns true if it was one. */
function initHandle(m: MpMsg): boolean {
  if (m.type === "init-roll" && (m.role === "host" || m.role === "guest") && typeof m.value === "number") {
    if (typeof m.round === "number" && m.round > battleInit.round) { battleInit = { ...freshInit(), round: m.round, bonus: battleInit.bonus, modReactions: battleInit.modReactions }; snapshotRoundDamage(); }
    battleInit.roll[m.role] = m.value;
    saveInit();
    renderBattle();
    return true;
  }
  if (m.type === "init-advance" && typeof m.round === "number" && (m.phase === "move" || m.phase === "combat" || m.phase === "end")) {
    battleInit.round = m.round;
    battleInit.phase = m.phase;
    battleInit.acted = [];
    if (m.phase === "move") { battleInit.roll = { host: null, guest: null }; battleInit.moves = {}; snapshotRoundDamage(); } // new round
    saveInit();
    renderBattle();
    return true;
  }
  if (m.type === "init-move" && typeof m.key === "string" && m.mode) {
    battleInit.moves[m.key] = m.mode;
    saveInit();
    renderBattle();
    return true;
  }
  if (m.type === "init-cancel" && typeof m.key === "string") {
    delete battleInit.moves[m.key];
    const i = battleInit.acted.indexOf(m.key);
    if (i >= 0) battleInit.acted.splice(i, 1);
    saveInit();
    renderBattle();
    return true;
  }
  if (m.type === "init-bonus" && (m.role === "host" || m.role === "guest") && typeof m.value === "number") {
    battleInit.bonus[m.role] = m.value;
    saveInit();
    renderBattle();
    return true;
  }
  if (m.type === "init-mod" && typeof m.on === "boolean") {
    battleInit.modReactions = m.on;
    saveInit();
    renderBattle();
    return true;
  }
  if (m.type === "init-act" && typeof m.key === "string") {
    const i = battleInit.acted.indexOf(m.key);
    if (m.on && i < 0) battleInit.acted.push(m.key);
    else if (!m.on && i >= 0) battleInit.acted.splice(i, 1);
    saveInit();
    renderBattle();
    return true;
  }
  if (m.type === "init-sync" && typeof m.round === "number" && m.roll) {
    if (m.round >= battleInit.round) {
      battleInit.round = m.round;
      if (m.roll.host != null) battleInit.roll.host = m.roll.host;
      if (m.roll.guest != null) battleInit.roll.guest = m.roll.guest;
      if (m.bonus) battleInit.bonus = m.bonus;
      if (Array.isArray(m.acted)) battleInit.acted = m.acted;
      if (typeof m.on === "boolean") battleInit.modReactions = m.on;
      if (m.phase === "move" || m.phase === "combat" || m.phase === "end") battleInit.phase = m.phase;
      if (m.moves) battleInit.moves = m.moves;
      saveInit();
      renderBattle();
    }
    return true;
  }
  return false;
}
const payloadFromUrl = (s: string): string => s.match(/[#?&]f=([^&\s]+)/)?.[1] ?? s.trim();
/** True if the unit has any tracked damage (ignoring the "out" flag). */
function isDamaged(u: ForceUnit): boolean {
  const d = u.damage;
  if (!d) return false;
  return (["groups", "loc", "condition", "engine", "gyro", "avionics", "legHits", "tics", "heat", "ammo"] as const).some((k) => {
    const v = d[k];
    return v != null && (typeof v !== "object" || Object.keys(v).length > 0);
  });
}

let battleMode: "local" | "host" | "join" = "local";
const BATTLE_HINTS: Record<typeof battleMode, string> = {
  local: "Track your own force; optionally paste an opponent's “Copy link” to load their force as the enemy. Offline.",
  host: "Live game: pick your force and Start, then send the room link to your opponent. They join, and you both see the same battle in real time.",
  join: "Live game: paste the room link your opponent sent, pick your force, and Start.",
};
function setBattleMode(mode: typeof battleMode): void {
  battleMode = mode;
  document.querySelectorAll<HTMLElement>(".bt-mode").forEach((b) => b.classList.toggle("is-on", b.dataset.mode === mode));
  const show = (sel: string, on: boolean) => document.querySelector<HTMLElement>(sel)?.toggleAttribute("hidden", !on);
  show(".bt-when-local", mode === "local");
  show(".bt-when-join", mode === "join");
  const hint = document.getElementById("battle-hint");
  if (hint) {
    hint.textContent =
      mode !== "local" && !MP_CONFIGURED
        ? "Online play isn't configured for this site yet."
        : BATTLE_HINTS[mode];
  }
}
function openBattleSetup(): void {
  if (forces.every((f) => f.units.length === 0)) {
    alert("Build or pick a force first, then start a battle.");
    return;
  }
  const sel = document.getElementById("battle-your") as HTMLSelectElement | null;
  if (sel) {
    sel.innerHTML = forces
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => !f.battle && f.units.length > 0)
      .map(({ f, i }) => `<option value="${i}"${i === activeForce ? " selected" : ""}>${esc(f.name)} (${f.units.length})</option>`)
      .join("");
  }
  const url = document.getElementById("battle-foe-url") as HTMLInputElement | null;
  if (url) url.value = "";
  const room = document.getElementById("battle-room") as HTMLInputElement | null;
  if (room) room.value = "";
  setBattleMode("local");
  document.getElementById("battle-setup")?.removeAttribute("hidden");
}
async function startBattle(): Promise<void> {
  const your = forces[Number((document.getElementById("battle-your") as HTMLSelectElement | null)?.value)];
  if (!your) return;
  const online = battleMode !== "local";
  let room = "";
  if (online) {
    if (!MP_CONFIGURED) { alert("Online play isn't set up for this site yet."); return; }
    if (battleMode === "join") {
      const raw = (document.getElementById("battle-room") as HTMLInputElement | null)?.value.trim() ?? "";
      room = raw.match(/[#?&]battle=([^&\s]+)/)?.[1] ?? raw;
      if (!room) { alert("Paste the room link/code your opponent sent."); return; }
    } else {
      room = Math.random().toString(36).slice(2, 8);
    }
  }
  let foe: { name: string; units: ForceUnit[] } | null = null;
  if (battleMode === "local") {
    const raw = (document.getElementById("battle-foe-url") as HTMLInputElement | null)?.value.trim();
    if (raw) {
      foe = await decodeForcePayload(payloadFromUrl(raw));
      if (!foe) { alert("Couldn't read that enemy force link."); return; }
    }
  }
  forces.push(
    { name: your.name, units: structuredClone(your.units), battle: "you" },
    { name: foe?.name ?? (online ? "Waiting for opponent…" : "Enemy Force"), units: foe ? structuredClone(foe.units) : [], battle: "foe" },
  );
  myRole = battleMode === "join" ? "guest" : "host";
  resetInit(); // new battle starts at round 1
  saveForce();
  document.getElementById("battle-setup")?.setAttribute("hidden", "");
  enterBattle();
  if (online) mpConnect(room, myRole);
}
function enterBattle(): void {
  document.body.classList.add("battle-mode");
  loadInit(); // restore the round/rolls (fresh battles were just reset above)
  exitForceEditor();
  renderBattle();
  output.innerHTML = `<p class="muted bt-prompt">Click a unit above to track its damage, heat, and ammo.</p>`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function endBattle(): void {
  if (!confirm("End the battle? This clears the battle copies (your saved forces are untouched).")) return;
  mpDisconnect();
  handoffContext = null;
  handoffBriefing = null;
  resetInit();
  forces = forces.filter((f) => !f.battle);
  if (forces.length === 0) forces.push({ name: "Force 1", units: [] });
  activeForce = Math.min(activeForce, forces.length - 1);
  force = forces[activeForce]!.units;
  saveForce();
  document.body.classList.remove("battle-mode");
  exitForceEditor();
  renderForce();
}
/** The campaign briefing panel: table, special rules, and each side's setup. */
function briefingHtml(): string {
  const b = handoffBriefing;
  if (!b) return "";
  const tableLabel = b.table ? `<span class="bt-brief-table">${esc(b.table)}</span>` : "";
  const sheets = b.mapSheets?.length
    ? `<div class="bt-brief-row"><span class="bt-brief-k">Map</span> ${esc(b.mapSheets.join(" · "))}${b.nodeName ? ` — ${esc(b.nodeName)}` : ""}</div>`
    : "";
  const rules = b.specialRules?.length
    ? `<div class="bt-brief-row"><span class="bt-brief-k">Special</span> ${b.specialRules.map((r) => `<span class="bt-brief-rule">${esc(r)}</span>`).join(" ")}</div>`
    : "";
  const sides = b.sides
    .map((side) => {
      const notes = setupNotes(side);
      const air = side.units.map(airEntryNote).filter(Boolean);
      const airLine = air.length ? `<div class="bt-brief-air">${esc(air.join("  |  "))}</div>` : "";
      const noteHtml = notes.length
        ? `<ul class="bt-brief-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
        : `<p class="muted">No special setup.</p>`;
      return `<div class="bt-brief-side"><h4>${esc(side.name)}</h4>${noteHtml}${airLine}</div>`;
    })
    .join("");
  return `<details class="bt-briefing" open>
      <summary>📋 Campaign briefing ${tableLabel}</summary>
      ${sheets}${rules}
      <div class="bt-brief-sides">${sides}</div>
    </details>`;
}

/** Render the two-side battle rosters into #battle. */
function renderBattle(): void {
  const cont = document.getElementById("battle");
  if (!cont) return;
  const youI = battleIdx("you");
  const foeI = battleIdx("foe");
  const you = forces[youI];
  const foe = forces[foeI];
  if (!you || !foe) {
    document.body.classList.remove("battle-mode");
    return;
  }
  if (!battleInit.snap) { snapshotRoundDamage(); saveInit(); } // baseline for round-1 falling checks
  const actedSet = new Set(battleInit.acted);
  const iControl = (s: "you" | "foe"): boolean => !mpInfo || s === "you";
  const side = (f: SavedForce, fIdx: number, label: string): string => {
    const sStr = f.battle as "you" | "foe";
    let live = 0;
    const chip = (u: ForceUnit, i: number): string => {
      const bv = unitBv(u);
      if (bv && !u.damage?.out) live += bv;
      const cls = u.damage?.out ? "ko" : isDamaged(u) ? "hit" : "ok";
      const active = activeForce === fIdx && editingForceIdx === i;
      const acted = actedSet.has(unitKey(sStr, i));
      return `<div class="bt-unit${u.damage?.out ? " bt-out" : ""}${active ? " bt-active" : ""}${acted ? " bt-acted" : ""}">
          <span class="bt-dot bt-${cls}"></span>
          <button class="bt-track" type="button" data-f="${fIdx}" data-i="${i}">${esc(u.name)}</button>
          ${acted ? '<span class="bt-acted-tag" title="Activated this round">✓</span>' : ""}
          ${bv ? `<span class="bt-bv">${bv.toLocaleString()}</span>` : ""}
          <button class="bt-kill" type="button" data-f="${fIdx}" data-ko="${i}" title="Mark out of action / revive" aria-label="Toggle out of action">💀</button>
        </div>`;
    };
    const fLances: string[] = [];
    for (const u of f.units) if (u.lance && !fLances.includes(u.lance)) fLances.push(u.lance);
    const body =
      fLances.length === 0
        ? f.units.map((u, i) => chip(u, i)).join("")
        : [...fLances, ""]
            .map((lance) => {
              const members = f.units.map((u, i) => ({ u, i })).filter(({ u }) => (u.lance ?? "") === lance);
              if (members.length === 0) return "";
              return `<div class="bt-lance-h">${lance ? esc(lance) : "Unassigned"}</div>` + members.map(({ u, i }) => chip(u, i)).join("");
            })
            .join("");
    const empty = mpInfo ? '<p class="muted">Waiting for opponent to join…</p>' : '<p class="muted">No units.</p>';
    return `<div class="bt-side">
      <div class="bt-side-h"><b>${esc(f.name)}</b><span class="muted">${label} · ${live.toLocaleString()} BV live</span></div>
      <div class="bt-units">${body || empty}</div>
    </div>`;
  };
  const conn = mpInfo
    ? `<span class="bt-conn bt-conn-${mpStatus}">${mpStatus === "online" ? `● ${mpPresence} online` : mpStatus === "connecting" ? "● connecting…" : "● offline"}</span>` +
      (myRole === "host" ? `<button id="bt-copylink" type="button">Copy room link</button>` : "")
    : "";

  // --- Initiative strip: round, per-side 2d6 + bonus, winner, mod-reactions.
  const youRole = myRole;
  const foeRole = otherRole();
  const youName = mpInfo ? "You" : esc(you.name);
  const foeName = mpInfo ? "Opponent" : esc(foe.name);
  const youTot = initTotal(youRole);
  const foeTot = initTotal(foeRole);
  const rolled = youTot != null && foeTot != null;
  const tie = rolled && youTot === foeTot;
  const youWin = rolled && youTot! > foeTot!;
  const foeWin = rolled && foeTot! > youTot!;
  const rollChip = (s: "you" | "foe", label: string, role: Role, total: number | null, win: boolean): string => {
    const raw = battleInit.roll[role];
    const bonus = battleInit.bonus[role];
    const big = raw == null ? "—" : String(total);
    const sub = raw != null && bonus !== 0 ? ` <span class="muted">(${raw}${bonus >= 0 ? "+" : ""}${bonus})</span>` : "";
    const ctl = iControl(s)
      ? `<span class="bt-bonus" title="Initiative bonus"><button class="bt-bonus-btn" type="button" data-bonus-role="${role}" data-delta="-1">−</button><span class="bt-bonus-v">${bonus >= 0 ? "+" : ""}${bonus}</span><button class="bt-bonus-btn" type="button" data-bonus-role="${role}" data-delta="1">＋</button></span>`
      : bonus !== 0
        ? `<span class="muted">bonus ${bonus >= 0 ? "+" : ""}${bonus}</span>`
        : "";
    return `<span class="bt-init-roll${win ? " is-win" : ""}">${label} <b>${big}</b>${sub}${ctl}</span>`;
  };
  let verdict = "";
  if (tie) verdict = `<span class="bt-init-tie">Tie — roll again</span>`;
  else if (rolled) verdict = `<span class="bt-init-win">🏆 ${youWin ? youName : foeName} wins</span><span class="muted">loser activates first</span>`;
  else if (mpInfo && (battleInit.roll[youRole] != null || battleInit.roll[foeRole] != null))
    verdict = `<span class="muted">waiting for ${battleInit.roll[youRole] == null ? "you" : "opponent"} to roll…</span>`;
  const modBtn = `<button id="bt-mod-react" type="button" class="bt-toggle${battleInit.modReactions ? " is-on" : ""}" title="Optional: lower a unit's activation bracket by its condition-monitor + critical hits">${battleInit.modReactions ? "☑" : "☐"} Modified reactions</button>`;
  const init = `<div class="bt-init">
      <span class="bt-init-round">Round ${battleInit.round} <span class="bt-phase bt-phase-${battleInit.phase}">${PHASE_LABEL[battleInit.phase]}</span></span>
      <button id="bt-roll-init" type="button">🎲 Roll initiative</button>
      ${rollChip("you", youName, youRole, youTot, youWin)}
      ${rollChip("foe", foeName, foeRole, foeTot, foeWin)}
      ${verdict}
      <span class="bt-spacer"></span>
      ${modBtn}
      <button id="bt-next-round" type="button">${nextPhaseLabel(battleInit.phase)}</button>
    </div>`;

  // --- End phase: falling checks. Otherwise the cinematic activation order.
  let activation = "";
  if (battleInit.phase === "end") {
    activation = endPhasePanel();
  } else if (rolled && !tie) {
    const loserSide: "you" | "foe" = youTot! < foeTot! ? "you" : "foe";
    const winnerSide: "you" | "foe" = loserSide === "you" ? "foe" : "you";
    type ActU = { s: "you" | "foe"; key: string; name: string; bracket: number; info: UnitCardInfo; legHits: number };
    const collect = (f: SavedForce, s: "you" | "foe"): ActU[] =>
      f.units
        .map((u, idx) => ({ s, key: unitKey(s, idx), name: u.name, bracket: unitBracket(u), info: unitCardInfo(u), legHits: u.damage?.legHits ?? 0, out: u.damage?.out }))
        .filter((a) => !a.out)
        .map(({ s: ss, key, name, bracket, info, legHits }) => ({ s: ss, key, name, bracket, info, legHits }));
    const all = [...collect(you, "you"), ...collect(foe, "foe")];
    const brackets = [...new Set(all.map((a) => a.bracket))].sort((a, b) => a - b);
    const ordered: ActU[] = [];
    for (const b of brackets) {
      ordered.push(...all.filter((a) => a.s === loserSide && a.bracket === b));
      ordered.push(...all.filter((a) => a.s === winnerSide && a.bracket === b));
    }
    const nextUp = ordered.find((a) => !actedSet.has(a.key));
    const allActed = ordered.length > 0 && !nextUp;
    const MODES: ReadonlyArray<readonly [MoveMode, string, string]> = [["still", "Still", "St"], ["walk", "Walk", "Wk"], ["sprint", "Sprint", "Sp"], ["jump", "Jump", "Jp"]];
    const actChip = (a: ActU): string => {
      const acted = actedSet.has(a.key);
      const isNext = nextUp?.key === a.key;
      const mine = iControl(a.s);
      const chosen = battleInit.moves[a.key]; // undefined = no movement order given yet
      const mode: MoveMode = chosen ?? "walk"; // default preview for TMM / distance
      const tmm = modeTmm(a.info, a.legHits, mode);
      const hasOrder = chosen != null || acted;
      const modeBtns = MODES.filter(([mm]) => mm !== "jump" || a.info.jump > 0)
        .map(([mm, full, ab]) => {
          if (!mine) return chosen === mm ? `<span class="bt-mode-ro">${full}</span>` : "";
          return `<button class="bt-mode-btn${chosen === mm ? " on" : ""}" type="button" data-mkey="${a.key}" data-mode="${mm}" title="${full}">${ab}</button>`;
        })
        .join("");
      // Cancel orders: clear the chosen movement AND the activation, so the unit
      // can be re-ordered (sent a new direction). Only on units you control.
      const cancel = mine && hasOrder
        ? `<button class="bt-cancel-order" type="button" data-cancel-key="${a.key}" title="Cancel orders — clear this unit's movement and activation">↺</button>`
        : "";
      const noOrder = chosen == null && !acted ? ` <span class="muted">(no order)</span>` : "";
      const stat = `<span class="bt-act-stat">${esc(modeMoveText(a.info, a.legHits, mode))} · TMM ${tmm}${a.legHits ? ` <span class="bt-act-leg">leg −${a.legHits}</span>` : ""}${noOrder}</span>`;
      return `<div class="bt-act bt-act-${a.s}${acted ? " is-acted" : ""}${isNext ? " is-next" : ""}${hasOrder ? " has-order" : ""}">
        <button class="bt-act-mark" type="button" ${mine ? `data-act-key="${a.key}"` : "disabled"} title="${acted ? "Activated — click to undo" : mine ? "Mark activated" : "Opponent's unit"}"><span class="bt-act-name">${esc(a.name)}${acted ? " ✓" : ""}</span></button>
        ${stat}
        <div class="bt-modes">${modeBtns}${cancel}</div>
      </div>`;
    };
    const rows = brackets
      .map((b) => {
        const inB = [...all.filter((a) => a.s === loserSide && a.bracket === b), ...all.filter((a) => a.s === winnerSide && a.bracket === b)];
        return `<div class="bt-brk"><span class="bt-brk-h">TMM ${b}</span><div class="bt-brk-units">${inB.map(actChip).join("")}</div></div>`;
      })
      .join("");
    const phaseLabel = PHASE_LABEL[battleInit.phase];
    const nextLabel = nextPhaseLabel(battleInit.phase);
    const status = allActed
      ? `<span class="bt-init-win">${phaseLabel.toLowerCase()} done — ${nextLabel}</span>`
      : nextUp
        ? `<span class="muted">next: <b>${esc(nextUp.name)}</b> (${nextUp.s === loserSide ? "loser" : "winner"})</span>`
        : "";
    activation = `<div class="bt-activation">
      <div class="bt-act-head"><b>Activation order</b> <span class="bt-phase bt-phase-${battleInit.phase}">${phaseLabel}</span><span class="muted">lowest TMM first · loser first${battleInit.modReactions ? " · mod reactions" : ""}</span>${status}</div>
      ${rows || '<p class="muted">No active units.</p>'}
    </div>`;
  }

  cont.innerHTML = `<div class="bt-bar">
      <span class="bt-title">⚔ Battle</span>
      <span class="bt-vs">${esc(you.name)} <span class="muted">vs</span> ${esc(foe.name)}</span>
      ${conn}
      <span class="bt-spacer"></span>
      ${handoffContext ? `<button id="bt-send-campaign" type="button" class="primary" title="Post the played-out result back to the OVERRIDE GM Tool">⇧ Send result to campaign</button>` : ""}
      <button id="bt-end" type="button">End battle</button>
    </div>
    ${briefingHtml()}
    ${init}
    ${activation}
    <div class="bt-rosters">${side(you, youI, "Your force")}${side(foe, foeI, "Enemy")}</div>`;
}

document.getElementById("force-battle")?.addEventListener("click", openBattleSetup);
document.getElementById("battle-cancel")?.addEventListener("click", () => document.getElementById("battle-setup")?.setAttribute("hidden", ""));
document.getElementById("battle-start")?.addEventListener("click", () => void startBattle());
document.querySelectorAll<HTMLElement>(".bt-mode").forEach((b) =>
  b.addEventListener("click", () => setBattleMode((b.dataset.mode as typeof battleMode) ?? "local")),
);
document.getElementById("battle")?.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("#bt-end")) {
    endBattle();
    return;
  }
  if (t.closest("#bt-send-campaign")) {
    void sendResultToCampaign();
    return;
  }
  if (t.closest("#bt-roll-init")) {
    initRoll();
    return;
  }
  if (t.closest("#bt-next-round")) {
    initAdvance();
    return;
  }
  if (t.closest("#bt-mod-react")) {
    initToggleMod();
    return;
  }
  const bonus = t.closest<HTMLElement>(".bt-bonus-btn");
  if (bonus?.dataset.bonusRole) {
    initSetBonus(bonus.dataset.bonusRole as Role, Number(bonus.dataset.delta));
    return;
  }
  const cancelBtn = t.closest<HTMLElement>(".bt-cancel-order");
  if (cancelBtn?.dataset.cancelKey) {
    initCancelOrder(cancelBtn.dataset.cancelKey);
    return;
  }
  const modeBtn = t.closest<HTMLElement>(".bt-mode-btn");
  if (modeBtn?.dataset.mkey && modeBtn.dataset.mode) {
    initSetMove(modeBtn.dataset.mkey, modeBtn.dataset.mode as MoveMode);
    return;
  }
  const act = t.closest<HTMLElement>(".bt-act-mark");
  if (act?.dataset.actKey) {
    initToggleActed(act.dataset.actKey);
    return;
  }
  if (t.closest("#bt-copylink")) {
    const link = mpRoomLink();
    void navigator.clipboard?.writeText(link).then(
      () => alert("Room link copied — send it to your opponent."),
      () => prompt("Copy this room link:", link),
    );
    return;
  }
  const ko = t.closest<HTMLElement>(".bt-kill");
  if (ko?.dataset.ko != null) {
    const fIdx = Number(ko.dataset.f);
    const i = Number(ko.dataset.ko);
    const u = forces[fIdx]?.units[i];
    if (u) {
      u.damage = u.damage ?? {};
      u.damage.out = !u.damage.out;
      saveForce();
      renderBattle();
      const marker = forces[fIdx]?.battle;
      if (marker) mpBroadcast(marker, i, u);
    }
    return;
  }
  const tr = t.closest<HTMLElement>(".bt-track");
  if (tr?.dataset.i != null) {
    setActiveForce(Number(tr.dataset.f));
    openForceEditor(Number(tr.dataset.i));
    renderBattle(); // re-highlight the active chip + refresh live BV
  }
});

// ---- RAT weighted random force generator ----------------------------------
interface RatTable { name: string; type: string; weight: string; e: [number, number][] }
interface RatFaction { name: string; side: string; tables: RatTable[] }
interface RatSource { name: string; factions: RatFaction[] }
interface RatIndex { units: { p: string; n: string }[]; sources: RatSource[] }
let ratIndex: RatIndex | null = null;

const ratSourceSel = () => document.getElementById("rat-source") as HTMLSelectElement | null;
const ratFactionSel = () => document.getElementById("rat-faction") as HTMLSelectElement | null;
const ratTableSel = () => document.getElementById("rat-table") as HTMLSelectElement | null;
const ratStatus = (msg: string): void => {
  const el = document.getElementById("rat-status");
  if (el) el.textContent = msg;
};

const fillSelect = (sel: HTMLSelectElement | null, labels: string[]): void => {
  if (sel) sel.innerHTML = labels.map((l, i) => `<option value="${i}">${esc(l)}</option>`).join("");
};

function ratCurrentFaction(): RatFaction | undefined {
  return ratIndex?.sources[Number(ratSourceSel()?.value)]?.factions[Number(ratFactionSel()?.value)];
}
function fillRatTables(): void {
  const f = ratCurrentFaction();
  fillSelect(ratTableSel(), (f?.tables ?? []).map((t) => `${t.name}${t.type || t.weight ? ` [${[t.type, t.weight].filter(Boolean).join("/")}]` : ""}`));
}
function fillRatFactions(): void {
  const src = ratIndex?.sources[Number(ratSourceSel()?.value)];
  const labels = (src?.factions ?? []).map((f) => (f.side ? `${f.name} (${f.side})` : f.name));
  fillSelect(ratFactionSel(), labels);
  fillSelect(document.getElementById("rat-faction-b") as HTMLSelectElement | null, labels);
  fillRatTables();
}

/** Weighted pick (with replacement) of `n` unit indices from a table. */
function rollTable(table: RatTable, n: number): number[] {
  const total = table.e.reduce((s, [, w]) => s + w, 0);
  const picks: number[] = [];
  for (let k = 0; k < n && total > 0; k++) {
    let r = Math.random() * total;
    for (const [ui, w] of table.e) {
      r -= w;
      if (r < 0) {
        picks.push(ui);
        break;
      }
    }
  }
  return picks;
}

/** Fetch each rolled unit's source and append it to the active force. */
async function addRolledUnits(unitIdxs: number[]): Promise<void> {
  if (!ratIndex || unitIdxs.length === 0) return;
  let added = 0;
  for (const ui of unitIdxs) {
    const u = ratIndex.units[ui];
    if (!u) continue;
    try {
      const resp = await fetch(`./units/${u.p}`);
      if (!resp.ok) continue;
      force.push({ name: u.n, text: await resp.text(), file: u.p });
      added += 1;
    } catch {
      /* skip a unit that fails to load */
    }
  }
  saveForce();
  renderForce();
  ratStatus(`Rolled ${added} unit${added === 1 ? "" : "s"} into "${forces[activeForce]!.name}".`);
}

// ---- Scenario generator: two BV-matched forces from a faction's RATs --------

/** Roll a faction's force (weighted from its 'Mech tables, with replacement)
 * until it reaches ~targetBv. Only BV-known units count; returns picks + total. */
function rollForceToBv(faction: RatFaction, targetBv: number): { picks: number[]; bv: number } {
  let pool = faction.tables.filter((t) => t.type === "Mek").flatMap((t) => t.e);
  if (pool.length === 0) pool = faction.tables.flatMap((t) => t.e);
  const total = pool.reduce((s, [, w]) => s + w, 0);
  const pick = (): number => {
    let r = Math.random() * total;
    for (const [ui, w] of pool) {
      r -= w;
      if (r < 0) return ui;
    }
    return pool[pool.length - 1]![0];
  };
  const picks: number[] = [];
  let bv = 0;
  for (let guard = 0; bv < targetBv && guard < 400 && total > 0; guard++) {
    const ui = pick();
    const u = ratIndex!.units[ui];
    const b = u && lookupBv(u.n, u.p);
    if (!b) continue; // skip unmatched units so the BV total is meaningful
    picks.push(ui);
    bv += b;
  }
  return { picks, bv };
}

/** Convert a list of RAT unit indices into ForceUnits (fetch each source once). */
async function buildForceUnits(picks: number[]): Promise<ForceUnit[]> {
  if (!ratIndex) return [];
  const cache = new Map<string, string | null>();
  const units: ForceUnit[] = [];
  for (const ui of picks) {
    const u = ratIndex.units[ui];
    if (!u) continue;
    if (!cache.has(u.p)) {
      try {
        const resp = await fetch(`./units/${u.p}`);
        cache.set(u.p, resp.ok ? await resp.text() : null);
      } catch {
        cache.set(u.p, null);
      }
    }
    const text = cache.get(u.p);
    if (text) units.push({ name: u.n, text, file: u.p });
  }
  return units;
}

/** Roll two BV-matched opposing forces (faction A vs faction B) into new forces. */
async function generateScenario(): Promise<void> {
  if (!ratIndex) return;
  const src = ratIndex.sources[Number(ratSourceSel()?.value)];
  const facA = src?.factions[Number(ratFactionSel()?.value)];
  const facB = src?.factions[Number((document.getElementById("rat-faction-b") as HTMLSelectElement | null)?.value)];
  if (!src || !facA || !facB) return;
  const target = Math.max(500, Math.min(30000, Number((document.getElementById("rat-bv") as HTMLInputElement)?.value) || 5000));
  ratStatus("Rolling scenario…");
  const a = rollForceToBv(facA, target);
  const b = rollForceToBv(facB, a.bv); // match side B to side A's actual BV
  const era = src.name.replace(/^\([^)]*\)\s*-?\s*/, "").trim() || src.name;
  const unitsA = await buildForceUnits(a.picks);
  const unitsB = await buildForceUnits(b.picks);
  if (unitsA.length === 0 || unitsB.length === 0) {
    ratStatus("Couldn't roll a scenario for those factions.");
    return;
  }
  forces.push({ name: `${facA.name} · ${era}`, units: unitsA });
  forces.push({ name: `${facB.name} · ${era}`, units: unitsB });
  setActiveForce(forces.length - 2); // open side A
  ratStatus(
    `${facA.name}: ${a.bv.toLocaleString()} BV / ${unitsA.length} units  vs  ` +
      `${facB.name}: ${b.bv.toLocaleString()} BV / ${unitsB.length} units (switch with the force picker)`,
  );
}
document.getElementById("rat-scenario")?.addEventListener("click", () => void generateScenario());

let ratLoaded = false;
async function openRatGenerator(): Promise<void> {
  const body = document.getElementById("rat-body");
  const toggle = document.getElementById("rat-toggle") as HTMLButtonElement | null;
  if (!body || !toggle) return;
  const show = body.hasAttribute("hidden");
  body.toggleAttribute("hidden", !show);
  toggle.setAttribute("aria-expanded", String(show));
  if (show && !ratLoaded) {
    ratLoaded = true;
    ratStatus("Loading tables…");
    try {
      const resp = await fetch("./rat-index.json");
      if (resp.ok) ratIndex = (await resp.json()) as RatIndex;
    } catch {
      /* unavailable */
    }
    if (!ratIndex) {
      ratStatus("RAT data unavailable.");
      return;
    }
    fillSelect(ratSourceSel(), ratIndex.sources.map((s) => s.name));
    fillRatFactions();
    ratStatus("");
  }
}

document.getElementById("rat-toggle")?.addEventListener("click", () => void openRatGenerator());
ratSourceSel()?.addEventListener("change", fillRatFactions);
ratFactionSel()?.addEventListener("change", fillRatTables);
document.getElementById("rat-roll")?.addEventListener("click", () => {
  const f = ratCurrentFaction();
  const table = f?.tables[Number(ratTableSel()?.value)];
  if (!table) return;
  const n = Math.max(1, Math.min(12, Number((document.getElementById("rat-count") as HTMLInputElement)?.value) || 4));
  void addRolledUnits(rollTable(table, n));
});
document.getElementById("rat-lance")?.addEventListener("click", () => {
  const f = ratCurrentFaction();
  if (!f) return;
  // One 'Mech per weight class present; fall back to 4 from all this faction's tables.
  const mekByWeight = new Map<string, RatTable>();
  for (const t of f.tables) if (t.type === "Mek" && t.weight && !mekByWeight.has(t.weight)) mekByWeight.set(t.weight, t);
  const picks: number[] = [];
  for (const w of ["Light", "Medium", "Heavy", "Assault"]) {
    const t = mekByWeight.get(w);
    if (t) picks.push(...rollTable(t, 1));
  }
  if (picks.length === 0 && f.tables.length) {
    picks.push(...rollTable({ name: "all", type: "", weight: "", e: f.tables.flatMap((t) => t.e) }, 4));
  }
  void addRolledUnits(picks);
});

// ---- Pilot stable UI ------------------------------------------------------
let editingPilotId: string | null = null;
const pf = (id: string): HTMLInputElement | null => document.getElementById(id) as HTMLInputElement | null;

function renderPilots(): void {
  const list = document.getElementById("pilot-list");
  if (!list) return;
  list.innerHTML = pilots.length
    ? pilots
        .map(
          (p) =>
            `<div class="pilot-item"><span class="pilot-name">${esc(p.name)}</span> <span class="pilot-sk">${p.gunnery}/${p.piloting}</span>` +
            (p.abilities ? ` <span class="pilot-ab">${esc(p.abilities)}</span>` : "") +
            `<button class="pilot-edit" type="button" data-id="${p.id}">edit</button>` +
            `<button class="pilot-del" type="button" data-id="${p.id}" aria-label="Delete ${esc(p.name)}">✕</button></div>`,
        )
        .join("")
    : `<p class="muted force-empty">No pilots yet — add one below, then assign it to a unit in the editor.</p>`;
}

function refreshAfterPilotChange(): void {
  if (editingForceIdx != null) {
    renderForceEdit();
    renderForce();
  }
}

function savePilotFromForm(): void {
  const name = pf("pf-name")?.value.trim();
  if (!name) return;
  const gunnery = Math.max(0, Math.min(8, Math.round(Number(pf("pf-gun")?.value) || 4)));
  const piloting = Math.max(0, Math.min(8, Math.round(Number(pf("pf-pil")?.value) || 5)));
  const abilities = pf("pf-abil")?.value.trim() || undefined;
  const existing = editingPilotId ? pilots.find((p) => p.id === editingPilotId) : undefined;
  if (existing) Object.assign(existing, { name, gunnery, piloting, abilities });
  else pilots.push({ id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, gunnery, piloting, abilities });
  editingPilotId = null;
  savePilots();
  renderPilots();
  for (const id of ["pf-name", "pf-abil"]) if (pf(id)) pf(id)!.value = "";
  const sb = document.getElementById("pf-save");
  if (sb) sb.textContent = "Add pilot";
  refreshAfterPilotChange(); // an edited pilot updates any assigned units
}
document.getElementById("pf-save")?.addEventListener("click", savePilotFromForm);
document.getElementById("pilot-list")?.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const ed = t.closest<HTMLElement>(".pilot-edit");
  if (ed?.dataset.id) {
    const p = pilots.find((pl) => pl.id === ed.dataset.id);
    if (!p) return;
    editingPilotId = p.id;
    if (pf("pf-name")) pf("pf-name")!.value = p.name;
    if (pf("pf-gun")) pf("pf-gun")!.value = String(p.gunnery);
    if (pf("pf-pil")) pf("pf-pil")!.value = String(p.piloting);
    if (pf("pf-abil")) pf("pf-abil")!.value = p.abilities ?? "";
    const sb = document.getElementById("pf-save");
    if (sb) sb.textContent = "Save pilot";
    return;
  }
  const del = t.closest<HTMLElement>(".pilot-del");
  if (del?.dataset.id) {
    pilots = pilots.filter((p) => p.id !== del.dataset.id);
    savePilots();
    renderPilots();
    refreshAfterPilotChange();
  }
});
document.getElementById("pilot-toggle")?.addEventListener("click", () => {
  const body = document.getElementById("pilot-body");
  const tg = document.getElementById("pilot-toggle");
  if (!body || !tg) return;
  const show = body.hasAttribute("hidden");
  body.toggleAttribute("hidden", !show);
  tg.setAttribute("aria-expanded", String(show));
  if (show) renderPilots();
});
renderPilots();

// "Show quirks" option: a body class reveals the (always-injected) quirks line.
const QUIRKS_KEY = "mtf2override.showQuirks";
const quirksToggle = document.getElementById("show-quirks") as HTMLInputElement | null;
const applyQuirksPref = (on: boolean): void => {
  document.body.classList.toggle("show-quirks", on);
  if (quirksToggle) quirksToggle.checked = on;
};
applyQuirksPref(localStorage.getItem(QUIRKS_KEY) === "1");
/** Re-render whatever's on screen (quirks now change card values, not just CSS). */
function rerenderCurrent(): void {
  if (editingForceIdx != null) renderForceEdit();
  else if (edit) renderEdit();
  else if (lastResults) showResults(lastResults);
}
quirksToggle?.addEventListener("change", () => {
  const on = quirksToggle.checked;
  applyQuirksPref(on);
  try {
    localStorage.setItem(QUIRKS_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  rerenderCurrent(); // re-render so quirk-adjusted values appear/disappear
});

renderForce();
if (inBattle()) {
  enterBattle(); // resume a battle in progress after a reload
  try {
    const saved = JSON.parse(localStorage.getItem(MP_KEY) ?? "null") as typeof mpInfo;
    if (saved?.room && saved.role) mpConnect(saved.room, saved.role); // reconnect live battle
  } catch {
    /* ignore */
  }
} else {
  // A room link (#battle=…) opens the Join dialog pre-filled.
  const room = location.hash.match(/[#&]battle=([^&]+)/)?.[1];
  if (room) {
    history.replaceState(null, "", location.pathname + location.search);
    if (!forces.every((f) => f.units.length === 0)) {
      openBattleSetup();
      setBattleMode("join");
      const r = document.getElementById("battle-room") as HTMLInputElement | null;
      if (r) r.value = room;
    }
  }
}
// Load the BV + quirk indexes, then refresh so badges/quirks appear once in.
void loadBvIndex().then(renderForce);
void Promise.all([loadQuirkIndex(), loadWeaponQuirkIndex()]).then(() => {
  rerenderCurrent(); // refresh whatever's on screen (preview OR force) now that quirks loaded
});
// Role data for the analytics breakdown; refresh the panel if it's open.
void loadRoleIndex().then(() => {
  if (analyticsOpen()) renderAnalytics();
});
// Import a shared force from the URL hash, if present.
void importFromHash();
// Or open a battle straight from a campaign handoff (#h=…), if present.
void importHandoffFromHash();

$("clear").addEventListener("click", () => {
  currentPreview = null;
  fileInput.value = "";
  output.innerHTML = "";
});

// Open the native file picker from a real button. Clicking a <label> that wraps
// a display:none input fails to open the dialog in several browsers (Safari /
// some mobile), so trigger it explicitly instead.
$("upload").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  try {
    const files = Array.from(fileInput.files ?? []);
    if (files.length === 0) return;
    const texts = await Promise.all(files.map((f) => f.text()));
    const results = texts.map((text, i) => convertOne(text.trim(), files[i]!.name));
    currentPreview = { text: texts[0]!, file: files[0]!.name }; // first file is the "Add to Force" target
    showResults(results);
  } catch (err) {
    // Never fail silently — surface read/parse problems to the user.
    output.innerHTML = errorCard("upload", err instanceof Error ? err.message : String(err));
  } finally {
    fileInput.value = ""; // reset so re-selecting the same file fires "change"
  }
});

// Kick off the unit browser (non-blocking; silently no-ops if index is absent).
initBrowser().catch(() => { /* already handled inside */ });

// Build stamp — lets you confirm at a glance whether you're on the latest deploy.
const buildEl = document.getElementById("build");
if (buildEl) buildEl.textContent = `build ${__BUILD_TIME__}`;

// Register the PWA service worker (offline + installable). Skip localhost so the
// dev server / HMR isn't intercepted by a cache-first worker.
if ("serviceWorker" in navigator && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* registration failures are non-fatal */
    });
  });
}
