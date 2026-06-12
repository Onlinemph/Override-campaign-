/**
 * Module 2 (DEEP SKY) quick-reference appendix vs rules.ts, plus the published
 * physics anchors computed from the constants.
 */
import { describe, expect, it } from 'vitest';
import { DEEPSKY } from '../../src/rules.js';
import { noFlipDays, transitDays } from '../../src/engine/space.js';

describe('M2-tables — transit & the burn (DEEP SKY §2, appendix)', () => {
  it('T(days) = 2.835 × √(AU ÷ G); no-flip = half time, ballistic, slash-only', () => {
    expect(DEEPSKY.BRACHISTOCHRONE_COEFF).toBe(2.835);
    // a Sol-like (G2V) system: jump point to habitable zone ≈ 9–10 days at 1G (§2/§2.1)
    const sol = transitDays(10, 1);
    expect(sol).toBeCloseTo(8.97, 2);
    expect(sol).toBeGreaterThan(7);
    expect(sol).toBeLessThan(10);
    expect(noFlipDays(10, 1)).toBeCloseTo(sol / 2);
    // military burn: ÷√1.5 / ÷√2 (≈ −18% / −29% time)
    expect(transitDays(10, 1.5) / sol).toBeCloseTo(1 / Math.sqrt(1.5));
    expect(transitDays(10, 2) / sol).toBeCloseTo(1 / Math.sqrt(2));
  });
  it('crew G-limits: −1 RDY per 2 days at 1.5G, per day at 2G; hard burn 3G+', () => {
    expect(DEEPSKY.BURN_RDY.MIL_1_5G_DAYS_PER_RDY).toBe(2);
    expect(DEEPSKY.BURN_RDY.MIL_2G_DAYS_PER_RDY).toBe(1);
    expect(DEEPSKY.BURN_RDY.HARD_BURN_MIN_G).toBe(3);
    expect(DEEPSKY.BURN_RDY.HARD_BURN_EMBARKED_RDY).toBe(-2);
    expect(DEEPSKY.BURN_RDY.HARD_BURN_MEDICAL_TN).toBe(4);
    expect(DEEPSKY.STATION_KEEPING_G).toBe(0.1); // a JumpShip can do no better
  });
});

describe('M2-tables — strategic fuel (DEEP SKY §3, appendix)', () => {
  it('tons/burn-day × G while thrusting; 1.84 default; tactical ≈ 30 FP/ton', () => {
    expect(DEEPSKY.TONS_PER_BURN_DAY_DEFAULT).toBe(1.84);
    expect(DEEPSKY.TACTICAL_FP_PER_TON_LARGE).toBe(30);
    // a Union with 150 tons aboard has ~81 days of 1G endurance (§3)
    expect(150 / 1.84).toBeCloseTo(81.5, 0);
  });
  it('refueling: 100 t/watch docked; skim 1d6×10 t/watch; water cracking 2d6 t/watch', () => {
    expect(DEEPSKY.STATION_TRANSFER_TONS_PER_WATCH).toBe(100);
    expect(DEEPSKY.SKIM.D6_X_TONS_PER_WATCH).toBe(10);
    expect(DEEPSKY.WATER_CRACK_2D6_TONS_PER_WATCH).toBe(true);
  });
});

describe('M2-tables — seeing the system (DEEP SKY §4, appendix)', () => {
  it('light lag: 83 minutes at 10 AU (§9.1 / the M4 acceptance — D-011.1)', () => {
    expect(10 * DEEPSKY.LIGHT_LAG_MIN_PER_AU).toBe(83);
    expect(DEEPSKY.WATCH_STALE_AU).toBe(6); // ≥6 AU is one Watch stale at Watch scale
  });
  it('cold coast SIG 11 (+1 in a belt); station-keeping SIG 8; picket sweep −2', () => {
    expect(DEEPSKY.COLD_COAST_SIG).toBe(11);
    expect(DEEPSKY.BELT_SECTOR_SIG_MOD).toBe(1);
    expect(DEEPSKY.STATION_KEEPING_SIG).toBe(8);
    expect(DEEPSKY.PICKET_ACTIVE_TN_MOD).toBe(-2);
  });
  it('false flag holds on 9+; sentinel drones 5 t / 0.05 AU / SIG 12; 1G+ drives auto', () => {
    expect(DEEPSKY.FALSE_FLAG_TN).toBe(9);
    expect(DEEPSKY.SENTINEL_DRONE).toEqual({ TONS: 5, TRIGGER_AU: 0.05, SIG: 12 });
    expect(DEEPSKY.BURN_DETECT_MIN_G).toBe(1);
  });
});

describe('M2-tables — encounters (DEEP SKY §5, appendix)', () => {
  it('MATCHED needs MM ≥ 2 × gap; SLASH = 1d6+4 turns', () => {
    expect(DEEPSKY.CLASSIFIER.MATCHED_MM_FACTOR).toBe(2);
    expect(DEEPSKY.CLASSIFIER.SLASH_TURNS_BASE).toBe(4);
  });
  it('fresher light at commit ⇒ +1 initiative for 3 turns (§6)', () => {
    expect(DEEPSKY.FRESHER_LIGHT_INIT_BONUS).toBe(1);
    expect(DEEPSKY.FRESHER_LIGHT_INIT_TURNS).toBe(3);
  });
});

describe('M2-tables — jump ops & the taboo (DEEP SKY §7, appendix)', () => {
  it('recharge 151–210 hrs by star class (G ≈ 180); station transfer ~150 hrs', () => {
    const hrs = DEEPSKY.JUMP.RECHARGE_HRS_BY_CLASS;
    expect(hrs.G).toBe(180);
    for (const v of Object.values(hrs)) {
      expect(v).toBeGreaterThanOrEqual(DEEPSKY.JUMP.RECHARGE_HRS_RANGE[0]);
      expect(v).toBeLessThanOrEqual(DEEPSKY.JUMP.RECHARGE_HRS_RANGE[1]);
    }
    expect(DEEPSKY.JUMP.STATION_TRANSFER_HRS).toBe(150);
  });
  it('quick-charge 8+ in 5 watches, ≤3 hurts the drive; furl 2 watches, ≤5 loses charge', () => {
    expect(DEEPSKY.JUMP.QUICK_CHARGE).toEqual({ TN: 8, WATCHES: 5, KF_DAMAGE_MAX: 3 });
    expect(DEEPSKY.JUMP.EMERGENCY_FURL).toEqual({ WATCHES: 2, LOSE_CHARGE_MAX: 5 });
  });
  it('pirate points: 9+ (7+ with survey), ≤4 misjump', () => {
    expect(DEEPSKY.JUMP.PIRATE_POINT).toEqual({ TN: 9, SURVEYED_TN: 7, MISJUMP_MAX: 4 });
  });
  it('the JumpShip taboo: kill −10 VP + Reprisal; capture +15 VP', () => {
    expect(DEEPSKY.TABOO.JUMPSHIP_KILL_VP).toBe(-10);
    expect(DEEPSKY.TABOO.JUMPSHIP_CAPTURE_VP).toBe(15);
  });
  it('the objective menu (§9)', () => {
    expect(DEEPSKY.VP).toEqual({
      JUMP_POINT_PER_DAY: 2, RECHARGE_STATION_PER_DAY: 2, GAS_GIANT_REFINERY_PER_DAY: 1,
      SHIPYARD_PER_DAY: 3, CONVOY_DELIVERED: 3, CONVOY_DESTROYED: 3,
      WARSHIP_CRIPPLED: 5, JUMPSHIP_CAPTURED: 15, SURVEY_STOLEN: 5,
    });
  });
});
