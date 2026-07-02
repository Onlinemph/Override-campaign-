/**
 * handoff-import.ts — pure helpers for loading a battle straight from an OVERRIDE
 * GM Tool handoff (campaign → card builder). The campaign emits a compact roster
 * (model names + pilot skills per side) in the URL hash; the card builder resolves
 * each model against the bundled unit library and spins up an interactive battle.
 *
 * This module is DOM-free and side-effect-free so the name→unit resolver can be
 * unit-tested. main.ts owns the fetching + battle wiring (the DOM half).
 */

/** One entry from public/units-index.json (written by scripts/extract-units.mjs). */
export interface UnitIndexEntry {
  name: string;
  path: string;
  category?: string;
  era?: string;
}

/** A single unit in a handoff roster: just enough to find it and seat its pilot. */
export interface HandoffRosterUnit {
  /** MegaMek-style chassis+model, e.g. "Warhammer WHM-6R" — matched to the library. */
  model: string;
  /** Optional display name (pilot/unit callsign); falls back to the resolved name. */
  name?: string;
  gunnery?: number;
  piloting?: number;
  /** Opaque campaign ids, echoed back in the BattleResult so outcomes map home. */
  unitId?: string;
  pilotIds?: string[];
  /** Unrepaired damage from the last battle — seeds the card's marked boxes. */
  sheetDamage?: Record<string, unknown>;
  // Air / space entry state (SKYWATCH / DEEP SKY), surfaced in the briefing.
  velocity?: number;
  altLevel?: number;
  fpOnTable?: number;
  jokerFp?: number;
  bingoFp?: number;
}

/** The tabletop setup a side deploys under, for the briefing panel. */
export interface HandoffRosterSetup {
  entryEdge?: string;
  deploysFirst?: boolean;
  initiativeBonus?: number;
  initiativeBonusTurns?: number;
  hiddenSetup?: boolean;
  fortified?: boolean;
  rdyTnPenalty?: number;
  offboard?: {
    artillery?: number;
    reinforcements?: Array<{ arrivesTurn: number; edge: string }>;
    airOnStation?: Array<{ arrivesTurn: number; fpOnStation: number }>;
  };
}

export interface HandoffRosterSide {
  sideId?: string;
  name: string;
  setup?: HandoffRosterSetup;
  units: HandoffRosterUnit[];
}

/** The payload carried in the `#h=` hash. `table`/`specialRules` are informational. */
export interface HandoffRoster {
  /** Campaign handoff id — lets the tracker post a BattleResult back for it. */
  handoffId?: string;
  table?: string;
  specialRules?: string[];
  mapSheets?: string[];
  nodeName?: string;
  sides: HandoffRosterSide[];
}

/** Human-readable briefing lines for one side's tabletop setup (for the panel). */
export function setupNotes(side: HandoffRosterSide): string[] {
  const s = side.setup;
  if (!s) return [];
  const notes: string[] = [];
  if (s.entryEdge) notes.push(`Entry edge: ${s.entryEdge}`);
  notes.push(s.deploysFirst ? 'Deploys first' : 'Deploys second');
  if (s.initiativeBonus) notes.push(`+${s.initiativeBonus} initiative (${s.initiativeBonusTurns ?? 0} turns)`);
  if (s.hiddenSetup) notes.push('Hidden setup');
  if (s.fortified) notes.push('Fortified');
  if (s.rdyTnPenalty) notes.push(`RDY: +${s.rdyTnPenalty} to all TNs`);
  const off = s.offboard;
  if (off?.artillery) notes.push(`Off-board artillery: ${off.artillery}`);
  if (off?.reinforcements?.length) {
    const soonest = Math.min(...off.reinforcements.map(r => r.arrivesTurn));
    notes.push(`Reinforcements: ${off.reinforcements.length} (first ~turn ${soonest})`);
  }
  if (off?.airOnStation?.length) {
    const n = off.airOnStation.length;
    const soonest = Math.min(...off.airOnStation.map(a => a.arrivesTurn));
    const fp = off.airOnStation.map(a => a.fpOnStation).filter(x => x > 0);
    notes.push(`Air support: ${n} flight${n === 1 ? '' : 's'} ` +
      `(${soonest === 0 ? 'overhead now' : `first ~turn ${soonest}`}` +
      `${fp.length ? `, ${Math.min(...fp)} FP` : ''})`);
  }
  return notes;
}

/** A compact air/space entry note for a unit, or "" for ground units. */
export function airEntryNote(u: HandoffRosterUnit): string {
  const bits: string[] = [];
  if (u.velocity !== undefined) bits.push(`vel ${u.velocity}`);
  if (u.altLevel !== undefined) bits.push(`alt ${u.altLevel}`);
  if (u.fpOnTable !== undefined) bits.push(`${u.fpOnTable} FP`);
  if (u.jokerFp !== undefined) bits.push(`joker ${u.jokerFp}`);
  if (u.bingoFp !== undefined) bits.push(`bingo ${u.bingoFp}`);
  return bits.join(" · ");
}

/** Normalize a unit name for tolerant matching: lowercase, collapse whitespace. */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Build a normalized-name → entry lookup. When two entries share a normalized
 * name (variants across eras), the first wins — the index is pre-sorted by name,
 * so this is deterministic across builds.
 */
export function buildNameIndex(index: UnitIndexEntry[]): Map<string, UnitIndexEntry> {
  const byName = new Map<string, UnitIndexEntry>();
  for (const e of index) {
    const key = normalizeName(e.name);
    if (!byName.has(key)) byName.set(key, e);
  }
  return byName;
}

/**
 * Resolve a campaign model string to a library unit. Tries, in order:
 *   1. exact normalized match ("Warhammer WHM-6R")
 *   2. with any trailing parenthetical stripped ("Achilles (pocket WarShip)" → "Achilles")
 *   3. a unique prefix match (the model is a prefix of exactly one library name)
 * Returns null when nothing matches (caller skips the unit and warns the GM).
 */
export function resolveModel(
  model: string,
  byName: Map<string, UnitIndexEntry>,
): UnitIndexEntry | null {
  if (!model) return null;
  const exact = byName.get(normalizeName(model));
  if (exact) return exact;

  const noParen = normalizeName(model.replace(/\s*\([^)]*\)\s*$/, ""));
  if (noParen) {
    const hit = byName.get(noParen);
    if (hit) return hit;
    // unique prefix: e.g. campaign "Atlas" → the only "Atlas …" in the library
    let uniq: UnitIndexEntry | null = null;
    let count = 0;
    for (const [key, entry] of byName) {
      if (key === noParen || key.startsWith(noParen + " ")) {
        uniq = entry;
        if (++count > 1) break;
      }
    }
    if (count === 1 && uniq) return uniq;
  }
  return null;
}
