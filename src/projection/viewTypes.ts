/**
 * projection/viewTypes.ts — the ONLY shapes a player ever sees.
 * These types deliberately contain no truth references, no internal target ids,
 * no RNG state, no other side's anything. Never persisted (spec §4).
 */
import type { AirPos, ClockMode, DamageState, Emcon, GroundPos, Id, LadderLevel,
              LanePos, NodePos, Posture, TerrainType, Tick } from '../core/types.js';

export interface OwnUnitView {
  id: Id; name: string; model: string; class: string;
  damage: DamageState; ammoState: string;
}

export interface OwnFormationView {
  id: Id; name: string; pos: GroundPos | null;
  omp: number; br: number; rdy: number;
  emcon: Emcon; posture: Posture;
  onNet: boolean;
  currentOrder?: { id: Id; kind: string; completed: boolean };
  units: OwnUnitView[];
  inSupply: boolean;
  // M3: the flight board — your own ledgers, always visible (SKYWATCH §2)
  alertState?: string;
  flight?: {
    airPos: { q: number; r: number; band: AirPos['band']; altLevel: number } | null;
    phase: string;
    speed: 'CRUISE' | 'DASH';
    fpMin: number;
    jokerFp: number;
    bingoFp: number;
    fatigueMax: number;
    turnaroundReadyTick?: Tick | null;
  };
  // M4: the vessel board — your own burn-day ledger (DEEP SKY §3)
  vessel?: {
    spacePos: NodePos | LanePos | null;
    burnDaysRemaining: number;
    fuelTons: number;
    drives: Array<{ unitId: Id; chargePct: number; sail: string; kfDamage: string;
                    lfBatteryCharged?: boolean }>;
  };
}

/** The subway-style system diagram: public geometry, secret points withheld (M4). */
export interface SystemView {
  nodes: Array<{ id: Id; type: string; name: string; theaterId?: Id }>;
  lanes: Array<{ id: Id; a: Id; b: Id; distanceAU: number; transitDays1G: number }>;
}

export interface ContactView {
  id: Id;                       // contact id only — never the target formation id
  level: LadderLevel;
  levelName: string;
  kind: 'STANDARD' | 'ECM_HAZE';
  estPos: GroundPos | AirPos | NodePos | LanePos; posErrorHexes: number;
  estVector?: number;           // SHADOW+
  estSizeClass?: string;        // SHADOW+
  estComposition?: string;      // CONTACT+
  toe?: Array<{ name: string; model: string; damage: DamageState;
                ammoState: string; emcon?: Emcon }>; // LOCK only
  staleAsOfTick: Tick;          // when this information was TRUE
  ageTicks: number;
}

export interface ReportView {
  id: Id; generatedTick: Tick; deliveredTick: Tick; text: string;
}

export interface ScoutedHexView {
  theaterId: Id; q: number; r: number; terrain: TerrainType; infra: string[];
  objective?: { vpPerDay: number };  // hidden/fake internals never exposed
}

export interface ViewState {
  sideId: Id;
  now: Tick;
  clockMode: ClockMode;
  isNight: boolean;
  vp: number;
  ownFormations: OwnFormationView[];
  contacts: ContactView[];
  reports: ReportView[];
  scoutedTerrain: ScoutedHexView[];
  system?: SystemView;
}
