/**
 * roster/apply.ts — put derived record-sheet data onto campaign units.
 *
 *   author:  buildUnitFromModel() mints a fully-populated Unit from a model name.
 *   enrich:  enrichUnit()/enrichTruth() fill gaps on existing units from their
 *            model — EXPLICIT CAMPAIGN VALUES WIN. A non-zero/non-empty field the
 *            GM already set is never overwritten; only unset (0 / missing) fields
 *            are filled, and tags are UNIONed so hand-authored tags survive and
 *            derived ones (ECM, probes, …) are added.
 *
 * Because these only touch the same fields the engines already read (movement →
 * op-map pace, thrust → air/space, tags → detection & the net), enriching a
 * campaign makes ECM / sensors / speed take effect on the map with no engine change.
 */
import type { Id, TruthState, Unit } from '../core/types.js';
import { deriveFieldsForModel, isLibraryAvailable } from './library.js';

export interface AuthorOptions {
  id: Id;
  sideId: Id;
  model: string;
  name?: string;
  pilotIds?: Id[];
  pv?: number;
  ammoState?: Unit['ammoState'];
  extraTags?: string[];
}

/**
 * Build a fully-populated campaign Unit from a library model name. Returns null
 * when the model doesn't resolve (caller can fall back to authoring by hand).
 */
export function buildUnitFromModel(opts: AuthorOptions): Unit | null {
  const d = deriveFieldsForModel(opts.model);
  if (!d) return null;
  const tags = [...new Set([...(opts.extraTags ?? []), ...d.tags])];
  return {
    id: opts.id,
    sideId: opts.sideId,
    name: opts.name ?? opts.model,
    model: opts.model,
    class: d.class,
    bv: d.bv ?? 0,
    pv: opts.pv ?? 0,
    walkOrCruise: d.walkOrCruise,
    run: d.run,
    jump: d.jump,
    ...(d.safeThrust != null ? { safeThrust: d.safeThrust } : {}),
    ...(d.maxThrust != null ? { maxThrust: d.maxThrust } : {}),
    ...(d.fuel ? { fuel: d.fuel } : {}),
    damage: 'OK',
    pilotIds: opts.pilotIds ?? [],
    ammoState: opts.ammoState ?? 'FULL',
    tags,
  };
}

/**
 * Fill unset fields on an existing unit from its model; explicit values win.
 * Mutates `u` in place and returns the list of fields that were filled.
 */
export function enrichUnit(u: Unit): string[] {
  const d = deriveFieldsForModel(u.model);
  if (!d) return [];
  const changed: string[] = [];

  // Movement: a 0 is treated as "unset" (a real unit never walks 0); a non-zero
  // value the GM set is kept.
  const fillMove = (k: 'walkOrCruise' | 'run' | 'jump') => {
    if (!u[k] && d[k]) { u[k] = d[k]; changed.push(k); }
  };
  fillMove('walkOrCruise');
  fillMove('run');
  fillMove('jump');

  if (!u.safeThrust && d.safeThrust) { u.safeThrust = d.safeThrust; changed.push('safeThrust'); }
  if (!u.maxThrust && d.maxThrust) { u.maxThrust = d.maxThrust; changed.push('maxThrust'); }
  if (!u.bv && d.bv) { u.bv = d.bv; changed.push('bv'); }
  if (!u.fuel && d.fuel) { u.fuel = d.fuel; changed.push('fuel'); }

  // Tags: union — keep every hand-authored tag, add the derived ones.
  const have = new Set(u.tags);
  let addedTag = false;
  for (const t of d.tags) if (!have.has(t)) { u.tags.push(t); addedTag = true; }
  if (addedTag) changed.push('tags');

  return changed;
}

export interface EnrichSummary {
  available: boolean;
  unitsChanged: number;
  changed: Record<Id, string[]>;
}

/** Enrich every unit in a TruthState. No-op (available:false) without a library. */
export function enrichTruth(s: TruthState): EnrichSummary {
  const available = isLibraryAvailable();
  const changed: Record<Id, string[]> = {};
  if (available) {
    for (const u of Object.values(s.units)) {
      const c = enrichUnit(u);
      if (c.length) changed[u.id] = c;
    }
  }
  return { available, unitsChanged: Object.keys(changed).length, changed };
}
