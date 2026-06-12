/**
 * core/types.ts — the data model, transcribed from OVERRIDE_GM_Tool_Spec.md §1–§3.
 * Tool extensions beyond the spec are marked `// ext:` with the DECISIONS.md entry.
 */

// ── §1.1 Time ────────────────────────────────────────────────────────────────
export type Tick = number; // absolute ticks (contact turns, 6 min) since campaign start
export type ClockMode = 'WATCH' | 'PULSE' | 'CONTACT';

// ── §1.2 Identity & dice ─────────────────────────────────────────────────────
export type Id = string;
export interface DieRoll {
  id: Id;
  tick: Tick;
  purpose: string;
  dice: '2d6' | '1d6';
  result: number;
  seedCursor: number; // every roll logged; (campaignSeed, seedCursor) reproduces it
}

// ── §1.3 Space — three position layers, one union ───────────────────────────
export interface GroundPos { kind: 'ground'; theaterId: Id; q: number; r: number }

export type Band = 'DECK' | 'LOW' | 'HIGH' | 'SUBORBITAL' | 'ORBIT';
export interface AirPos {
  kind: 'air'; gridQ: number; gridR: number; band: Band;
  altLevel: number; velocity: number; vectorDeg: number;
}

export interface NodePos { kind: 'node'; nodeId: Id }
export interface BurnProfile { g: number; flipAtAU?: number; coastFromAU?: number }
export interface LanePos {
  kind: 'lane'; laneId: Id; progressAU: number;
  velocityKps: number; burnProfile: BurnProfile; flipped: boolean;
}
export type Position = GroundPos | AirPos | NodePos | LanePos;

// ── §1.4 Terrain & infrastructure (Module 0) ────────────────────────────────
export type TerrainType =
  'CLEAR' | 'WOODS' | 'ROUGH' | 'HILLS' | 'MOUNTAIN' | 'WATER' | 'SWAMP' | 'URBAN';
export type InfraTag =
  'ROAD' | 'RAIL' | 'BRIDGE' | 'TOWN' | 'CITY' | 'FORT' | 'SPACEPORT' | 'FACTORY'
  | 'HPG' | 'DEPOT' | 'SENSOR_STATION' | 'AIRSTRIP';
export interface Hex {
  theaterId: Id; q: number; r: number; terrain: TerrainType;
  infra: InfraTag[];
  objective?: { vpPerDay: number; hidden: boolean; fake?: boolean; ownerSideId?: Id };
  minefieldIds: Id[];
}

// ── §1.5 System graph (Module 2) ────────────────────────────────────────────
export type NodeType =
  'JUMP_ZENITH' | 'JUMP_NADIR' | 'PIRATE_POINT' | 'PLANET' | 'MOON'
  | 'GAS_GIANT' | 'BELT_SECTOR' | 'STATION_RECHARGE' | 'STATION_OTHER' | 'SHIPYARD';
export interface SysNode {
  id: Id; type: NodeType; name: string;
  theaterId?: Id;      // PLANET/MOON nodes embed a Module-0 theater
  surveyedBy: Id[];    // sides holding the survey (pirate points)
  secret: boolean;     // pirate points start true
}
export interface SysLane { id: Id; a: Id; b: Id; distanceAU: number }

// ── §2.1 Sides, units, people ────────────────────────────────────────────────
export interface Side {
  id: Id; name: string; vp: number;
  commandNodes: Id[];     // formation/facility ids able to anchor nets
  reprisalsOwed: number;  // DEEP SKY 7.4
}

export interface Pilot {
  id: Id; name: string; gunnery: number; piloting: number;
  kills: number; ace: boolean; fatigue: number; // SKYWATCH 11
  status: 'OK' | 'WOUNDED' | 'DOWNED' | 'CAPTURED' | 'KIA' | 'POOL';
}

export type UnitClass =
  'MECH' | 'VEHICLE' | 'INFANTRY' | 'BA' | 'PROTO' | 'VTOL' | 'CONV_FIGHTER'
  | 'ASF' | 'SMALL_CRAFT' | 'DROPSHIP' | 'JUMPSHIP' | 'WARSHIP' | 'SUPPORT' | 'NAVAL';
export type DamageState = 'OK' | 'DAMAGED' | 'CRIPPLED' | 'DESTROYED' | 'SALVAGE';

export interface FuelLedger {
  // tactical (fighters, small craft; DropShips at handoff)
  fp: number; fpPerTon: number;            // 80 ASF, 160 conv, ~30 large DropShip
  // strategic (DropShips/WarShips in transit)
  tons: number; tonsPerBurnDay?: number;   // e.g. 1.84
  jokerFp?: number; bingoFp?: number;      // recomputed continuously in flight
}

export interface Unit {
  id: Id; sideId: Id; name: string; model: string;
  class: UnitClass;
  bv: number; pv: number;
  walkOrCruise: number; run: number; jump: number;
  safeThrust?: number; maxThrust?: number;
  fuel?: FuelLedger;
  damage: DamageState;
  pilotIds: Id[]; ammoState: 'FULL' | 'PARTIAL' | 'DRY';
  tags: string[]; // 'ECM','ANGEL_ECM','BEAGLE','AA','C3M','MASH','HQ','ENGINEER',
                  // 'DECOY','SKYEYE','LF_BATTERY','SAIL','STEALTH','RECON','WHEELED'...
}

export type Emcon = 'DARK' | 'PASSIVE' | 'ACTIVE';
export type Posture = 'NONE' | 'HIDE' | 'DUG_IN' | 'DIGGING' | 'FORTIFIED';

export interface Formation {
  id: Id; sideId: Id; name: string; unitIds: Id[];
  pos: Position; facing?: number;
  omp: number; br: number; sigBase: number;
  sns: { passive: number; active: number };
  rdy: number; // 0..10
  emcon: Emcon;
  posture: Posture;
  onNet: boolean; netNodeId?: Id;
  currentOrderId?: Id; standingOrderIds: Id[];
  mounted?: { carrierFormationId: Id };
  alertState?: 'ALERT5' | 'ALERT15' | 'ALERT60' | 'STAND_DOWN'; // flights (SKYWATCH 3.1)
  supply: { lastSuppliedTick: Tick; inSupply: boolean };
  destroyed?: boolean;            // ext: tombstone so undelivered reports stay dead
  // ext: engine bookkeeping (D-008) — not player-visible (projection strips everything)
  moveProgress?: number;          // fraction [0,1) of the next path hex already paid
  pathIndex?: number;             // next waypoint index in the active order's path
  lastHeadingDeg?: number;        // for SHADOW+ vector estimates
  forcedMarchPulseAcc?: number;   // accumulates RDY −1 per pulse of forced march
  renetAtTick?: Tick | null;      // pending re-net after decapitation
  transient?: { moved: 'NONE' | 'NORMAL' | 'CAUTIOUS' | 'FORCED' | 'SPRINT';
                onRoad: boolean; fired: boolean };
  // ext (M2): rout & combat bookkeeping
  routUntilTick?: Tick | null;    // RDY≤1: uncommandable until this tick (core §3.2/§7.4)
  digInPulseAcc?: number;         // accumulates pulses toward DUG_IN (core §4.1)
  lastBattleTick?: Tick;          // a fighting day costs ×2 supply (core §10.1)
}

// ── §2.2 Facilities & logistics ─────────────────────────────────────────────
export interface Facility {
  id: Id; sideId: Id; name: string; pos: Position; tags: InfraTag[];
  fuelFarmTons: number; supplyPoints: number;
  turnaroundCrews: { total: number; busyUntil: Tick[] };
  isCommandNode: boolean;
  sensorStation?: { passive: number; active: number };
  activeSweep?: boolean; // ext: station running its active set (GM toggle)
}
export interface SalvageToken { id: Id; hex: GroundPos; sourceUnitId: Id; heldBy?: Id }
export interface Marker {
  id: Id;
  kind: 'DOWNED_CREW' | 'MINEFIELD' | 'SENTINEL_DRONE' | 'FUEL_CACHE' | 'WRECK';
  pos: Position; sideId?: Id; payload: Record<string, unknown>;
  beaconActive?: boolean;
}

// ── §2.3 Satellites (core 8.6) ──────────────────────────────────────────────
export interface Satellite {
  id: Id; sideId: Id; kind: 'RECON' | 'COMM';
  theaterId: Id;                       // ext: which theater it overflies
  corridor: { q: number; r: number }[]; // ground track centerline (10-wide)
  periodPulses: number; nextPassTick: Tick; alive: boolean;
  knownTo: Id[];                       // sides that can schedule around it
}

// ── §2.5 Contacts — the heart of double-blind ───────────────────────────────
export type LadderLevel = 0 | 1 | 2 | 3 | 4; // 0 none, 1 GHOST, 2 SHADOW, 3 CONTACT, 4 LOCK

/** What a side has actually received about a contact (D-008.5). Views render ONLY this. */
export interface ContactSnapshot {
  level: LadderLevel;
  estPos: Position; posErrorHexes: number;
  estVector?: number; estSizeClass?: string; estComposition?: string;
  toe?: Array<{ name: string; model: string; damage: DamageState;
                ammoState: string; emcon?: Emcon }>; // LOCK only
  asOfTick: Tick; // when this information was TRUE (light lag / courier delay)
}

export interface Contact {
  id: Id; observerSideId: Id; targetFormationId: Id;
  kind: 'STANDARD' | 'ECM_HAZE';      // ext: ECM haze pseudo-contact (spec §3.2)
  level: LadderLevel;
  lastConfirmedTick: Tick;            // for fade: −1 level per pulse w/o redetect
  lastFadeTick: Tick;                 // ext: fade bookkeeping
  estPos: Position; posErrorHexes: number;
  estVector?: number; estSizeClass?: string; estComposition?: string;
  staleAsOfTick: Tick;                // when this info was TRUE
  delivered?: ContactSnapshot;        // ext (D-008.5): the side's received picture
}

export interface ContactReport {
  id: Id; sideId: Id; generatedTick: Tick; deliveredTick: Tick | null;
  sourceFormationId: Id;              // or facility/satellite id
  contactId: Id; text: string;        // GM-editable before delivery (noise injection)
  snapshot: ContactSnapshot;          // ext (D-008.5): what gets merged on delivery
  lost?: boolean;                     // ext: courier killed — never deliverable
}

// ── §2.6 Orders ──────────────────────────────────────────────────────────────
export type GroundOrderKind =
  'MOVE' | 'FORCED_MARCH' | 'MOVE_CAUTIOUS' /* ext: D-006 GM ruling */
  | 'HIDE' | 'DIG_IN' | 'PATROL' | 'SCREEN'
  | 'STRIKE' | 'SHADOW' | 'RESUPPLY' | 'REST' | 'REPAIR';
export type AirMission =
  'CAP' | 'ORBITAL_STANDBY' | 'STRIKE_AIR' | 'CAS' | 'SWEEP' | 'ESCORT'
  | 'RECON' | 'INTERDICTION' | 'FERRY' | 'TANKER' | 'SAR';
export type SpaceOrderKind =
  'TRANSIT' | 'COLD_COAST' | 'STATION_KEEP' | 'INTERCEPT' | 'SKIM_FUEL'
  | 'RECHARGE_SAIL' | 'QUICK_CHARGE' | 'JUMP' | 'INSPECT' | 'BLOCKADE' | 'BOARD';

export interface Trigger {
  when: 'CONTACT_WITHIN' | 'DETECTED_SELF' | 'TICK_REACHED' | 'HEX_REACHED'
      | 'FUEL_BELOW' | 'RDY_BELOW' | 'ALLY_ENGAGED';
  param: number | string;
}
export interface Order {
  id: Id; sideId: Id; formationId: Id; issuedTick: Tick; effectiveTick: Tick;
  kind: GroundOrderKind | AirMission | SpaceOrderKind;
  path?: Position[]; targetContactId?: Id; targetHex?: GroundPos; station?: Position;
  burnProfile?: BurnProfile;
  conditionals: { trigger: Trigger; thenOrder: Omit<Order, 'conditionals'>;
                  fired?: boolean /* ext (M2): consumed, won't re-fire */ }[];
  emconOverride?: Emcon;
  completed?: boolean; // ext
}
export interface ATO { id: Id; sideId: Id; pulse: number; orderIds: Id[] }

// ── §3.6 Handoff Package & Battle Result (forms land in M2) ─────────────────
export interface HandoffPackage {
  id: Id; tick: Tick;
  table: 'GROUND' | 'LOW_ALT_ATMO' | 'SPACE' | 'GROUND_WITH_AIR';
  mapSpec: { terrainByHex?: TerrainType[]; sheetsHint: string[]; nodeName?: string };
  perSide: Array<{
    sideId: Id; entryEdge: 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW' | 'ANY_HALF';
    deploysFirst: boolean; initiativeBonus: number; initiativeBonusTurns: number;
    hiddenSetup: boolean; fortified: boolean; rdyTnPenalty: 0 | 1 | 2;
    units: Array<{ unitId: Id; velocity?: number; altLevel?: number;
                   fpOnTable?: number; jokerFp?: number; bingoFp?: number;
                   ammoState: string; damage: string; pilotSkills: [number, number] }>;
    offboard: {
      artillery: Array<{ unitId: Id; rangeHexesRemaining: number }>;
      airOnStation: Array<{ formationId: Id; arrivesTurn: number; fpOnStation: number }>;
      reinforcements: Array<{ formationId: Id; arrivesTurn: number; edge: string }>;
    };
  }>;
  specialRules: string[];
}
export interface BattleResult {
  handoffId: Id; victorSideId?: Id; hexControlSideId?: Id;
  unitOutcomes: Array<{ unitId: Id; damage: DamageState; fpRemaining?: number;
                        ammoState: string;
                        pilotOutcomes: Array<{ pilotId: Id; status: Pilot['status'] }> }>;
  ejections: Array<{ pilotId: Id; pos: Position }>;
  withdrewVia?: Record<Id, 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW'>;
  turnsElapsed: number; notes: string;
}

// ── §7 Engagement (core §7; spec §3.1) — M2 ─────────────────────────────────
/**
 * A pending or resolved tabletop battle. The engine never simulates it: it freezes the
 * campaign (`TruthState.pendingEngagementId`), exports a HandoffPackage, and waits for a
 * BattleResult. attacker/defender drive evasion bonus and initiative (core §7.1–7.2).
 */
export interface Engagement {
  id: Id; tick: Tick; hex: GroundPos;
  trigger: 'SAME_HEX' | 'SCREEN' | 'STRIKE';
  attackerSideId: Id; defenderSideId: Id;
  attackerFormationIds: Id[]; defenderFormationIds: Id[];
  status: 'PENDING' | 'EVADED' | 'EXPORTED' | 'RESOLVED';
  handoffId?: Id;
}

// ── §3.7 Jump board (M4) ────────────────────────────────────────────────────
export interface JumpDrive {
  vesselUnitId: Id; chargePct: number; chargeRateHrsTo100: number;
  sail: 'STOWED' | 'DEPLOYED' | 'DESTROYED'; lfBatteryCharged?: boolean;
  kfDamage: 'NONE' | 'MINOR' | 'MAJOR' | 'DEAD';
}

// ── Truth State ──────────────────────────────────────────────────────────────
export interface Theater {
  id: Id; name: string;
  hexes: Record<string, Hex>; // key "q,r"
}

export interface CampaignConfig {
  name: string;
  dawnTick: number;   // tick-of-day
  duskTick: number;
  weather: 'CLEAR' | 'RAIN' | 'STORM';
}

export interface TruthState {
  seed: string;
  tick: Tick;
  clockMode: ClockMode;
  seedCursor: number;
  config: CampaignConfig;
  sides: Record<Id, Side>;
  theaters: Record<Id, Theater>;
  units: Record<Id, Unit>;
  pilots: Record<Id, Pilot>;
  formations: Record<Id, Formation>;
  facilities: Record<Id, Facility>;
  satellites: Record<Id, Satellite>;
  markers: Record<Id, Marker>;
  salvage: Record<Id, SalvageToken>;
  contacts: Record<Id, Contact>;
  reports: Record<Id, ContactReport>;
  orders: Record<Id, Order>;
  scoutedHexes: Record<Id, string[]>; // sideId → hex keys "theaterId:q,r"
  engagements: Record<Id, Engagement>;       // M2
  pendingEngagementId?: Id | null;           // M2: set ⇒ campaign frozen awaiting GM
  handoffs: Record<Id, HandoffPackage>;      // M2: exported packages, by id
}

export const hexKey = (q: number, r: number) => `${q},${r}`;
export const scoutKey = (theaterId: Id, q: number, r: number) => `${theaterId}:${q},${r}`;
