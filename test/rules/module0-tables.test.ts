/**
 * Group A — rules.ts vs the Module 0 quick reference (Appendix A + body tables).
 * The rulebook is the spec: every assertion cites its source.
 */
import { describe, expect, it } from 'vitest';
import {
  ARTILLERY_RANGE_HEXES, BASE_SIG, CLOCK, CONTACT_MODE_RANGE_HEXES, ENGAGEMENT,
  LADDER, MOVEMENT, NET, RDY, ROAD_COST_FACTOR, ROAD_MIN_COST, SATELLITE,
  SEARCHER_MODS, SENSOR_RANGES, SIG_MODS, SUPPLY, TERRAIN, VP_PER_DAY,
} from '../../src/rules.js';

describe('A1 — clock constants (core §2, App. A; spec §1.1)', () => {
  it('contact turn 6 min; pulse = 10 ticks; watch = 60; day = 240', () => {
    expect(CLOCK.TICK_MINUTES).toBe(6);
    expect(CLOCK.TICKS_PER_PULSE).toBe(10);
    expect(CLOCK.TICKS_PER_WATCH).toBe(60);
    expect(CLOCK.TICKS_PER_DAY).toBe(240);
  });
  it('contact mode within 5 op-hexes (core §2.2)', () => {
    expect(CONTACT_MODE_RANGE_HEXES).toBe(5);
  });
  it('default dawn 0600 / dusk 1800 (core §1.1 spec)', () => {
    expect(CLOCK.DEFAULT_DAWN_TICK).toBe(60);
    expect(CLOCK.DEFAULT_DUSK_TICK).toBe(180);
  });
});

describe('A2 — base SIG by size (core §3.1)', () => {
  it('Bn 5 / Co 6 / Lance 7 / single 9 / squad 10', () => {
    expect(BASE_SIG.BATTALION).toBe(5);
    expect(BASE_SIG.COMPANY).toBe(6);
    expect(BASE_SIG.LANCE).toBe(7);
    expect(BASE_SIG.SINGLE).toBe(9);
    expect(BASE_SIG.SQUAD).toBe(10);
  });
});

describe('A3 — target SIG modifiers (core §6.1, §6.3, §5.2)', () => {
  it('motion: moving −1, forced march/sprint −2, jump −2, fired −3', () => {
    expect(SIG_MODS.MOVING).toBe(-1);
    expect(SIG_MODS.FORCED_MARCH).toBe(-2);
    expect(SIG_MODS.SPRINT).toBe(-2);
    expect(SIG_MODS.JUMP_JETS).toBe(-2);
    expect(SIG_MODS.FIRED_THIS_TURN).toBe(-3);
  });
  it('posture: hide +2, dug in +1, cautious move +2 (D-006)', () => {
    expect(SIG_MODS.HIDE).toBe(2);
    expect(SIG_MODS.DUG_IN).toBe(1);
    expect(SIG_MODS.MOVE_CAUTIOUS).toBe(2);
  });
  it('EMCON: DARK +2, ACTIVE −2 (core §6.1)', () => {
    expect(SIG_MODS.EMCON_DARK).toBe(2);
    expect(SIG_MODS.EMCON_ACTIVE).toBe(-2);
  });
  it('environment: night +2 (passive; D-006), rain +1', () => {
    expect(SIG_MODS.NIGHT_PASSIVE).toBe(2);
    expect(SIG_MODS.RAIN).toBe(1);
  });
  it('equipment: Guardian +1, Angel +2, stealth +2', () => {
    expect(SIG_MODS.ECM_GUARDIAN).toBe(1);
    expect(SIG_MODS.ECM_ANGEL).toBe(2);
    expect(SIG_MODS.STEALTH_ARMOR).toBe(2);
  });
  it('terrain SIG: woods/swamp +1, urban +2 (infantry +3), road movement −1', () => {
    expect(TERRAIN.WOODS.sigMod).toBe(1);
    expect(TERRAIN.SWAMP.sigMod).toBe(1);
    expect(TERRAIN.URBAN.sigMod).toBe(2);
    expect(TERRAIN.URBAN.infantrySigMod).toBe(3);
    expect(SIG_MODS.ROAD_MOVEMENT).toBe(-1);
  });
});

describe('A4 — searcher modifiers (core §6.3)', () => {
  it('ACTIVE +2, Patrol +1', () => {
    expect(SEARCHER_MODS.EMCON_ACTIVE).toBe(2);
    expect(SEARCHER_MODS.PATROL_ORDER).toBe(1);
  });
});

describe('A5 — sensor ranges (core §6.2)', () => {
  it('standard 2/4, Beagle 3/5, recon VTOL 4/8, Mobile HQ 4/8, station 6/12', () => {
    expect(SENSOR_RANGES.MECH_STANDARD).toEqual({ passive: 2, active: 4 });
    expect(SENSOR_RANGES.BEAGLE).toEqual({ passive: 3, active: 5 });
    expect(SENSOR_RANGES.RECON_VTOL).toEqual({ passive: 4, active: 8 });
    expect(SENSOR_RANGES.MOBILE_HQ).toEqual({ passive: 4, active: 8 });
    expect(SENSOR_RANGES.SENSOR_STATION).toEqual({ passive: 6, active: 12 });
  });
  it('Mk1 Eyeball 3 (1 at night); recon corridor 5; satellite track 10', () => {
    expect(SENSOR_RANGES.EYEBALL).toEqual({ day: 3, night: 1 });
    expect(SENSOR_RANGES.RECON_AIR_CORRIDOR_WIDTH).toBe(5);
    expect(SENSOR_RANGES.SATELLITE_TRACK_WIDTH).toBe(10);
  });
});

describe('A6 — terrain table (core §5.2)', () => {
  it('OMP costs: clear 1, woods 2, rough 2, hills 2, mountain 3, swamp 3, urban 1', () => {
    expect(TERRAIN.CLEAR.ompCost).toBe(1);
    expect(TERRAIN.WOODS.ompCost).toBe(2);
    expect(TERRAIN.ROUGH.ompCost).toBe(2);
    expect(TERRAIN.HILLS.ompCost).toBe(2);
    expect(TERRAIN.MOUNTAIN.ompCost).toBe(3);
    expect(TERRAIN.SWAMP.ompCost).toBe(3);
    expect(TERRAIN.URBAN.ompCost).toBe(1);
  });
  it('water impassable to ground; hover free over water/swamp; mountain blocks hover', () => {
    expect(TERRAIN.WATER.ompCost).toBeNull();
    expect(TERRAIN.WATER.hoverCost).toBe(1);
    expect(TERRAIN.SWAMP.hoverCost).toBe(1);
    expect(TERRAIN.MOUNTAIN.hoverCost).toBeNull();
    expect(TERRAIN.MOUNTAIN.mechInfantryOnly).toBe(true);
  });
  it('roads: ½ cost min 1; LOS blocked by hills/mountain/urban', () => {
    expect(ROAD_COST_FACTOR).toBe(0.5);
    expect(ROAD_MIN_COST).toBe(1);
    expect(TERRAIN.HILLS.blocksLos).toBe(true);
    expect(TERRAIN.MOUNTAIN.blocksLos).toBe(true);
    expect(TERRAIN.URBAN.blocksLos).toBe(true);
    expect(TERRAIN.CLEAR.blocksLos).toBe(false);
    expect(TERRAIN.WOODS.blocksLos).toBe(false);
  });
});

describe('A7 — movement rates (core §2.3, §3.3, §5.1)', () => {
  it('pulse: ×10 road / ×5 cross-country; forced march ×1.5 with RDY −1/pulse', () => {
    expect(MOVEMENT.PULSE_ROAD_MULT).toBe(10);
    expect(MOVEMENT.PULSE_CROSS_COUNTRY_MULT).toBe(5);
    expect(MOVEMENT.FORCED_MARCH_MULT).toBe(1.5);
    expect(MOVEMENT.FORCED_MARCH_RDY_PER_PULSE).toBe(-1);
  });
  it('sprint 1 turn in 3; wheeled ×2 off-road; VTOL ×2; support OMP 2; rail 12', () => {
    expect(MOVEMENT.SPRINT_TURN_RATIO).toBe(3);
    expect(MOVEMENT.WHEELED_OFFROAD_FACTOR).toBe(2);
    expect(MOVEMENT.VTOL_OMP_MULT).toBe(2);
    expect(MOVEMENT.SUPPORT_OMP).toBe(2);
    expect(MOVEMENT.RAIL_OMP).toBe(12);
  });
  it('cautious move at half speed (D-006)', () => {
    expect(MOVEMENT.CAUTIOUS_SPEED_FACTOR).toBe(0.5);
  });
  it('air multipliers: conventional ×8, ASF ×16, DropShip atmo ×8 (core §5.1)', () => {
    expect(MOVEMENT.CONV_FIGHTER_OMP_MULT).toBe(8);
    expect(MOVEMENT.ASF_OMP_MULT).toBe(16);
    expect(MOVEMENT.DROPSHIP_ATMO_OMP_MULT).toBe(8);
  });
});

describe('A8 — contact ladder (core §6.4)', () => {
  it('climb 1 per success to max 4; fade 1 per pulse; GHOST ±1; same-hex LOCK', () => {
    expect(LADDER.MAX_LEVEL).toBe(4);
    expect(LADDER.CLIMB_PER_SUCCESS).toBe(1);
    expect(LADDER.FADE_PER_PULSE).toBe(1);
    expect(LADDER.GHOST_POS_ERROR_HEXES).toBe(1);
    expect(LADDER.SAME_HEX_AUTO_LOCK).toBe(true);
  });
  it('targeting: LOCK clean, CONTACT −2, below −4 (core §8.4/§9.1)', () => {
    expect(LADDER.ARTY_AIR_TARGETING_MIN_LEVEL).toBe(3);
    expect(LADDER.TARGETING_PENALTY_AT_CONTACT).toBe(-2);
    expect(LADDER.TARGETING_PENALTY_BELOW_CONTACT).toBe(-4);
  });
});

describe('A9 — command nets (core §4.2)', () => {
  it('12 ground node / 24 DropShip-base / theater-wide comm sat; re-net 1 pulse', () => {
    expect(NET.GROUND_NODE_RADIUS).toBe(12);
    expect(NET.DROPSHIP_BASE_RADIUS).toBe(24);
    expect(NET.COMM_SAT_THEATER_WIDE).toBe(true);
    expect(NET.RENET_PULSES).toBe(1);
  });
});

describe('A10 — remaining Appendix A rows parked for later milestones', () => {
  it('artillery ranges: Arrow IV 8, Sniper 18, Thumper 21, Long Tom 30, cruise 50–120', () => {
    expect(ARTILLERY_RANGE_HEXES.ARROW_IV).toBe(8);
    expect(ARTILLERY_RANGE_HEXES.SNIPER).toBe(18);
    expect(ARTILLERY_RANGE_HEXES.THUMPER).toBe(21);
    expect(ARTILLERY_RANGE_HEXES.LONG_TOM).toBe(30);
    expect(ARTILLERY_RANGE_HEXES.CRUISE_50).toBe(50);
    expect(ARTILLERY_RANGE_HEXES.CRUISE_70).toBe(70);
    expect(ARTILLERY_RANGE_HEXES.CRUISE_90).toBe(90);
    expect(ARTILLERY_RANGE_HEXES.CRUISE_120).toBe(120);
  });
  it('RDY bands (core §3.2): 8–10 clean, 5–7 +1, 2–4 +2 & attack on 8+, 0–1 rout', () => {
    expect(RDY.START).toBe(10);
    expect(RDY.BANDS).toEqual([
      { min: 8, max: 10, tnPenalty: 0 },
      { min: 5, max: 7, tnPenalty: 1 },
      { min: 2, max: 4, tnPenalty: 2, attackNeeds2d6: 8 },
      { min: 0, max: 1, tnPenalty: 2, routOnly: true },
    ]);
  });
  it('supply (core §10): 1 SP/day (×2 fighting), line ≤30 hexes (½ off-road)', () => {
    expect(SUPPLY.SP_PER_FORMATION_PER_DAY).toBe(1);
    expect(SUPPLY.COMBAT_OR_FORCED_MARCH_MULT).toBe(2);
    expect(SUPPLY.SUPPLY_LINE_MAX_HEXES).toBe(30);
    expect(SUPPLY.SUPPLY_LINE_OFFROAD_FACTOR).toBe(0.5);
    expect(SUPPLY.CONVOY_SP_PER_TRUCK_FORMATION).toBe(10);
    expect(SUPPLY.CONVOY_OMP).toBe(3);
    expect(SUPPLY.CONVOY_SIG).toBe(5);
  });
  it('VP values (core §12.1)', () => {
    expect(VP_PER_DAY).toEqual({
      SPACEPORT: 3, CAPITAL_CITY: 3, FACTORY: 2, HPG: 2, DEPOT: 1, NAMED_TERRAIN: 1,
    });
  });
  it('satellite: pass every 4 pulses, 10-wide track (core §8.6)', () => {
    expect(SATELLITE.PASS_EVERY_PULSES).toBe(4);
    expect(SATELLITE.TRACK_WIDTH_HEXES).toBe(10);
  });
  it('engagement constants for M2 (core §7): evasion, intel initiative, quick res', () => {
    expect(ENGAGEMENT.EVASION_GHOST_SHADOW_BONUS).toBe(2);
    expect(ENGAGEMENT.EVASION_WIN_MARGIN).toBe(3);
    expect(ENGAGEMENT.INTEL_INITIATIVE_PER_LEVEL).toBe(1);
    expect(ENGAGEMENT.INTEL_INITIATIVE_TURNS).toBe(3);
    expect(ENGAGEMENT.REINFORCE_TURNS_PER_HEX).toBe(5);
    expect(ENGAGEMENT.QUICK_RES_DAMAGE_PCT_PER_DIFF).toBe(5);
  });
});
