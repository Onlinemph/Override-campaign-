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
export const MOVEMENT = {
  PULSE_ROAD_MULT: 10,          // OMP × 10 hexes per pulse on roads
  PULSE_CROSS_COUNTRY_MULT: 5,  // OMP × 5 cross-country
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
  GROUND_NODE_RADIUS: 12,
  DROPSHIP_BASE_RADIUS: 24,     // grounded DropShip / fixed base
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

// ── Artillery (core §9, App. A) ─────────────────────────────────────────────
export const ARTILLERY_RANGE_HEXES = {
  ARROW_IV: 8,
  SNIPER: 18,
  THUMPER: 21,
  LONG_TOM: 30,
  CRUISE_50: 50, CRUISE_70: 70, CRUISE_90: 90, CRUISE_120: 120,
} as const;
export const COUNTER_BATTERY_AUTO_CONTACT_LEVEL = 3; // firing hex revealed at CONTACT

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
// §M1 — SKYWATCH (Module 1) — constants land here at Milestone 3.
// (Fuel ledger costs, alert states, merge rules, crew fatigue — per the SKYWATCH
//  quick reference. Placeholder kept so rules.ts structure is stable.)
// ════════════════════════════════════════════════════════════════════════════
export const SKYWATCH = {} as const;

// ════════════════════════════════════════════════════════════════════════════
// §M2 — DEEP SKY (Module 2) — constants land here at Milestone 4.
// (Brachistochrone constant 2.835, light lag 10 min/AU, burn-day rates, jump board,
//  encounter classifier thresholds — per the DEEP SKY quick reference.)
// ════════════════════════════════════════════════════════════════════════════
export const DEEPSKY = {} as const;
