/**
 * Module 1 (SKYWATCH) quick-reference appendix vs rules.ts, row by row,
 * plus the §2 worked baseline computed from the cost primitives.
 */
import { describe, expect, it } from 'vitest';
import { SKYWATCH } from '../../src/rules.js';

describe('M1-tables — fuel & the flight ledger (SKYWATCH §1–2, appendix)', () => {
  it('80 FP/ton; cruise 1 FP/hex, dash 2 (D-038: speeds are ST-per-turn, off the card)', () => {
    expect(SKYWATCH.FP_PER_TON).toBe(80);
    expect(SKYWATCH.CRUISE_FP_PER_HEX).toBe(1);
    expect(SKYWATCH.DASH_FP_PER_HEX).toBe(2);
  });
  it('CAP loiter 2 FP/min (lean 1); orbit 0; climb 2 FP/level; orbit ~30 up / ~35 down', () => {
    expect(SKYWATCH.LOITER_FP_PER_MIN).toBe(2);
    expect(SKYWATCH.LEAN_LOITER_FP_PER_MIN).toBe(1);
    expect(SKYWATCH.ORBIT_LOITER_FP).toBe(0);
    expect(SKYWATCH.CLIMB_FP_PER_LEVEL).toBe(2);
    expect(SKYWATCH.TO_ORBIT_FP).toBe(30);
    expect(SKYWATCH.FROM_ORBIT_FP).toBe(35);
    expect(SKYWATCH.DESCEND_IN_ATMO_FP).toBe(0);
  });
  it('takeoff/landing: V/STOL 10/5, runway 4/2; map change down ×2 up ÷2', () => {
    expect(SKYWATCH.TAKEOFF_VSTOL_FP).toBe(10);
    expect(SKYWATCH.LANDING_VSTOL_FP).toBe(5);
    expect(SKYWATCH.TAKEOFF_RUNWAY_FP).toBe(4);
    expect(SKYWATCH.LANDING_RUNWAY_FP).toBe(2);
    expect(SKYWATCH.MAP_CHANGE_DOWN_MULT).toBe(2);
    expect(SKYWATCH.MAP_CHANGE_UP_DIV).toBe(2);
  });
  it('conventional fighters halve transit/loiter costs', () => {
    expect(SKYWATCH.CONV_FIGHTER_COST_FACTOR).toBe(0.5);
  });
  it('the §2 worked baseline: Shilone 400 FP, 6-hex CAP mission costs exactly 150 FP', () => {
    // runway T-O (4) + climb to HIGH (12) + 6 out (6) + 60 min CAP (120) + 6 back (6)
    // + descend (0) + land (2) = 150 — leaving a 250 FP combat reserve
    const cost =
      SKYWATCH.TAKEOFF_RUNWAY_FP +
      SKYWATCH.CLIMB_FP_PER_LEVEL * SKYWATCH.CRUISE_ALT_LEVEL +
      6 * SKYWATCH.CRUISE_FP_PER_HEX +
      60 * SKYWATCH.LOITER_FP_PER_MIN +
      6 * SKYWATCH.CRUISE_FP_PER_HEX +
      SKYWATCH.DESCEND_IN_ATMO_FP +
      SKYWATCH.LANDING_RUNWAY_FP;
    expect(cost).toBe(150);
    expect(400 - cost).toBe(250);
  });
});

describe('M1-tables — response ladder & alert states (SKYWATCH §3.1, §4, appendix)', () => {
  it('launch delays: ALERT-5 now / -15 next CT / -60 one pulse / stand-down 2 pulses', () => {
    expect(SKYWATCH.ALERT.ALERT5.launchDelayTicks).toBe(0);
    expect(SKYWATCH.ALERT.ALERT15.launchDelayTicks).toBe(1);
    expect(SKYWATCH.ALERT.ALERT60.launchDelayTicks).toBe(10);
    expect(SKYWATCH.ALERT.STAND_DOWN.launchDelayTicks).toBe(20);
  });
  it('ALERT-5 idle burn 5 FP/pulse; orbital standby responds in 3 CT', () => {
    expect(SKYWATCH.ALERT.ALERT5.idleFpPerPulse).toBe(5);
    expect(SKYWATCH.ORBITAL_STANDBY_RESPONSE_TICKS).toBe(3);
  });
  it('alert fatigue rates anchored on the §12 worked day (D-010.1): A5 1/pulse, A15 ½/pulse', () => {
    expect(SKYWATCH.ALERT.ALERT5.fatiguePerPulse).toBe(1);
    expect(SKYWATCH.ALERT.ALERT15.fatiguePerPulse).toBe(0.5);
    // §12: 4 pulses of ALERT-15 (0500→0900) + 1 sortie = Fatigue 3
    expect(4 * SKYWATCH.ALERT.ALERT15.fatiguePerPulse + SKYWATCH.FATIGUE_PER_SORTIE).toBe(3);
  });
  it('turnaround: 2 pulses standard, 1 hot-pit; mishap on 2–3 costs 1d6×10 FP', () => {
    expect(SKYWATCH.TURNAROUND_PULSES).toBe(2);
    expect(SKYWATCH.HOT_PIT_PULSES).toBe(1);
    expect(SKYWATCH.HOT_PIT_MISHAP_MAX).toBe(3);
    expect(SKYWATCH.HOT_PIT_MISHAP_FARM_FP_PER_D6).toBe(10);
    expect(SKYWATCH.CREW_FLIGHT_MAX_AIRCRAFT).toBe(6);
    expect(SKYWATCH.SP_TO_AVIATION_FUEL_TONS).toBe(2);
  });
});

describe('M1-tables — merge setup & fuel discipline (SKYWATCH §7, appendix)', () => {
  it('entry velocity: cruise 2 (dash = Safe Thrust); energy init ties ×3 turns', () => {
    expect(SKYWATCH.ENTRY_VELOCITY_CRUISE).toBe(2);
    expect(SKYWATCH.ENTRY_VELOCITY_GLIDE_BASE).toBe(2);
    expect(SKYWATCH.ENERGY_INIT_TIE_TURNS).toBe(3);
  });
  it('JOKER = RTB-dash +25%; BINGO = RTB-cruise +10%; disengage within 3', () => {
    expect(SKYWATCH.JOKER_MULT).toBe(1.25);
    expect(SKYWATCH.BINGO_MULT).toBe(1.10);
    expect(SKYWATCH.BINGO_DISENGAGE_TURNS).toBe(3);
  });
  it('the §12 quote: 36 hexes home ⇒ JOKER 90', () => {
    expect(36 * SKYWATCH.DASH_FP_PER_HEX * SKYWATCH.JOKER_MULT).toBe(90);
  });
  it('FUMES: dead-stick PSR +4 (+2 runway), crash survival 8+, eject 5+', () => {
    expect(SKYWATCH.FUMES).toEqual({
      DEADSTICK_PSR_MOD: 4, DEADSTICK_RUNWAY_MOD: 2, CRASH_SURVIVAL_TN: 8, EJECT_TN: 5,
    });
  });
});

describe('M1-tables — seeing the sky (SKYWATCH §5, appendix)', () => {
  it('air SIG: flight 6 / pair 8 / single 9 / burning DropShip 3 / Skyeye 5', () => {
    expect(SKYWATCH.AIR_SIG).toEqual(
      { FLIGHT_3_6: 6, PAIR: 8, SINGLE: 9, DROPSHIP_THRUST: 3, SKYEYE: 5 });
  });
  it('burn brightness: dash/climb −2; lean loiter +1; ballistic glide +3', () => {
    expect(SKYWATCH.AIR_SIG_MODS).toEqual(
      { DASH_OR_CLIMB: -2, LEAN_LOITER: 1, BALLISTIC_GLIDE: 3 });
  });
  it('radar horizon (D-037 congruent sky): ground 12 air hexes, stations/HQ 24; LOW within 6', () => {
    expect(SKYWATCH.RADAR_HORIZON.HIGH_BAND_AIR_HEXES).toBe(12);
    expect(SKYWATCH.RADAR_HORIZON.STATION_HQ_BONUS_AIR_HEXES).toBe(12);
    expect(SKYWATCH.RADAR_HORIZON.LOW_BAND_OP_HEXES).toBe(6);
    expect(SKYWATCH.MIN_PLOT_INTERCEPT_LEVEL).toBe(2); // never plot vs < SHADOW
  });
});

describe('M1-tables — crews & after the merge (SKYWATCH §8, §11, appendix)', () => {
  it('fatigue: +1/sortie, +2/ejection; 4+ ⇒ +1 TNs; 7+ grounded; day of stand-down clears 4', () => {
    expect(SKYWATCH.FATIGUE_PER_SORTIE).toBe(1);
    expect(SKYWATCH.FATIGUE_PER_EJECTION).toBe(2);
    expect(SKYWATCH.FATIGUE_TN_PENALTY_AT).toBe(4);
    expect(SKYWATCH.FATIGUE_GROUNDED_AT).toBe(7);
    expect(SKYWATCH.STAND_DOWN_DAY_CLEARS).toBe(4);
  });
  it('aces at 5 kills; losing an ace −1 wing RDY; captured aircrew leaks one ATO page', () => {
    expect(SKYWATCH.ACE_KILLS).toBe(5);
    expect(SKYWATCH.ACE_LOSS_WING_RDY).toBe(-1);
    expect(SKYWATCH.CAPTURED_CREW_ATO_PAGES).toBe(1);
  });
  it('air-to-ground: strikes need ≥ CONTACT (−2 at CONTACT); drops & orbital fire windows', () => {
    expect(SKYWATCH.STRIKE_MIN_LEVEL).toBe(3);
    expect(SKYWATCH.STRIKE_AT_CONTACT_TO_HIT_MOD).toBe(-2);
    expect(SKYWATCH.DROP_DESCENT_TICKS).toBe(2);
    expect(SKYWATCH.DROP_SCATTER_PER_ESCORT_LOST_HEXES).toBe(2);
    expect(SKYWATCH.ORBITAL_FIRE_PREDICTABLE_TICKS).toBe(3);
    expect(SKYWATCH.TANKER_DELIVERY_RATIO).toBe(0.5);
  });
});
