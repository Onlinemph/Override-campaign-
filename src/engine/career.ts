/**
 * engine/career.ts — the career loop's clock (ext).
 *
 * Battles award XP and wounds at ingest (handoff/import.ts); GM actions start repairs and
 * refits (core/truth.ts). This pass is the part that runs on the campaign clock: wounded
 * pilots heal, repairs finish, and completed refits deliver a serviceable unit — with a
 * pilot drawn from the side's POOL when one is waiting — into the chosen formation.
 * Everything is anchored on explicit ready ticks, so step size never matters.
 */
import { CAREER } from '../rules.js';
import type { Pilot, RefitProject, TruthState, Unit } from '../core/types.js';
import type { GameEvent } from '../core/events.js';

/** The first POOL pilot of a side, by id — deterministic across replays. */
function poolPilot(s: TruthState, sideId: string): Pilot | undefined {
  const ids = Object.keys(s.pilots).sort();
  for (const id of ids) {
    const p = s.pilots[id];
    if (p.status !== 'POOL') continue;
    // a pilot belongs to the side of any unit that lists them; pool pilots may be
    // orphaned from their ride, so fall back to the refit's side unchallenged
    const owner = Object.values(s.units).find(u => u.pilotIds.includes(id));
    if (!owner || owner.sideId === sideId) return p;
  }
  return undefined;
}

/** The unit a completed refit delivers: the wreck's stats under the recoverer's flag. */
export function refitUnit(s: TruthState, refit: RefitProject): Unit | null {
  const src = s.units[refit.sourceUnitId];
  if (!src) return null;
  const u: Unit = {
    ...structuredClone(src),
    id: `unit:refit:${refit.id}`,
    sideId: refit.sideId,
    name: `${src.name} (salvage)`,
    damage: 'OK',
    ammoState: 'FULL',
    pilotIds: [],
  };
  delete u.repairReadyTick;
  delete u.sheetDamage; // rebuilt from the frame up: a clean sheet
  return u;
}

export function careerPass(s: TruthState, emit: (e: GameEvent) => void): void {
  // wounded crews heal on schedule
  for (const p of Object.values(s.pilots)) {
    if (p.status === 'WOUNDED' && p.recoverAtTick != null && s.tick >= p.recoverAtTick) {
      emit({ type: 'PILOT_STATE_CHANGED', pilotId: p.id, status: 'OK' });
    }
  }

  // repairs finish
  for (const u of Object.values(s.units)) {
    if (u.repairReadyTick != null && s.tick >= u.repairReadyTick) {
      emit({ type: 'REPAIR_COMPLETED', unitId: u.id, tick: s.tick });
    }
  }

  // refits deliver
  for (const refit of Object.values(s.refits ?? {})) {
    if (refit.status !== 'IN_PROGRESS' || refit.readyTick == null || s.tick < refit.readyTick) continue;
    const formation = refit.formationId ? s.formations[refit.formationId] : undefined;
    const unit = refitUnit(s, refit);
    if (!formation || formation.destroyed || !unit) {
      // nowhere to deliver (formation died mid-refit): the wreck waits for a new home
      continue;
    }
    const pilot = poolPilot(s, refit.sideId);
    emit({
      type: 'REFIT_COMPLETED', refitId: refit.id, unit, formationId: formation.id,
      ...(pilot ? { pilot: { ...structuredClone(pilot), status: 'OK' as const } } : {}),
      tick: s.tick,
    });
    emit({ type: 'GM_NOTE', tick: s.tick,
      text: `${unit.name} rebuilt and delivered to ${formation.name}` +
            (pilot ? ` — ${pilot.name} takes the seat` : ' — no pilot in the pool') });
  }
}

/** How many XP a surviving crew earns from one battle (pure; used by ingest + tests). */
export function battleXp(won: boolean, kills: number): number {
  return CAREER.XP_SURVIVE + (won ? CAREER.XP_WIN : 0) + kills * CAREER.XP_PER_KILL;
}
