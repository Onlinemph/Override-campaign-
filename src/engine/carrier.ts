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
import type { Formation, Position, TruthState } from '../core/types.js';
import type { GameEvent } from '../core/events.js';

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
  }
}
