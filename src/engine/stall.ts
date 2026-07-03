/**
 * engine/stall.ts — why is my order doing nothing? (ext)
 *
 * The passes stall orders silently (a `continue` in a loop); the player just sees a
 * counter that isn't moving. This module re-derives the reason read-only at projection
 * time, so the own-forces panel can say "⏳ waiting at the ramp — the bays are full"
 * instead of nothing. Purely observational: no events, no state, no engine change.
 */
import { CAREER, SKYWATCH, SUPPLY, TERRAIN } from '../rules.js';
import type { Formation, GroundPos, TruthState } from '../core/types.js';
import { hexKey } from '../core/types.js';
import { hexDistance } from '../hex/axial.js';
import { hexEntryCost, strikeTargetHex } from './movement.js';

function repairSourceHere(s: TruthState, f: Formation): 'facility' | 'carrier' | null {
  if (f.pos.kind === 'ground') {
    const here = f.pos;
    const fac = Object.values(s.facilities).find(x =>
      x.sideId === f.sideId && x.pos.kind === 'ground' &&
      x.pos.theaterId === here.theaterId && x.pos.q === here.q && x.pos.r === here.r &&
      CAREER.REPAIR_FACILITY_TAGS.some(t => (x.tags as string[]).includes(t)));
    if (fac) return 'facility';
  }
  if (f.mounted) {
    const carrier = s.formations[f.mounted.carrierFormationId];
    if (carrier && !carrier.destroyed && carrier.carrier) return 'carrier';
  }
  return null;
}

/** A short plain-language reason the active order is waiting, or undefined if it isn't. */
export function stallReason(s: TruthState, f: Formation): string | undefined {
  const order = f.currentOrderId ? s.orders[f.currentOrderId] : undefined;
  if (!order || order.completed) return undefined;

  switch (order.kind) {
    case 'STRIKE': {
      if (f.pos.kind !== 'ground') return undefined;
      const target = strikeTargetHex(s, order);
      if (!target) return 'holding — no usable fix on the target (need SHADOW or better)';
      const hex = s.theaters[target.theaterId]?.hexes[hexKey(target.q, target.r)];
      if (!hex) return 'holding — target estimate is off the map';
      return undefined;
    }
    case 'SHADOW': {
      const target = strikeTargetHex(s, order);
      if (!target) return 'tail holding — the contact has faded; waiting for a new fix';
      return undefined;
    }
    case 'EMBARK': {
      const carrier = order.targetFormationId ? s.formations[order.targetFormationId] : undefined;
      if (!carrier || carrier.destroyed || !carrier.carrier) return undefined; // fizzles on its own
      if (carrier.pos.kind !== 'ground') return `waiting for ${carrier.name} to land`;
      if (f.pos.kind === 'ground' && hexDistance(f.pos, carrier.pos) === 0) {
        const aboard = Object.values(s.formations).filter(x =>
          !x.destroyed && x.mounted?.carrierFormationId === carrier.id).length;
        if (aboard >= carrier.carrier.bays) return 'waiting at the ramp — the bays are full';
      }
      return undefined;
    }
    case 'DISEMBARK': {
      const carrier = f.mounted ? s.formations[f.mounted.carrierFormationId] : undefined;
      if (carrier && carrier.pos.kind !== 'ground') {
        return `stowed aboard ${carrier.name} — it must land before anyone steps off`;
      }
      return undefined;
    }
    case 'REARM': {
      if (f.pos.kind !== 'ground') return undefined;
      const here = f.pos;
      const dry = f.unitIds.filter(uid => {
        const u = s.units[uid];
        return u && u.damage !== 'DESTROYED' && u.damage !== 'SALVAGE' && u.ammoState !== 'FULL';
      }).length;
      if (dry === 0) return undefined;
      const need = dry * SUPPLY.REARM_SP_PER_UNIT;
      const fac = Object.values(s.facilities).find(x =>
        x.sideId === f.sideId && x.pos.kind === 'ground' &&
        x.pos.theaterId === here.theaterId && x.pos.q === here.q && x.pos.r === here.r &&
        ['DEPOT', 'FACTORY', 'SPACEPORT'].some(t => (x.tags as string[]).includes(t)));
      const convoy = Object.values(s.formations).find(g =>
        g.id !== f.id && !g.destroyed && g.sideId === f.sideId && g.pos.kind === 'ground' &&
        g.pos.theaterId === here.theaterId && g.pos.q === here.q && g.pos.r === here.r &&
        (g.carriedSp ?? 0) >= need);
      if (!fac && !convoy) return 'waiting for supply — no stocked depot, factory, spaceport, or convoy in this hex';
      if (fac && fac.supplyPoints < need && !convoy) {
        return `waiting for supply — ${fac.name} holds ${fac.supplyPoints} SP, the rearm needs ${need}`;
      }
      return undefined;
    }
    case 'REPAIR': {
      const hurt = f.unitIds.map(uid => s.units[uid])
        .filter(u => u && (u.damage === 'DAMAGED' || u.damage === 'CRIPPLED'));
      if (hurt.length === 0) return undefined;
      const src = repairSourceHere(s, f);
      if (!src) return 'nowhere to repair — needs a friendly depot/factory/spaceport hex, or a carrier bay';
      const queued = hurt.filter(u => u.repairReadyTick == null).length;
      if (queued > 0) {
        return src === 'facility'
          ? 'shop queue waiting — not enough SP for every job yet'
          : 'shop queue waiting — all carrier turnaround crews are busy';
      }
      return undefined; // benches working
    }
    case 'LAND': {
      if (!order.targetHex) return undefined;
      const hex = s.theaters[order.targetHex.theaterId]
        ?.hexes[hexKey(order.targetHex.q, order.targetHex.r)];
      if (hex && TERRAIN[hex.terrain]?.ompCost === null) {
        return `cannot land on ${hex.terrain.toLowerCase()} — pick another hex`;
      }
      return undefined;
    }
    default: {
      // move-family: an impassable hex directly ahead stalls the column silently.
      // hexEntryCost knows the motion family — water stops a tank column, not a VTOL wing.
      if (f.pos.kind === 'ground' && ['MOVE', 'FORCED_MARCH', 'MOVE_CAUTIOUS'].includes(order.kind)) {
        const wps = (order.path ?? []).filter((p): p is GroundPos => p.kind === 'ground');
        const next = wps[f.pathIndex ?? 0];
        if (next) {
          const hex = s.theaters[next.theaterId]?.hexes[hexKey(next.q, next.r)];
          if (hex && hexEntryCost(s, f, hex) === null) {
            return `stalled — ${hex.terrain.toLowerCase()} ahead is impassable for this formation; re-plot the route`;
          }
        }
      }
      // air-side launch gates
      if (f.pos.kind === 'ground' && f.air) {
        if (f.air.turnaroundReadyTick != null && s.tick < f.air.turnaroundReadyTick) {
          return 'turnaround crews still working — launch when rearm completes';
        }
        const fatigued = f.unitIds.some(uid =>
          (s.units[uid]?.pilotIds ?? []).some(pid =>
            (s.pilots[pid]?.fatigue ?? 0) >= SKYWATCH.FATIGUE_GROUNDED_AT));
        if (fatigued) return 'crews grounded by fatigue — stand down to recover';
        if (order.targetContactId) {
          const c = s.contacts[order.targetContactId];
          if ((c?.delivered?.level ?? 0) < SKYWATCH.MIN_PLOT_INTERCEPT_LEVEL) {
            return 'cannot plot the intercept — the track is below SHADOW';
          }
        }
      }
      return undefined;
    }
  }
}
