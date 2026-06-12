/**
 * engine/logistics.ts — RDY recovery, Dig In, supply & rout upkeep (core §3.2, §4.1, §10).
 *
 * Pulse-rate effects (REST recovery, Dig In progress) apply at PULSE/WATCH scale; daily
 * effects (SP draw, out-of-supply attrition) are driven off each formation's
 * `lastSuppliedTick` so they fire correctly regardless of clock-compression step size.
 */
import { CLOCK, COMBAT, RDY, SUPPLY } from '../rules.js';
import type { Facility, Formation, GroundPos, TruthState } from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { hexDistance } from '../hex/axial.js';

function asHex(pos: { kind: string }): GroundPos | null {
  return pos.kind === 'ground' ? (pos as GroundPos) : null;
}

function isEngineer(s: TruthState, f: Formation): boolean {
  return f.unitIds.some(id => s.units[id]?.tags.includes('ENGINEER'));
}

/** A stocked friendly depot within straight-line supply range (core §10.2, simplified). */
function inSupplyRange(s: TruthState, f: Formation): boolean {
  const here = asHex(f.pos);
  if (!here) return false;
  const depots = Object.values(s.facilities).filter((fac: Facility) =>
    fac.sideId === f.sideId && fac.supplyPoints > 0 &&
    (fac.tags.includes('DEPOT') || fac.tags.includes('SPACEPORT')) &&
    fac.pos.kind === 'ground');
  return depots.some(d => {
    const dp = d.pos as GroundPos;
    return dp.theaterId === here.theaterId &&
      hexDistance(dp, here) <= SUPPLY.SUPPLY_LINE_MAX_HEXES;
  });
}

export function maintenancePass(s: TruthState, dt: number, emit: (e: GameEvent) => void): void {
  const pulses = dt / CLOCK.TICKS_PER_PULSE;

  for (const f of Object.values(s.formations)) {
    if (f.destroyed) continue;

    // rout expiry (core §3.2/§7.4): uncommandable window closes
    if (f.routUntilTick != null && s.tick >= f.routUntilTick) {
      emit({ type: 'ROUT_STARTED', formationId: f.id, untilTick: 0, tick: s.tick }); // clear
    }

    const order = f.currentOrderId ? s.orders[f.currentOrderId] : undefined;

    // Dig In → DUG_IN after N pulses (engineers halve), then the order completes (core §4.1)
    if (order && !order.completed && order.kind === 'DIG_IN' && f.posture !== 'DUG_IN') {
      const need = COMBAT.DIG_IN_PULSES * (isEngineer(s, f) ? COMBAT.ENGINEER_DIG_IN_FACTOR : 1);
      const acc = (f.digInPulseAcc ?? 0) + pulses;
      if (acc >= need - 1e-9) {
        emit({ type: 'POSTURE_CHANGED', formationId: f.id, posture: 'DUG_IN', tick: s.tick });
        emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
      }
      s.formations[f.id].digInPulseAcc = acc; // bookkeeping, not event-worthy
    }

    // REST recovery (core §3.2): +2 RDY/pulse in supply, +1 without
    if (order && !order.completed && order.kind === 'REST' && pulses >= 1 && f.rdy < RDY.START) {
      const rate = f.supply.inSupply ? RDY.REST_RECOVERY_PER_PULSE : RDY.REST_RECOVERY_UNSUPPLIED;
      emit({ type: 'RDY_CHANGED', formationId: f.id,
             delta: Math.round(rate * pulses), reason: 'rest' });
    }

    // daily supply tick — anchored on lastSuppliedTick so step size doesn't matter
    const sinceSupply = s.tick - f.supply.lastSuppliedTick;
    if (sinceSupply >= CLOCK.TICKS_PER_DAY) {
      const supplied = inSupplyRange(s, f);
      emit({ type: 'SUPPLY_CHANGED', formationId: f.id, inSupply: supplied,
             lastSuppliedTick: f.supply.lastSuppliedTick + CLOCK.TICKS_PER_DAY });
      if (!supplied) {
        emit({ type: 'RDY_CHANGED', formationId: f.id,
               delta: RDY.PER_DAY_UNSUPPLIED, reason: 'out of supply' });
      }
    }
  }
}
