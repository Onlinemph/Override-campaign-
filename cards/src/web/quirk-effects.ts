/**
 * Override-native effects for MUL design quirks (adapted from Death From Above
 * Wargaming's "Design Quirks for BATTLETECH: OVERRIDE"). Keyed by the normalized
 * MUL quirk name; `quirkEffect()` strips a trailing "(LA)" / "(Clan)" / "(1)"
 * style suffix as a fallback so location/tech/level variants resolve to one entry
 * (band + VTOL variants keep their suffix, which is significant).
 *
 * sign: "pos" (helps you), "neg" (hurts you), "none" (campaign/narrative only —
 * no on-table rule in Override). Effects are condensed for the card line.
 */
import { ticHeat } from "../core/index.js";
import type { OverrideCard, RangeBrackets, Tic } from "../core/index.js";

export interface QuirkEffect {
  sign: "pos" | "neg" | "none";
  effect: string;
}

const NO_TABLE = "Campaign / narrative only — no table effect in Override.";

export const QUIRK_EFFECTS: Record<string, QuirkEffect> = {
  // --- Positive unit quirks ---
  "anti-aircraft targeting": { sign: "pos", effect: "Grounded: −1 TN vs flying targets (aero, VTOL, WiGE, combat drop)." },
  "atmospheric flyer": { sign: "pos", effect: "−1 to this aerospace unit's control & piloting checks." },
  "barrel fists": { sign: "pos", effect: "May punch with the affected arm with no hand actuator, no missing-hand penalty." },
  "battle computer": { sign: "pos", effect: "Force +1 initiative while present with a conscious pilot (no stack w/ Command Mech)." },
  "battle fists": { sign: "pos", effect: "Punch & arm-based physical attacks −1 TN." },
  "combat computer": { sign: "pos", effect: "Reduce total heat generated each turn by 1 (min 0)." },
  "command mech": { sign: "pos", effect: "Force +1 initiative while present with a conscious pilot (no stack w/ Battle Computer)." },
  "cowl": { sign: "pos", effect: "+1 effective head armor." },
  "directional torso mount": { sign: "pos", effect: "One designated TIC may also fire into the rear arc." },
  "distracting": { sign: "pos", effect: "Enemies making a morale test in LOS take +1 TN (needs morale rules)." },
  "easy to pilot": { sign: "pos", effect: "With piloting skill 3+ (worse): −1 to all PSRs." },
  "extended torso twist": { sign: "pos", effect: "Any TIC may fire into the rear arc." },
  "hyper-extending actuators": { sign: "pos", effect: "Arm-mounted TICs may fire into the rear arc." },
  "improved communications": { sign: "pos", effect: "Ignores the first +1 attack penalty from a hostile system (iNARC Haywire, Sensor Ghosts)." },
  "improved life support": { sign: "pos", effect: "Pilot ignores the first condition-monitor hit each game." },
  "improved sensors": { sign: "pos", effect: 'Counts as an Active Probe (21"); if it has one, +9" range.' },
  "improved targeting (short)": { sign: "pos", effect: "−1 TN to ranged attacks at short (PB & S)." },
  "improved targeting (medium)": { sign: "pos", effect: "−1 TN to ranged attacks at medium (M)." },
  "improved targeting (long)": { sign: "pos", effect: "−1 TN to ranged attacks at long (L & X)." },
  "internal bomb bay": { sign: "pos", effect: "Carries bombs with no TMM penalty; any hit → 2d6, on 2-3 the bombs cook off." },
  "multi-trac": { sign: "pos", effect: "Ignore the +1 secondary-target penalty in the front & arm arcs (not rear)." },
  "narrow/low profile": { sign: "pos", effect: "Enemy ranged attacks against it take +1 TN (physical unaffected)." },
  "nimble jumper": { sign: "pos", effect: 'On a jump may end ±1" off path: +1 own TMM but own attacks +3 (vs +2).' },
  "overhead arms": { sign: "pos", effect: "Arm-mounted TICs ignore the target's partial-cover bonus." },
  "power reverse": { sign: "pos", effect: "Wheeled/tracked vehicle uses its full sprint allowance in reverse." },
  "protected actuators": { sign: "pos", effect: "Infantry & BA anti-'Mech attacks take +1 TN." },
  "reinforced legs": { sign: "pos", effect: "Halve the self-damage from making a Death From Above." },
  "searchlight": { sign: "pos", effect: "Ignores all night & low-light attack penalties." },
  "stable": { sign: "pos", effect: "−2 to any PSR forced by a physical attack." },
  "variable range targeting": { sign: "pos", effect: "Declare short/long each end phase: −1 TN at that end, +1 at the other next turn." },
  "vtol rotor arrangement (co-axial)": { sign: "pos", effect: "Coaxial: no penalty on failed maneuvers; a rotor crit adds +1 to all piloting checks." },

  // --- Negative unit quirks ---
  "atmospheric flight instability": { sign: "neg", effect: "+1 to this aerospace unit's control & piloting checks." },
  "cramped cockpit": { sign: "neg", effect: "+1 to all PSRs." },
  "difficult ejection": { sign: "neg", effect: "On a forced auto-eject, the pilot takes one extra condition-monitor hit." },
  "em interference": { sign: "neg", effect: "Turn after firing an energy TIC, all electronics (probe/Artemis/C3/NARC/MASC/ECM/stealth) go dark." },
  "exposed actuators": { sign: "neg", effect: "Infantry & BA anti-'Mech attacks take −1 TN (easier to land)." },
  "flawed cooling system": { sign: "neg", effect: "Generates 1 extra heat each turn." },
  "fragile fuel tank": { sign: "neg", effect: "Aerospace only: a fuel-tank critical destroys the fighter on 8+ (vs 10+)." },
  "hard to pilot": { sign: "neg", effect: "+1 to all PSRs." },
  "low-mounted arms": { sign: "neg", effect: "Arm TICs can't clear cover/terrain; arms count as legs for partial cover & water." },
  "no ejection system": { sign: "neg", effect: "On a forced auto-eject, the pilot dies instead of escaping." },
  "no torso twist (legacy)": { sign: "neg", effect: "The unit can't fire into its rear arc." },
  "no/minimal arms": { sign: "neg", effect: 'No punch/arm attacks, can\'t lift; standing up costs an extra 1" (3" total).' },
  "oversized": { sign: "neg", effect: "Enemy attacks −1 TN; can't claim partial cover; takes terrain-crossing damage." },
  "poor life support": { sign: "neg", effect: "The first time the pilot is wounded, they take one extra condition-monitor hit." },
  "poor performance": { sign: "neg", effect: "TMM −1 (min 0), and drops into a lower initiative bracket." },
  "poor targeting (short)": { sign: "neg", effect: "+1 TN to ranged attacks at short (PB & S)." },
  "poor targeting (medium)": { sign: "neg", effect: "+1 TN to ranged attacks at medium (M)." },
  "poor targeting (long)": { sign: "neg", effect: "+1 TN to ranged attacks at long (L & X)." },
  "poor workmanship": { sign: "neg", effect: "Criticals against this unit confirm on 7+ (vs 8+)." },
  "prototype": { sign: "neg", effect: "Criticals against this unit confirm on 6+ (vs 8+). Brutal." },
  "ramshackle": { sign: "neg", effect: "Each battle, randomly gain one negative quirk (Sensor Ghosts / EM / Poor Targeting / Flawed Cooling / Ammo Feed)." },
  "sensor ghosts": { sign: "neg", effect: "+1 TN to all of this unit's ranged attacks." },
  "unbalanced": { sign: "neg", effect: "+1 to any PSR triggered by taking damage or a physical attack." },
  "vtol rotor arrangement (dual rotors)": { sign: "neg", effect: "Dual rotors: −1 to control rolls and a wider turn." },
  "weak head armor": { sign: "neg", effect: "Reduce head armor by 1 pip per level." },
  "weak legs": { sign: "neg", effect: "After being kicked or a DFA, 2d6: on 8+ a leg actuator crit (move −2, TMM −1)." },

  // --- Weapon quirks ---
  "accurate weapon": { sign: "pos", effect: "This TIC: −1 TN on all to-hit rolls." },
  "directional torso mounted weapon": { sign: "pos", effect: "This TIC may also fire into the rear arc." },
  "improved cooling jacket": { sign: "pos", effect: "This TIC generates 1 less heat when fired (min 1)." },
  "stabilized weapon": { sign: "pos", effect: "This TIC reduces the unit's movement attack penalty by 1 (jump or Run & Gun)." },
  "ammo feed problems": { sign: "neg", effect: "After firing, 2d6: on a 2 it jams and is dead for the game." },
  "exposed weapon linkage": { sign: "neg", effect: "Criticals against this TIC's location confirm on 7+ (vs 8+)." },
  "inaccurate weapon": { sign: "neg", effect: "This TIC: +1 TN on all to-hit rolls." },
  "no cooling jacket": { sign: "neg", effect: "This TIC generates +2 heat when fired." },
  "poor cooling jacket": { sign: "neg", effect: "This TIC generates +1 heat when fired." },
  "static ammo feed": { sign: "neg", effect: "Locks one special-ammunition choice before the game; can't switch mid-battle." },

  // --- No table effect in Override (campaign / narrative) ---
  "bad reputation": { sign: "none", effect: NO_TABLE },
  "good reputation": { sign: "none", effect: NO_TABLE },
  "easy to maintain": { sign: "none", effect: NO_TABLE },
  "difficult to maintain": { sign: "none", effect: NO_TABLE },
  "rugged": { sign: "none", effect: NO_TABLE },
  "ubiquitous": { sign: "none", effect: NO_TABLE },
  "fast reload": { sign: "none", effect: NO_TABLE },
  "modular weapon": { sign: "none", effect: NO_TABLE },
  "non-standard parts": { sign: "none", effect: NO_TABLE },
  "obsolete": { sign: "none", effect: NO_TABLE },
  "illegal design": { sign: "none", effect: NO_TABLE },
  "jettison-capable weapon": { sign: "none", effect: "Override doesn't track on-the-fly tonnage — no table effect." },
  "compact mech": { sign: "none", effect: NO_TABLE },
  "docking arms": { sign: "none", effect: NO_TABLE },
  "large dropship": { sign: "none", effect: NO_TABLE },
  "trailer hitch": { sign: "none", effect: NO_TABLE },
  "gas hog": { sign: "none", effect: NO_TABLE },
  "poor sealing": { sign: "none", effect: NO_TABLE },
  "un-streamlined": { sign: "none", effect: NO_TABLE },
  "weak undercarriage": { sign: "none", effect: NO_TABLE },
  "fine manipulators": { sign: "none", effect: "Objective/scenario only — no combat rule." },
  "vestigial hands": { sign: "none", effect: "Objective/scenario only — no combat rule." },
  "rumble seat (legacy)": { sign: "none", effect: "Removed from current rules." },
};

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** MTF/BLK `weaponquirk:` codes -> canonical MUL names (which must be keys above,
 * so the effect resolves). NB: `stable_weapon` is "Stabilized Weapon", not the
 * unit quirk "Stable". */
export const WEAPON_QUIRK_LABEL: Record<string, string> = {
  stable_weapon: "Stabilized Weapon",
  direct_torso_mount: "Directional Torso Mounted Weapon",
  mod_weapons: "Modular Weapon",
  jettison_capable: "Jettison-Capable Weapon",
  exposed_linkage: "Exposed Weapon Linkage",
  fast_reload: "Fast Reload",
  imp_cooling: "Improved Cooling Jacket",
  ammo_feed_problems: "Ammo Feed Problems",
  accurate: "Accurate Weapon",
  static_feed: "Static Ammo Feed",
  em_interference: "EM Interference",
  poor_cooling: "Poor Cooling Jacket",
  no_cooling: "No Cooling Jacket",
  inaccurate: "Inaccurate Weapon",
};

/** Resolve a MUL quirk name to its Override effect. Tries the full name, then the
 * name with a trailing "(…)" suffix stripped (so "Battle Fists (LA)" → "battle fists"). */
export function quirkEffect(name: string): QuirkEffect | undefined {
  const n = norm(name);
  return QUIRK_EFFECTS[n] ?? QUIRK_EFFECTS[n.replace(/\s*\([^)]*\)\s*$/, "").trim()];
}

// ---- Applying quirk effects to 'Mech card values (display only) -----------
export const RANGE_BANDS = {
  all: ["pb", "s", "m", "l", "x"],
  short: ["pb", "s"],
  medium: ["m"],
  long: ["l", "x"],
} as const satisfies Record<string, readonly (keyof RangeBrackets)[]>;

/** Add `delta` to the given range-bracket band(s) (lower = easier to hit). */
export function adjustRange(range: RangeBrackets | null, delta: number, bands: readonly (keyof RangeBrackets)[]): void {
  if (!range) return;
  for (const b of bands) if (range[b] !== null) range[b] = (range[b] as number) + delta;
}

/** Apply a weapon quirk's Override effect to a matched 'Mech TIC (heat / to-hit). */
export function applyWeaponQuirkToTic(tic: Tic, label: string): void {
  const cur = (): number => tic.heatOverride ?? ticHeat(tic);
  switch (label) {
    case "Improved Cooling Jacket": tic.heatOverride = Math.max(1, cur() - 1); break;
    case "Poor Cooling Jacket": tic.heatOverride = cur() + 1; break;
    case "No Cooling Jacket": tic.heatOverride = cur() + 2; break;
    case "Accurate Weapon": adjustRange(tic.range, -1, RANGE_BANDS.all); break;
    case "Inaccurate Weapon": adjustRange(tic.range, 1, RANGE_BANDS.all); break;
  }
}

/** Apply a unit quirk's Override effect to the whole 'Mech card (to-hit / head armor). */
export function applyUnitQuirkToCard(card: OverrideCard, name: string): void {
  const tgt = (delta: number, band: keyof typeof RANGE_BANDS): void => {
    for (const t of card.tics) adjustRange(t.range, delta, RANGE_BANDS[band]);
  };
  if (/^improved targeting \(short\)/i.test(name)) tgt(-1, "short");
  else if (/^improved targeting \(medium\)/i.test(name)) tgt(-1, "medium");
  else if (/^improved targeting \(long\)/i.test(name)) tgt(-1, "long");
  else if (/^poor targeting \(short\)/i.test(name)) tgt(1, "short");
  else if (/^poor targeting \(medium\)/i.test(name)) tgt(1, "medium");
  else if (/^poor targeting \(long\)/i.test(name)) tgt(1, "long");
  else if (/^sensor ghosts/i.test(name)) tgt(1, "all");
  else if (/^cowl/i.test(name)) card.armor.head += 1;
  else if (/^weak head armor/i.test(name)) card.armor.head = Math.max(0, card.armor.head - (Number(name.match(/\((\d)\)/)?.[1]) || 1));
}
