/**
 * engine/carrier.ts — the physical DropShip story: embarked units ride their carrier.
 *
 * A formation with `mounted.carrierFormationId` is stowed in a carrier's bay. The other
 * passes skip it (no self-move, no flight ledger, no burn); instead this pass drags its
 * position along with the carrier every step, so an embarked lance moves exactly where the
 * DropShip moves — on the ground, in the air, on a lane, at a node. When the carrier dies
 * the embarked formations are stranded at its last position (bay doors gone, mount cleared)
 * so they reappear on the map instead of vanishing with the ship.
 *
 * MOUNT_MOVED is emitted only when the position actually changed, so a parked carrier costs
 * nothing and the event is not "interesting" (no clock compression from riding along).
 */
import type { Formation, GroundPos, Position, TruthState } from '../core/types.js';
import type { GameEvent } from '../core/events.js';
import { hexKey } from '../core/types.js';
import { hexDistance } from '../hex/axial.js';

/** Structural position equality across all four position kinds. */
export function samePos(a: Position, b: Position): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'ground': {
      const o = b as typeof a;
      return a.theaterId === o.theaterId && a.q === o.q && a.r === o.r;
    }
    case 'air': {
      const o = b as typeof a;
      return a.gridQ === o.gridQ && a.gridR === o.gridR && a.band === o.band &&
             a.altLevel === o.altLevel;
    }
    case 'node': {
      const o = b as typeof a;
      return a.nodeId === o.nodeId;
    }
    case 'lane': {
      const o = b as typeof a;
      return a.laneId === o.laneId && a.progressAU === o.progressAU;
    }
  }
}

/**
 * Sync every embarked formation's position to its carrier (or strand it if the carrier is
 * gone). Runs after the movement/air/space passes so it reads each carrier's final position
 * for this step.
 */
export function carrierPass(s: TruthState, emit: (e: GameEvent) => void): void {
  for (const f of Object.values(s.formations)) {
    if (f.destroyed || !f.mounted) continue;
    const carrier: Formation | undefined = s.formations[f.mounted.carrierFormationId];
    if (!carrier || carrier.destroyed) {
      // carrier lost: the bay is gone — drop the mount, leaving the unit at its last hex
      emit({ type: 'MOUNT_CHANGED', formationId: f.id, carrierFormationId: null });
      continue;
    }
    if (!samePos(f.pos, carrier.pos)) {
      emit({ type: 'MOUNT_MOVED', formationId: f.id,
             pos: structuredClone(carrier.pos), tick: s.tick });
    }
    // DISEMBARK (ext): a plotted order to step off — executes the moment the carrier is
    // on the ground (an airborne carrier makes the order wait for the landing).
    const order = f.currentOrderId ? s.orders[f.currentOrderId] : undefined;
    if (order && !order.completed && order.kind === 'DISEMBARK' &&
        s.tick >= order.effectiveTick && carrier.pos.kind === 'ground') {
      let at: GroundPos = { ...carrier.pos };
      const want = order.targetHex;
      if (want && want.theaterId === carrier.pos.theaterId &&
          hexDistance(carrier.pos, want) <= 1 &&
          s.theaters[want.theaterId]?.hexes[hexKey(want.q, want.r)]) {
        at = { ...want }; // step off into a chosen adjacent hex
      }
      emit({ type: 'MOUNT_CHANGED', formationId: f.id, carrierFormationId: null });
      emit({ type: 'FORMATION_MOVED', formationId: f.id, to: at,
             movedKind: 'NORMAL', onRoad: false, headingDeg: 0, tick: s.tick });
      emit({ type: 'ORDER_COMPLETED', orderId: order.id, formationId: f.id, tick: s.tick });
    }
  }
}
