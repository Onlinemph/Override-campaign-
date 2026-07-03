/**
 * rules.ts — EVERY game constant lives here and nowhere else.
 *
 * Organized to mirror the three rulebooks' quick-reference appendices so numbers can be
 * house-ruled without touching engine code:
 *   §M0  BattleTech: OVERRIDE core rules (Appendix A + body tables)
 *   §M1  SKYWATCH quick reference        (filled in at Milestone 3)
 *   §M2  DEEP SKY quick reference        (filled in at Milestone 4)
 *
 * Every entry cites its source section. Engine code imports from here only.
 */

// ════════════════════════════════════════════════════════════════════════════
// §M0 — OVERRIDE CORE (Module 0)
// ════════════════════════════════════════════════════════════════════════════

// ── Scales & clock (core §2, App. A; spec §1.1) ─────────────────────────────
export const CLOCK = {
  TICK_MINUTES: 6,        // 1 tick = 1 contact turn = 6 min
  TICKS_PER_PULSE: 10,    // 1 pulse = 1 h
  TICKS_PER_WATCH: 60,    // 1 watch = 6 h (DEEP SKY tier, defined in core spec)
  TICKS_PER_DAY: 240,
  DEFAULT_DAWN_TICK: 60,  // 0600 local (tick-of-day)
  DEFAULT_DUSK_TICK: 180, // 1800 local
} as const;

// Contact-turn mode triggers when opposing formations are within 5 op-hexes and
// at least one side knows it (core §2.2; spec §3.1).
export const CONTACT_MODE_RANGE_HEXES = 5;

// ── Base signature by formation size (core §3.1) ────────────────────────────
export const BASE_SIG = {
  BATTALION: 5,   // battalion+ / grounded DropShip
  COMPANY: 6,     // company / trinary / large convoy
  LANCE: 7,       // lance / star / platoon column
  SINGLE: 9,      // single vehicle or 'Mech / BA squad
  SQUAD: 10,      // foot infantry squad / sensor team
} as const;

export const SIZE_CLASS_NAMES: Record<number, string> = {
  5: 'battalion+', 6: 'company', 7: 'lance', 9: 'single unit', 10: 'squad',
};

// ── Target SIG modifiers — applied to the detection TN (core §6.3) ──────────
export const SIG_MODS = {
  MOVING: -1,
  FORCED_MARCH: -2,       // also Sprinting
  SPRINT: -2,
  JUMP_JETS: -2,
  FIRED_THIS_TURN: -3,    // artillery: automatic reveal of firing hex (core §9.2)
  HIDE: 2,
  // D-006 (GM ruling): cautious movement keeps Hide's concealment bonus while moving
  // at half pulse speed, and suppresses the MOVING −1.
  MOVE_CAUTIOUS: 2,
  DUG_IN: 1,
  // D-006 (GM ruling): night +2 applies to ALL passive sensing (visual and electronic
  // passive). Active sensors are exempt. "Visual only" survives as the Mk1 Eyeball's
  // range drop at night (see SENSOR_RANGES.EYEBALL).
  NIGHT_PASSIVE: 2,
  ECM_GUARDIAN: 1,
  ECM_ANGEL: 2,
  STEALTH_ARMOR: 2,       // stealth-armored single units
  RAIN: 1,                // all sensors; thunderstorms also ground VTOLs & scatter drops
  EMCON_DARK: 2,
  EMCON_ACTIVE: -2,       // you are a lighthouse
  ROAD_MOVEMENT: -1,      // movement on roads is predictable (core §5.2)
} as const;

// ── Searcher modifiers — applied to the 2d6 roll (core §6.3) ────────────────
export const SEARCHER_MODS = {
  EMCON_ACTIVE: 2,
  PATROL_ORDER: 1,
  LEAN_LOITER: -1,        // SKYWATCH §2: minimum-burn loiter degrades your own search
} as const;

// ── Sensor ranges in operational hexes (core §6.2) ──────────────────────────
export const SENSOR_RANGES = {
  MECH_STANDARD:  { passive: 2, active: 4 },
  BEAGLE:         { passive: 3, active: 5 },   // Beagle Probe / Clan AP in formation
  RECON_VTOL:     { passive: 4, active: 8 },   // recon VTOL / conventional ftr per pass
  MOBILE_HQ:      { passive: 4, active: 8 },   // also sensor vehicle / listening post
  SENSOR_STATION: { passive: 6, active: 12 },  // fixed sensor station hex
  EYEBALL:        { day: 3, night: 1 },        // Mk1 Eyeball, visual, requires LOS
  RECON_AIR_CORRIDOR_WIDTH: 5,                 // aerospace recon sortie corridor
  SATELLITE_TRACK_WIDTH: 10,                   // recon satellite ground track
  // core §6.1: EMCON DARK ⇒ "Passive sensors only, SNS −2" — read as a passive-range
  // penalty (SNS is the range stat); eyeballs unaffected (D-008.13)
  DARK_PASSIVE_RANGE_PENALTY: -2,
} as const;

// ── Terrain (core §5.2) ─────────────────────────────────────────────────────
// ompCost null = impassable to standard ground movement.
export interface TerrainRow {
  ompCost: number | null;
  sigMod: number;            // target SIG modifier when in this terrain
  infantrySigMod?: number;   // urban: infantry-only bonus replaces sigMod
  blocksLos: boolean;        // blocks ground-to-ground visual LOS
  mechInfantryOnly?: boolean;
  hoverCost?: number | null; // hover/WiGE override (null = impassable to hover)
}
export const TERRAIN: Record<string, TerrainRow> = {
  CLEAR:    { ompCost: 1, sigMod: 0, blocksLos: false },
  WOODS:    { ompCost: 2, sigMod: 1, blocksLos: false },
  ROUGH:    { ompCost: 2, sigMod: 0, blocksLos: false },
  HILLS:    { ompCost: 2, sigMod: 0, blocksLos: true },
  MOUNTAIN: { ompCost: 3, sigMod: 0, blocksLos: true, mechInfantryOnly: true, hoverCost: null },
  WATER:    { ompCost: null, sigMod: 0, blocksLos: false, hoverCost: 1 },   // naval/hover only
  SWAMP:    { ompCost: 3, sigMod: 1, blocksLos: false, hoverCost: 1 },
  URBAN:    { ompCost: 1, sigMod: 2, infantrySigMod: 3, blocksLos: true },
};
export const ROAD_COST_FACTOR = 0.5;   // ½ cost, min 1 — see MOVEMENT.ROAD_MIN_COST
export const ROAD_MIN_COST = 1;

// ── Movement (core §2.3, §3.3, §5.1, §5.3) ──────────────────────────────────
// Operational scale: one hex = 18 km (the high-altitude grid). OMP is hexes per HOUR
// (one pulse): mech ≈ 3, vehicle ≈ 4, hover/VTOL ≈ 8 (× 18 km ⇒ ~54/72/144 km/h). A
// 6-minute contact turn covers OMP/10 hex, so units crawl ~3 turns per hex near combat.
export const MOVEMENT = {
  HEX_KM: 18,                   // each operational hex spans 18 km
  ROAD_BONUS: 1.5,              // roads ×1.5 (predictable, faster) — was a ×10 pulse mult
  FORCED_MARCH_MULT: 1.5,       // speed ×1.5
  FORCED_MARCH_RDY_PER_PULSE: -1,
  FORCED_MARCH_BREAKDOWN_TN: 3, // 2d6 ≤ 3 per pulse ⇒ breakdown (engine hook: M2)
  CAUTIOUS_SPEED_FACTOR: 0.5,   // D-006: cautious movement at half speed
  SPRINT_TURN_RATIO: 3,         // sprint (Run MP) 1 turn per 3
  WHEELED_OFFROAD_FACTOR: 2,    // wheeled pay double in rough/woods/swamp
  VTOL_OMP_MULT: 2,             // VTOL = cruise ×2, ignores terrain
  VTOL_ENDURANCE_TURNS: 20,
  CONV_FIGHTER_OMP_MULT: 8,     // safe thrust ×8
  ASF_OMP_MULT: 16,
  DROPSHIP_ATMO_OMP_MULT: 8,
  RAIL_OMP: 12,
  SUPPORT_OMP: 2,               // towed artillery / trucks / MASH; road-bound (×2 off-road)
} as const;

// ── Command nets (core §4.2) ────────────────────────────────────────────────
export const NET = {
  GROUND_NODE_RADIUS: 12,       // default op-hexes a mobile command node nets
  DROPSHIP_BASE_RADIUS: 24,     // grounded DropShip / fixed base (per-campaign overridable)
  COMM_SAT_THEATER_WIDE: true,
  RENET_PULSES: 1,              // per formation, after losing its node (D-008.2)
  ECM_NET_CUT_RADIUS: 0,        // D-008.1: hostile ECM cuts net in its own op-hex
} as const;

// ── Contact ladder (core §6.4; spec §2.5/§4) ────────────────────────────────
export const LADDER = {
  MAX_LEVEL: 4,                          // 1 GHOST · 2 SHADOW · 3 CONTACT · 4 LOCK
  CLIMB_PER_SUCCESS: 1,
  FADE_PER_PULSE: 1,                     // −1 level per pulse without redetect
  GHOST_POS_ERROR_HEXES: 1,              // ±1 hex
  SAME_HEX_AUTO_LOCK: true,              // same hex / survived a battle ⇒ LOCK
  ARTY_AIR_TARGETING_MIN_LEVEL: 3,       // CONTACT −2, LOCK no penalty
  TARGETING_PENALTY_AT_CONTACT: -2,
  TARGETING_PENALTY_BELOW_CONTACT: -4,
} as const;
export const LADDER_NAMES = ['NONE', 'GHOST', 'SHADOW', 'CONTACT', 'LOCK'] as const;

// ── Readiness (core §3.2) ───────────────────────────────────────────────────
export const RDY = {
  START: 10,
  PER_BATTLE: -1,
  PER_BATTLE_LOST_EXTRA: -1,      // −2 total if it lost
  PER_DAY_UNSUPPLIED: -1,
  REST_RECOVERY_PER_PULSE: 2,     // in supply; +1 without supply
  REST_RECOVERY_UNSUPPLIED: 1,
  // Bands: [minRdy, maxRdy, TN penalty]
  BANDS: [
    { min: 8, max: 10, tnPenalty: 0 },
    { min: 5, max: 7, tnPenalty: 1 },
    { min: 2, max: 4, tnPenalty: 2, attackNeeds2d6: 8 },
    { min: 0, max: 1, tnPenalty: 2, routOnly: true },
  ],
} as const;

// ── Engagement & evasion (core §7) — constants parked for M2 ───────────────
export const ENGAGEMENT = {
  EVASION_GHOST_SHADOW_BONUS: 2,     // +2 if attacker only has GHOST/SHADOW
  EVASION_WIN_MARGIN: 3,             // winner by 3+ slips away (2 hexes), auto-CONTACT
  EVASION_SLIP_HEXES: 2,
  INTEL_INITIATIVE_PER_LEVEL: 1,     // +1 init per ladder-level advantage
  INTEL_INITIATIVE_TURNS: 3,
  REINFORCE_TURNS_PER_HEX: 5,        // friendly within N op-hexes arrives turn N×5
  QUICK_RES_BR_EDGE_PCT: 25,         // +1 per 25% BR edge
  QUICK_RES_DAMAGE_PCT_PER_DIFF: 5,  // loser takes diff ×5% of BR
  ROUT_UNCOMMANDABLE_PULSES: 2,
} as const;

// ── Battle handoff & pilots (core §7.2; spec §3.6) ──────────────────────────
export const COMBAT = {
  // default crew when no Pilot is assigned to a unit (regular MechWarrior, core/TW)
  PILOT_DEFAULT_GUNNERY: 4,
  PILOT_DEFAULT_PILOTING: 5,
  DIG_IN_PULSES: 2,                  // Dig In completes to DUG_IN after 2 pulses (core §4.1)
  ENGINEER_DIG_IN_FACTOR: 0.5,      // engineers halve the time (core §4.1, §9.3)
} as const;

// ── Artillery (core §9, App. A) ─────────────────────────────────────────────
export const ARTILLERY_RANGE_HEXES = {
  ARROW_IV: 8,
  SNIPER: 18,
  THUMPER: 21,
  LONG_TOM: 30,
  CRUISE_50: 50, CRUISE_70: 70, CRUISE_90: 90, CRUISE_120: 120,
} as const;
/** Unit tags that mark an artillery piece, mapped to its operational range key. */
export const ARTILLERY_TAG_RANGE: Record<string, number> = {
  ARROW_IV: ARTILLERY_RANGE_HEXES.ARROW_IV,
  SNIPER: ARTILLERY_RANGE_HEXES.SNIPER,
  THUMPER: ARTILLERY_RANGE_HEXES.THUMPER,
  LONG_TOM: ARTILLERY_RANGE_HEXES.LONG_TOM,
};
export const COUNTER_BATTERY_AUTO_CONTACT_LEVEL = 3; // firing hex revealed at CONTACT
// ── Combat drops (core §8.3) ─────────────────────────────────────────────────
export const COMBAT_DROP = {
  SCATTER_DICE: '1d6' as const,    // 1d6 hexes, reduced per point the Piloting check beats its TN
  PILOTING_TN: 5,                  // 2d6 ≥ TN; margin of success reduces scatter
  STORM_OR_ECM_SCATTER: 2,         // +2 hexes through a thunderstorm or ECM-heavy hex
  LIFT_UNDER_FIRE_PSR_MOD: 2,      // lifting from a contested hex: Piloting +2 (core §8.3)
} as const;
// ── Fire missions (core §9.1) — Quick-Resolution artillery when no battle is running ──
export const FIRES = {
  BR_DIVISOR: 5,            // 2d6 + battery BR/5 (core §9.1)
  HIT_TN: 6,               // ⚙ quick-resolution difficulty; set-piece batteries go to the table
  BIG_MARGIN: 4,           // ⚙ a margin ≥ this steps damage an extra notch
  SOFT_DOUBLE: true,       // infantry & soft vehicles suffer double (core §9.1)
  HARASSMENT_PER_PULSE: true,
} as const;

// ── Engineers & minefields (core §9.3) — parked for M2 ─────────────────────
export const ENGINEERING = {
  MINEFIELD_BITE_BR: 3,
  BREACH_PULSES: 2,
  BUILD_BRIDGE_PULSES: 4,
  DIG_IN_PULSES: 2,            // engineers halve
  DEMO_BRIDGE_SIG_MOD: -3,     // instant, loud
} as const;

// ── Logistics (core §10) ────────────────────────────────────────────────────
export const SUPPLY = {
  SP_PER_FORMATION_PER_DAY: 1,
  COMBAT_OR_FORCED_MARCH_MULT: 2,
  SUPPLY_LINE_MAX_HEXES: 30,        // ½ off-road
  SUPPLY_LINE_OFFROAD_FACTOR: 0.5,
  CONVOY_SP_PER_TRUCK_FORMATION: 10,
  CONVOY_OMP: 3,
  CONVOY_SIG: 5,
  REARM_SP_PER_UNIT: 1,
  SALVAGE_RECOVER_TN: 8,            // 2d6 ≥ 8 ⇒ repairable unit, else 2 SP of parts
  SALVAGE_FAIL_SP: 2,
  LOSTECH_REPAIR_TN: 8,
  FACTORY_SP_PER_DAY: 2,
} as const;

// ── Recon & deception (ext): the last dead tags come alive ──────────────────
export const RECON_TRICKS = {
  SHADOW_STANDOFF_HEXES: 2,   // a SHADOW order trails its contact, never closer than this
  C3_INITIATIVE_BONUS: 1,     // a live C3 master network: +1 initiative in the handoff
  DECOY_SIZE_CLASS_BUMP: 1,   // a DECOY unit makes the formation read one size bigger
} as const;

// ── Flak (ext): AA bites at the interface points ─────────────────────────────
// The air layer is one hex per theater, so tactical AA cannot reach HIGH-band transit —
// it engages aircraft coming LOW over a specific ground hex: launches, landings, drops.
export const FLAK = {
  RANGE_HEXES: 2,          // an AA formation's umbrella: its hex + 2
  TN: 8,                   // one logged 2d6 per battery; ≥ TN ⇒ a hit
  DROP_SCATTER_EXTRA: 2,   // dropping through flak scatters worse (like a storm)
  REVEAL_LEVEL: 3,         // firing reveals the battery at CONTACT (counter-battery rule)
} as const;

// ── Atmospheric interface (ext): the orbit ↔ air seam ───────────────────────
export const ATMO = {
  DESCENT_TICKS: 3,   // re-entry: ~18 min from orbit to the HIGH band (aerobraking)
  DESCENT_FP: 20,     // the braking burn — the atmosphere does most of the work
  ASCENT_TICKS: 6,    // climbing the well: ~36 min of hard burn to orbit
  ASCENT_FP: 80,      // and it costs — the expensive direction
} as const;

// ── The career loop (ext): pilots that live, wrecks that come home ──────────
export const CAREER = {
  // pilot XP: awarded on battle ingest to surviving crews
  XP_SURVIVE: 1,                    // walked (or flew) away from the battle
  XP_WIN: 1,                        // extra when their side held the field
  XP_PER_KILL: 2,                   // per kill credited in the result
  XP_PER_IMPROVEMENT: 8,            // every N XP the weaker of gunnery/piloting improves
  GUNNERY_FLOOR: 1,                 // regular 4/5 grows toward elite; nobody goes below
  PILOTING_FLOOR: 2,
  ACE_KILLS: 5,                     // kills at which the ace flag turns on (SKYWATCH 11)
  WOUND_RECOVERY_DAYS: 3,           // bed rest PER HIT taken (2 hits ⇒ 6 days)
  WOUND_RECOVERY_DAYS_MASH: 1,      // …per hit when the side fields a live MASH unit
  // the repair economy: fix a unit at a repair-capable facility (or a carrier's bay)
  REPAIR: {
    DAMAGED:  { DAYS: 1, SP: 1 },
    CRIPPLED: { DAYS: 3, SP: 2 },
  },
  REFIT: { DAYS: 4, SP: 3 },        // a recovered wreck → a serviceable unit
  REPAIR_FACILITY_TAGS: ['DEPOT', 'FACTORY', 'SPACEPORT'],
} as const;

// ── Satellites (core §8.6) ──────────────────────────────────────────────────
export const SATELLITE = {
  PASS_EVERY_PULSES: 4,
  TRACK_WIDTH_HEXES: 10,
} as const;

// ── Orbital control thresholds (core §8.2) — parked for M3 ─────────────────
export const ORBITAL_CONTROL = {
  SUPREMACY_RATIO: 3 / 1,
  SUPERIORITY_RATIO: 3 / 2,
  CONTESTED_INTERCEPT_TN: 8,
  DENIED_INTERCEPT_TN: 6,
} as const;

// ── Victory points (core §12.1) ─────────────────────────────────────────────
export const VP_PER_DAY = {
  SPACEPORT: 3,
  CAPITAL_CITY: 3,
  FACTORY: 2,
  HPG: 2,
  DEPOT: 1,
  NAMED_TERRAIN: 1,
} as const;

// ── Special assets (core §11) ───────────────────────────────────────────────
export const SPECIAL = {
  DECOY_FAKED_SIZE_CLASSES: 1,      // decoys imitate one size class larger
  NET_INTRUSION_TN: 10,             // EW truck vs enemy on ACTIVE: 10+ steals a report
  HIDDEN_INFANTRY_URBAN_WOODS_SIG: 13,
  LISTENING_POST_PASSIVE: 4,
  MASH_PILOT_RETURN_DAYS: 2,
} as const;

// ════════════════════════════════════════════════════════════════════════════
// §M1 — SKYWATCH (Module 1) — mirrors the SKYWATCH quick-reference appendix.
// ════════════════════════════════════════════════════════════════════════════
export const SKYWATCH = {
  // ── §1 sky grid & altitude ladder ──
  AIR_HEX_KM: 18,
  AIR_TURNS_PER_TICK: 6,            // 1 air turn = 60 s; 1 contact turn = 6 air turns
  BAND_LEVELS: { DECK: [1, 1], LOW: [2, 4], HIGH: [5, 7], SUBORBITAL: [8, 10] } as
    Record<string, [number, number]>,
  CRUISE_ALT_LEVEL: 6,              // representative HIGH-band level (climb to HIGH = 12 FP)
  CLIMB_FP_PER_LEVEL: 2,
  TO_ORBIT_FP: 30,                  // climb + circularization
  FROM_ORBIT_FP: 35,                // deorbit burn + descent control + approach
  DESCEND_IN_ATMO_FP: 0,            // trade altitude for speed
  // mid-battle map transitions only — handoff itself is 1:1 (D-010.3)
  MAP_CHANGE_DOWN_MULT: 2, MAP_CHANGE_UP_DIV: 2,

  // ── §2 the flight ledger ──
  FP_PER_TON: 80,
  TAKEOFF_VSTOL_FP: 10, TAKEOFF_RUNWAY_FP: 4,
  LANDING_VSTOL_FP: 5, LANDING_RUNWAY_FP: 2,
  CRUISE_FP_PER_HEX: 1, CRUISE_HEX_PER_MIN: 2,   // 12 hexes per contact turn
  // ext: a spheroid in atmosphere stands on its drive plume — 1 air hex per contact
  // turn, cruise or dash. Fast repositioning is the orbital hop: ASCEND, cross, DESCEND.
  SPHEROID_ATMO_HEX_PER_TICK: 1,
  // ext: CAS on call — flights holding a ground-attack mission near the battle show up
  // in the handoff as off-board air support
  CAS_ON_CALL: {
    MAX_AIR_HEXES: 24,   // within ~2 turns' flight of the battle theater's air hex
    HEXES_PER_TURN: 12,  // cruise: how fast "on call" becomes "overhead"
  },
  DASH_FP_PER_HEX: 2,                            // speed: Safe Thrust hexes/min
  LOITER_FP_PER_MIN: 2, LEAN_LOITER_FP_PER_MIN: 1,
  ORBIT_LOITER_FP: 0,
  // conventional fighters sip fuel: halve transit/loiter; takeoff/climb/landing full
  // (D-010.4 — the spec's "160 FP/ton conv" is the same advantage expressed once)
  CONV_FIGHTER_COST_FACTOR: 0.5,

  // ── §3 airbases, turnaround & the fuel farm ──
  TURNAROUND_PULSES: 2,             // rearm + refuel one flight (≤6 fighters)
  HOT_PIT_PULSES: 1,                // refuel + external ordnance only
  HOT_PIT_MISHAP_MAX: 3,            // 2d6 ≤ 3 ⇒ mishap
  HOT_PIT_MISHAP_FARM_FP_PER_D6: 10, // mishap costs 1d6 × 10 FP of farm stock
  HOT_PIT_MISHAP_STAND_DOWN_PULSES: 1,
  CREW_FLIGHT_MAX_AIRCRAFT: 6,
  SP_TO_AVIATION_FUEL_TONS: 2,      // 1 SP → 2 tons at a depot
  FARM_TORCH_TICKS: 1,

  // ── §3.1 alert states ──
  // launch delay is measured from the scramble call; fatigue per pulse standing the
  // alert. D-010.1: rates anchored on the §12 worked day (Fatigue 3); §11's
  // "+1 per 4 pulses at ALERT-5" is irreconcilable with §12 and loses.
  ALERT: {
    ALERT5:     { launchDelayTicks: 0,  fatiguePerPulse: 1,   idleFpPerPulse: 5 },
    ALERT15:    { launchDelayTicks: 1,  fatiguePerPulse: 0.5, idleFpPerPulse: 0 },
    ALERT60:    { launchDelayTicks: 10, fatiguePerPulse: 0,   idleFpPerPulse: 0 },
    STAND_DOWN: { launchDelayTicks: 20, fatiguePerPulse: 0,   idleFpPerPulse: 0 },
  } as Record<string, { launchDelayTicks: number; fatiguePerPulse: number; idleFpPerPulse: number }>,
  ORBITAL_STANDBY_RESPONSE_TICKS: 3,

  // ── §5 seeing the sky ──
  AIR_SIG: { FLIGHT_3_6: 6, PAIR: 8, SINGLE: 9, DROPSHIP_THRUST: 3, SKYEYE: 5 },
  AIR_SIG_MODS: { DASH_OR_CLIMB: -2, LEAN_LOITER: 1, BALLISTIC_GLIDE: 3 },
  // D-037 (congruent sky): the air grid maps 1:1 onto the ground map, so radar horizons
  // are real radii. A ground formation sees the HIGH band ~216 km out; a sensor station
  // or Mobile HQ doubles that. Radar coverage becomes geography you can route around.
  RADAR_HORIZON: {
    HIGH_BAND_AIR_HEXES: 12,        // any ground formation: HIGH band within 12 air hexes
    STATION_HQ_BONUS_AIR_HEXES: 12, // sensor stations & Mobile HQs reach 24
    LOW_BAND_OP_HEXES: 6,           // under-the-radar: LOW band only within 6 hexes
  },
  AIR_TO_AIR_DETECT_AIR_HEXES: 1,   // fighters resolve air targets in own + adjacent hex (D-010.6)
  SKYEYE_SENSOR: { passive: 6, active: 12 },
  MIN_PLOT_INTERCEPT_LEVEL: 2,      // you cannot plot an interception against < SHADOW

  // ── §6 scramble & chase ──
  AIR_CONTACT_CLOCK_RANGE: 3,       // air activity this close to the enemy ⇒ contact turns (D-010.7)
  ORBIT_CLIMB_GAUNTLET: { burnTicks: 2, sigMod: -2, freeInterceptRangeHexes: 2 },

  // ── §7 the merge ──
  ENTRY_VELOCITY_CRUISE: 2,         // dash = Safe Thrust; glide = 2 + 1/level dropped
  ENTRY_VELOCITY_GLIDE_BASE: 2,
  ENERGY_INIT_TIE_TURNS: 3,         // higher Energy wins init ties 3 turns + may decline pass
  JOKER_MULT: 1.25,                 // RTB-at-dash cost × 1.25 (transit only — §12: 36 hexes ⇒ 90)
  BINGO_MULT: 1.10,                 // RTB-at-cruise cost × 1.10
  BINGO_DISENGAGE_TURNS: 3,
  FUMES: { DEADSTICK_PSR_MOD: 4, DEADSTICK_RUNWAY_MOD: 2, CRASH_SURVIVAL_TN: 8, EJECT_TN: 5 },

  // ── §8 after the merge ──
  ACE_KILLS: 5, ACE_LOSS_WING_RDY: -1, CAPTURED_CREW_ATO_PAGES: 1,

  // ── §9–§10 air-to-ground & DropShips ──
  STRIKE_MIN_LEVEL: 3,              // strikes need ≥ CONTACT
  STRIKE_AT_CONTACT_TO_HIT_MOD: -2, // vs CONTACT: −2 on the table; vs LOCK clean
  DROP_DESCENT_TICKS: 2,
  DROP_SCATTER_PER_ESCORT_LOST_HEXES: 2,
  ORBITAL_FIRE_PREDICTABLE_TICKS: 3,
  TANKER_DELIVERY_RATIO: 0.5,       // 1 ton delivered per 2 tons carried

  // ── §11 crews ──
  FATIGUE_PER_SORTIE: 1,
  FATIGUE_PER_EJECTION: 2,
  FATIGUE_TN_PENALTY_AT: 4,
  FATIGUE_GROUNDED_AT: 7,
  STAND_DOWN_DAY_CLEARS: 4,         // implemented as −1 per 6 pulses at STAND_DOWN
} as const;

// ════════════════════════════════════════════════════════════════════════════
// §M2 — DEEP SKY (Module 2) — mirrors the DEEP SKY quick-reference appendix.
// ════════════════════════════════════════════════════════════════════════════
export const DEEPSKY = {
  // ── §2 transit: the burn ──
  BRACHISTOCHRONE_COEFF: 2.835,     // T(days) = 2.835 × √(AU ÷ G); flip at midpoint
  // physics anchors for the integrator (NOT house-ruleable without breaking the math)
  KPS_PER_BURN_DAY_1G: 847.3,       // 9.80665 m/s² × 86400 s
  AU_PER_DAY_PER_KPS: 86400 / 1.496e8,
  // ⚙ crew costs of riding the torch (DEEP SKY §2)
  BURN_RDY: {
    MIL_1_5G_DAYS_PER_RDY: 2,       // −1 formation RDY per 2 days at 1.5G
    MIL_2G_DAYS_PER_RDY: 1,         // −1 per day at 2G
    HARD_BURN_MIN_G: 3,             // 3G+ requires acceleration couches
    HARD_BURN_EMBARKED_RDY: -2,     // ground troops arrive at −2 RDY
    HARD_BURN_MEDICAL_TN: 4,        // daily 2d6 ≥ 4 or a medical casualty
  },
  STATION_KEEPING_G: 0.1,           // the best a JumpShip can do

  // ── §3 strategic fuel: the burn-day ledger ──
  TONS_PER_BURN_DAY_DEFAULT: 1.84,  // most military DropShips at 1G
  TACTICAL_FP_PER_TON_LARGE: 30,    // large DropShips/WarShips at handoff
  STATION_TRANSFER_TONS_PER_WATCH: 100,
  SKIM: { D6_X_TONS_PER_WATCH: 10, PILOTING_TN: 7 },  // gas giant scooping (TN: D-011)
  WATER_CRACK_2D6_TONS_PER_WATCH: true,

  // ── §4 seeing the system ──
  // ⚙ D-011.1: §4.2 says 10 min/AU but §9.1 (and the M4 acceptance) demand the flash
  // at 10 AU land 83 minutes later — real light, 8.3 min/AU. The worked example wins.
  LIGHT_LAG_MIN_PER_AU: 8.3,
  WATCH_STALE_AU: 6,                // at Watch scale, ≥6 AU is one Watch stale
  COLD_COAST_SIG: 11,               // per watch per searcher
  BELT_SECTOR_SIG_MOD: 1,           // +1 drifting through a belt
  STATION_KEEPING_SIG: 8,
  PICKET_ACTIVE_TN_MOD: -2,         // active sweep resolves coasters at TN −2 near its node
  PICKET_RANGE_AU: 1,               // "within its node" (D-011)
  FALSE_FLAG_TN: 9,                 // hold the lie per close inspection
  SENTINEL_DRONE: { TONS: 5, TRIGGER_AU: 0.05, SIG: 12 },
  PASSIVE_ARRAY_STALENESS_FACTOR: 0.5,
  BURN_DETECT_MIN_G: 1,             // 1G+ drives are automatic, after light lag
  EMISSION_CONTACT_LEVEL: 2,        // flash/burn reveal position+vector+mass class (SHADOW)

  // ── §5 the encounter classifier ──
  CLASSIFIER: {
    MATCHED_MM_FACTOR: 2,           // MATCHED if interceptor MM ≥ 2 × gap
    SLASH_TURNS_BASE: 4,            // slashing pass: 1d6 + 4 tabletop turns
    BLOCKADE_REST_KPS: 10,          // "both effectively at rest" tolerance
  },

  // ── §7 jump operations: the door ──
  JUMP: {
    RECHARGE_HRS_BY_CLASS: { M: 200, K: 190, G: 180, F: 170, A: 155 } as Record<string, number>,
    RECHARGE_HRS_RANGE: [151, 210] as [number, number],
    STATION_TRANSFER_HRS: 150,
    QUICK_CHARGE: { TN: 8, WATCHES: 5, KF_DAMAGE_MAX: 3 },
    EMERGENCY_FURL: { WATCHES: 2, LOSE_CHARGE_MAX: 5 },  // 2d6 ≤5 ⇒ charge to 0
    PIRATE_POINT: { TN: 9, SURVEYED_TN: 7, MISJUMP_MAX: 4 },
  },
  TABOO: { JUMPSHIP_KILL_VP: -10, JUMPSHIP_CAPTURE_VP: 15 },  // + a Reprisal event

  // ── §6 the capital handoff ──
  FRESHER_LIGHT_INIT_BONUS: 1,      // lower staleness at commit ⇒ +1 init for 3 turns
  FRESHER_LIGHT_INIT_TURNS: 3,

  // ── §9 the system campaign: objective menu (VP/day or one-shot) ──
  VP: {
    JUMP_POINT_PER_DAY: 2, RECHARGE_STATION_PER_DAY: 2, GAS_GIANT_REFINERY_PER_DAY: 1,
    SHIPYARD_PER_DAY: 3, CONVOY_DELIVERED: 3, CONVOY_DESTROYED: 3,
    WARSHIP_CRIPPLED: 5, JUMPSHIP_CAPTURED: 15, SURVEY_STOLEN: 5,
  },
} as const;
