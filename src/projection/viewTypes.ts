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
  tags: string[]; // ECM / probe / stealth / … (derived from the record sheet)
}

export interface OwnFormationView {
  id: Id; name: string; pos: GroundPos | null;
  omp: number; br: number; rdy: number;
  emcon: Emcon; posture: Posture;
  onNet: boolean;
  /** This formation's own sensor reach in op-hexes (best unit incl. probe/HQ). */
  sensor?: { passive: number; active: number };
  routed?: boolean; // RDY≤1: uncommandable until it rallies (core §3.2/§7.4)
  currentOrder?: { id: Id; kind: string; completed: boolean;
                   stall?: string /* ext: why it's waiting, in plain words */;
                   path?: Array<{ q: number; r: number }> };
  units: OwnUnitView[];
  inSupply: boolean;
  // ext: carrier ops — your own bays and rides, always visible
  carrier?: { bays: number; crews: number; avFuelTons: number;
              aboard: Array<{ id: Id; name: string }> };
  mountedOn?: { id: Id; name: string };
  // M3: the flight board — your own ledgers, always visible (SKYWATCH §2)
  alertState?: string;
  flight?: {
    airPos: { q: number; r: number; band: AirPos['band']; altLevel: number } | null;
    /** D-037 congruent sky: the ground hex directly under the flight, if over a map. */
    overhead?: { theaterId: string; q: number; r: number } | null;
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

// M5: what the map renderer needs that the text views didn't carry
export interface OwnFacilityView {
  id: Id; name: string; pos: GroundPos; tags: string[];
  fuelFarmTons: number; supplyPoints: number; isCommandNode: boolean;
  sensor?: { passive: number; active: number };
}
export interface OwnSatelliteView {
  id: Id; kind: 'RECON' | 'COMM'; theaterId: Id;
  corridor: Array<{ q: number; r: number }>;
  periodPulses: number; nextPassTick: Tick; alive: boolean;
}
/** Grid extent is public geography; terrain content stays scouted-only (D-012). */
export interface TheaterBoundsView {
  id: Id; name: string; cols: number; rows: number;
  airHex: { q: number; r: number };
}

export interface ContactView {
  id: Id;                       // contact id only — never the target formation id
  level: LadderLevel;
  levelName: string;
  kind: 'STANDARD' | 'ECM_HAZE';
  estPos: GroundPos | AirPos | NodePos | LanePos; posErrorHexes: number;
  /** D-037: air contacts — the ground hex the estimate sits over, for the map. */
  overhead?: { theaterId: Id; q: number; r: number };
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
  vpThreshold?: number;          // M6: the finish line, if the campaign has one
  ended?: { winnerSideId: Id | null; reason: string; tick: Tick };
  ownFormations: OwnFormationView[];
  contacts: ContactView[];
  reports: ReportView[];
  scoutedTerrain: ScoutedHexView[];
  system?: SystemView;
  ownFacilities: OwnFacilityView[];
  ownSatellites: OwnSatelliteView[];
  netNodes: Array<{ q: number; r: number; theaterId: Id; radius: number }>;
  netTheaterWide: boolean;
  supplyHexes: Array<{ q: number; r: number; theaterId: Id }>;
  theaters: TheaterBoundsView[];
}
