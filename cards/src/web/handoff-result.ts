/**
 * handoff-result.ts — pure mapping from the battle tracker's per-unit state to an
 * OVERRIDE GM Tool BattleResult (the return leg of the campaign ↔ card-builder
 * loop). DOM-free and side-effect-free so the mapping is unit-tested; main.ts owns
 * the button + the POST.
 *
 * The tracker stores coarse, human-marked damage (out-of-action, engine/gyro/leg
 * crits, the pilot condition track, heat, ammo spent). We fold that into the
 * campaign's DamageState / pilot status / ammo enums — deliberately conservative,
 * since the GM reviews the summary before it is sent and the campaign is the
 * final authority.
 */

/** The subset of a ForceUnit's `damage` block this mapping reads. */
export interface TrackedDamage {
  loc?: Record<string, number>;
  groups?: Record<string, number>;
  condition?: number;
  engine?: number;
  gyro?: number;
  avionics?: number;
  legHits?: number;
  heat?: number;
  ammo?: Record<string, number>;
  fuel?: number; // aero: fuel points remaining (comes home on the record sheet)
  out?: boolean;
}

/** A battle-force unit as far as the result mapping is concerned. */
export interface ResultUnit {
  campaignUnitId?: string;
  campaignPilotIds?: string[];
  damage?: TrackedDamage;
}

export type DamageState = 'OK' | 'DAMAGED' | 'CRIPPLED' | 'DESTROYED' | 'SALVAGE';
export type PilotStatus = 'OK' | 'WOUNDED' | 'DOWNED';
export type AmmoState = 'FULL' | 'PARTIAL' | 'DRY';

const anyPositive = (o?: Record<string, number>): boolean =>
  !!o && Object.values(o).some(v => v > 0);

/** A unit that is out of the fight (a kill or a recoverable wreck). */
export function isDead(dmg: DamageState): boolean {
  return dmg === 'DESTROYED' || dmg === 'SALVAGE';
}

/**
 * Coarse campaign DamageState from tracked crits/pips:
 *   dead engine (2 hits)   → DESTROYED  (catastrophic — the tracker's "wrecked")
 *   otherwise out of action → SALVAGE    (disabled but recoverable for the hex-holder)
 *   any mobility/crew crit  → CRIPPLED
 *   any armor/structure/heat→ DAMAGED
 *   otherwise               → OK
 */
export function mapDamageState(d?: TrackedDamage): DamageState {
  if (!d) return 'OK';
  if ((d.engine ?? 0) >= 2) return 'DESTROYED';
  if (d.out) return 'SALVAGE';
  if ((d.engine ?? 0) >= 1 || (d.gyro ?? 0) >= 1 || (d.legHits ?? 0) >= 1 || (d.avionics ?? 0) >= 1) {
    return 'CRIPPLED';
  }
  if (anyPositive(d.loc) || anyPositive(d.groups) || (d.condition ?? 0) > 0 ||
      (d.heat ?? 0) > 0 || anyPositive(d.ammo)) {
    return 'DAMAGED';
  }
  return 'OK';
}

/** Pilot status from the consciousness track (no hits → OK; deep track → DOWNED). */
export function mapPilotStatus(d?: TrackedDamage): PilotStatus {
  const c = d?.condition ?? 0;
  if (c <= 0) return 'OK';
  if (c >= 3) return 'DOWNED';
  return 'WOUNDED';
}

/** Ammo: PARTIAL once anything has been expended, else FULL (DRY needs totals we
 * don't carry, so we never over-claim it). */
export function mapAmmoState(d?: TrackedDamage): AmmoState {
  const spent = d?.ammo ? Object.values(d.ammo).reduce((a, b) => a + b, 0) : 0;
  return spent > 0 ? 'PARTIAL' : 'FULL';
}

export interface BattleResultPayload {
  handoffId: string;
  victorSideId?: string;
  hexControlSideId?: string;
  unitOutcomes: Array<{
    unitId: string;
    damage: DamageState;
    ammoState: AmmoState;
    fpRemaining?: number; // aero fuel that survived the merge (updates the campaign ledger)
    /** The marked-up card, verbatim — the campaign persists it between battles. */
    sheetDamage?: TrackedDamage;
    pilotOutcomes: Array<{ pilotId: string; status: PilotStatus;
                           hits?: number /* consciousness track: recovery scales per hit */ }>;
  }>;
  /** Crews that punched out; the campaign fills the board position on ingest. */
  ejections: Array<{ pilotId: string }>;
  turnsElapsed: number;
  notes: string;
}

/**
 * Build a BattleResult from the two battle forces. Only units that carry a
 * campaign id map home. Victor is inferred from surviving (still-fighting) counts;
 * a tie (or an unknown side id) leaves it undefined for the GM to decide. A crew
 * whose unit is dead but who is still conscious ejects (a SAR marker downstream).
 */
export function battleResultFromForces(opts: {
  handoffId: string;
  you: { sideId?: string; units: ResultUnit[] };
  foe: { sideId?: string; units: ResultUnit[] };
  turnsElapsed: number;
}): BattleResultPayload {
  const outcomes: BattleResultPayload['unitOutcomes'] = [];
  const ejections: BattleResultPayload['ejections'] = [];
  const survivors: Record<'you' | 'foe', number> = { you: 0, foe: 0 };

  for (const [key, side] of [['you', opts.you], ['foe', opts.foe]] as const) {
    for (const u of side.units) {
      if (!u.campaignUnitId) continue; // non-campaign units (manual adds) don't map home
      const damage = mapDamageState(u.damage);
      if (!isDead(damage)) survivors[key]++;
      const pilotStatus = mapPilotStatus(u.damage);
      const hits = u.damage?.condition ?? 0;
      // the exact marked boxes ride home (fuel is dropped — it has its own ledger)
      const sheet: TrackedDamage | undefined = u.damage ? { ...u.damage } : undefined;
      if (sheet) delete sheet.fuel;
      const sheetHasMarks = sheet && Object.values(sheet).some(v =>
        typeof v === 'number' ? v > 0
        : typeof v === 'boolean' ? v
        : v && typeof v === 'object' ? Object.values(v).some(n => (n as number) > 0)
        : false);
      outcomes.push({
        unitId: u.campaignUnitId,
        damage,
        ammoState: mapAmmoState(u.damage),
        ...(u.damage?.fuel !== undefined ? { fpRemaining: u.damage.fuel } : {}),
        ...(sheetHasMarks ? { sheetDamage: sheet } : {}),
        pilotOutcomes: (u.campaignPilotIds ?? []).map(pilotId => ({ pilotId, status: pilotStatus,
          ...(hits > 0 ? { hits } : {}) })),
      });
      // a downed unit whose crew is still conscious got out — flag SAR
      if (isDead(damage) && pilotStatus !== 'DOWNED') {
        for (const pilotId of u.campaignPilotIds ?? []) ejections.push({ pilotId });
      }
    }
  }

  let victorSideId: string | undefined;
  if (survivors.you !== survivors.foe && opts.you.sideId && opts.foe.sideId) {
    victorSideId = survivors.you > survivors.foe ? opts.you.sideId : opts.foe.sideId;
  }

  return {
    handoffId: opts.handoffId,
    ...(victorSideId ? { victorSideId, hexControlSideId: victorSideId } : {}),
    unitOutcomes: outcomes,
    ejections,
    turnsElapsed: opts.turnsElapsed,
    notes: 'Resolved in the embedded battle tracker.',
  };
}
