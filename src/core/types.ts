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
  | 'HPG' | 'DEPOT' | 'SENSOR_STATION' | 'AIRSTRIP' | 'COMM_RELAY';
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
  // M6: a held system objective scores VP/day (jump point, recharge station, gas
  // giant refinery, shipyard — DEEP SKY §9). ownerSideId flips on uncontested control.
  objective?: { vpPerDay: number; ownerSideId?: Id };
}
export interface SysLane { id: Id; a: Id; b: Id; distanceAU: number }

// ── §2.1 Sides, units, people ────────────────────────────────────────────────
export interface Side {
  id: Id; name: string; vp: number;
  commandNodes: Id[];     // formation/facility ids able to anchor nets
  reprisalsOwed: number;  // DEEP SKY 7.4
  // ext (M8, DEEP SKY §9): off-world imports — SP delivered daily to homeDepotId via a
  // friendly jump point; a blockade (enemy holds the jump points) cuts it to zero.
  importSpPerDay?: number;
  homeDepotId?: Id;
}

export interface Pilot {
  id: Id; name: string; gunnery: number; piloting: number;
  kills: number; ace: boolean; fatigue: number; // SKYWATCH 11
  status: 'OK' | 'WOUNDED' | 'DOWNED' | 'CAPTURED' | 'KIA' | 'POOL';
  xp?: number;             // ext: career XP — skills improve at CAREER.XP_PER_IMPROVEMENT
  recoverAtTick?: Tick;    // ext: WOUNDED heals to OK when the clock reaches this
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
  repairReadyTick?: Tick;  // ext: under repair — heals to OK when the clock reaches this
  /** ext: the marked-up record sheet from the last battle (the tracker's damage blob,
   * opaque to the engine). Reseeded into the next handoff so the same boxes reappear
   * unless repaired. Cleared by repair (all), rearm (ammo), and pilot recovery (hits). */
  sheetDamage?: Record<string, unknown>;
  /** D-050: flak battery strength graded from the unit's real guns (derived from
   * the card's weapons when it carries the Anti-Aircraft Targeting quirk; authored
   * values win). A bare AA tag without it counts as an improvised battery of 1. */
  flak?: number;
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
  rules?: StandingRule[];          // D-049: persistent if-then reflexes (see StandingRule)
  mounted?: { carrierFormationId: Id };
  /** ext: carrier capability (DropShip/carrier). `bays` caps embarked formations; a
   * recovered flight rearms from `crews` turnaround crews drawing on `avFuelTons` of
   * aviation fuel. `crewBusyUntil` holds each in-progress rearm's ready tick. Presence is
   * what lets a formation embark/service others. */
  carrier?: { bays: number; crews: number; avFuelTons: number; crewBusyUntil?: Tick[] };
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
  engPulseAcc?: number;           // ext (M7): engineer task progress in pulses (core §9.3)
  lastBattleTick?: Tick;          // a fighting day costs ×2 supply (core §10.1)
  carriedSp?: number;             // ext (M7): a supply convoy's onboard SP (core §10.1)
  squawk?: string;                // ext (M8): broadcast transponder identity (DEEP SKY §4.3)
  neutral?: boolean;             // ext (M8): civilian/neutral traffic for the false-flag game
  // ext (M4): space bookkeeping (DEEP SKY) — present on vessels in transit
  space?: {
    burnStartTick?: Tick | null;    // emitting since (1G+ drives are automatic after lag)
    rdyDayAcc?: number;             // crew G-limit fatigue accumulator (days at high G)
    atmoEndTick?: Tick | null;      // ext: mid re-entry/ascent — transition lands at this tick
  };
  // ext (M3): flight state (SKYWATCH) — present on air-capable formations
  air?: {
    homeFacilityId?: Id;
    /** Carrier ops: home is a friendly DropShip formation, not a fixed base. RTB /
     * joker / bingo track the carrier's current position as it moves. Takes precedence
     * over homeFacilityId when set and the carrier is alive. */
    homeCarrierId?: Id;
    phase: 'GROUNDED' | 'ENROUTE' | 'ON_STATION' | 'RTB';
    speed: 'CRUISE' | 'DASH';
    lean?: boolean;                  // lean loiter (1 FP/min, −1 to own search)
    launchAtTick?: Tick | null;      // scramble call + alert delay
    lastLaunchTick?: Tick;           // launch climb is a bright burn (−2 SIG that turn)
    loiterTicksRemaining?: number;
    jokerWarned?: boolean;
    bingoCalled?: boolean;
    alertAnchorTick?: Tick;          // fatigue/idle-burn accrual anchor
    turnaroundReadyTick?: Tick | null;
  };
}

// ── §2.2 Facilities & logistics ─────────────────────────────────────────────
export interface Facility {
  id: Id; sideId: Id; name: string; pos: Position; tags: InfraTag[];
  fuelFarmTons: number; supplyPoints: number;
  turnaroundCrews: { total: number; busyUntil: Tick[] };
  isCommandNode: boolean;
  sensorStation?: { passive: number; active: number };
  activeSweep?: boolean; // ext: station running its active set (GM toggle)
  /** D-050: an anti-capital weapon emplacement (real capital-weapon stats from
   * rules.CAPITAL_WEAPONS). Fires on capital hulls transitioning or flying inside
   * its air-hex range; `shots` is the missile magazine (energy mounts ignore it);
   * silenced while an enemy ground formation stands in its hex. */
  capitalBattery?: { weapon: string; shots: number };
}
export interface SalvageToken { id: Id; hex: GroundPos; sourceUnitId: Id; heldBy?: Id }

/** ext: a recovered wreck being rebuilt into a serviceable unit (the career loop). */
export interface RefitProject {
  id: Id; sideId: Id;               // who recovered it (salvage heldBy)
  sourceUnitId: Id;                 // the wreck — model/stats copied at completion
  model: string; name: string;      // display snapshot (source unit may be enemy-owned)
  hex: GroundPos;                   // where the wreck was recovered
  status: 'AWAITING' | 'IN_PROGRESS';
  facilityId?: Id; formationId?: Id; readyTick?: Tick; // set when the refit starts
}
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
  | 'STRIKE' | 'SHADOW' | 'RESUPPLY' | 'REST'
  | 'REARM'  // ext: draw ammo (REARM_SP_PER_UNIT) from a co-located depot/factory/convoy
  | 'REPAIR' // ext: feed damaged units into the shop at a repair hex / carrier bay
  // ext (M7, core §9): a standing fire mission, and the engineer toolkit
  | 'FIRE' | 'LAY_MINES' | 'BREACH' | 'DEMOLISH' | 'BUILD_BRIDGE'
  // ext: player carrier ops — march to a carrier and load / step off a landed one
  | 'EMBARK' | 'DISEMBARK';
export type AirMission =
  'CAP' | 'ORBITAL_STANDBY' | 'STRIKE_AIR' | 'CAS' | 'SWEEP' | 'ESCORT'
  | 'RECON' | 'INTERDICTION' | 'FERRY' | 'TANKER' | 'SAR'
  // ext: player carrier ops — a DropShip lifts and holds, or puts down on any open hex
  | 'LIFT_OFF' | 'LAND'
  // ext: climb the well from air (or ground) to the planet's orbit node
  | 'ASCEND';
export type SpaceOrderKind =
  'TRANSIT' | 'COLD_COAST' | 'STATION_KEEP' | 'INTERCEPT' | 'SKIM_FUEL'
  | 'RECHARGE_SAIL' | 'QUICK_CHARGE' | 'JUMP' | 'INSPECT' | 'BLOCKADE' | 'BOARD'
  // ext: re-enter from a planet/moon node into its theater's air layer
  | 'DESCEND';

export interface Trigger {
  when: 'CONTACT_WITHIN' | 'DETECTED_SELF' | 'TICK_REACHED' | 'HEX_REACHED'
      | 'FUEL_BELOW' | 'RDY_BELOW' | 'ALLY_ENGAGED';
  param: number | string;
}
export interface Order {
  id: Id; sideId: Id; formationId: Id; issuedTick: Tick; effectiveTick: Tick;
  kind: GroundOrderKind | AirMission | SpaceOrderKind;
  path?: Position[]; targetContactId?: Id; targetHex?: GroundPos; station?: Position;
  targetFormationId?: Id;          // ext: EMBARK — the own-side carrier to load into
  burnProfile?: BurnProfile;
  // D-049: plan step — this order only becomes due once the named order completes.
  // Steps of one plan share an issuedTick; a NEWER activation cancels stale steps.
  afterOrderId?: Id;
  conditionals: { trigger: Trigger; thenOrder: Omit<Order, 'conditionals'>;
                  fired?: boolean /* ext (M2): consumed, won't re-fire */ }[];
  emconOverride?: Emcon;
  completed?: boolean; // ext
  // ext (M3): air mission profile (SKYWATCH §2/§4)
  airSpeed?: 'CRUISE' | 'DASH';
  loiterTicks?: number;            // time on station (CAP/RECON) in contact turns
  lean?: boolean;                  // lean loiter
  // ext (M4): space transit (DEEP SKY §2)
  laneId?: Id;                     // lane to ride (TRANSIT/COLD_COAST)
  destinationNodeId?: Id;          // which end of the lane we are burning for
}
export interface ATO { id: Id; sideId: Id; pulse: number; orderIds: Id[] }

/**
 * D-049: a standing rule — an if-then reflex that lives on the FORMATION, not on
 * any order. Evaluated every step whatever the unit is doing (and off-net: rules
 * are pre-programmed, like conditionals). A fired rule spawns its thenOrder and
 * disarms; `repeat` rules re-arm once their trigger goes false again (edge-
 * triggered), one-shot rules stay spent.
 */
export interface StandingRule {
  trigger: Trigger;
  thenOrder: Omit<Order, 'conditionals'>;
  repeat?: boolean;
  armed?: boolean; // runtime: false after firing; undefined/true = armed
}

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
                   ammoState: string; damage: string; pilotSkills: [number, number];
                   sheetDamage?: Record<string, unknown> /* last battle's marked boxes */ }>;
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
                        sheetDamage?: Record<string, unknown>; // the marked-up card, verbatim
                        pilotOutcomes: Array<{ pilotId: Id; status: Pilot['status'];
                                               kills?: number;
                                               hits?: number /* recovery scales per hit */ }> }>;
  ejections: Array<{ pilotId: Id; pos?: Position }>; // pos filled from the battle hex if omitted
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
  id: Id; tick: Tick;
  hex?: GroundPos;                  // ground engagements (absent for AIR/SPACE domains)
  trigger: 'SAME_HEX' | 'SCREEN' | 'STRIKE' | 'AIR_INTERCEPT' | 'SPACE_INTERCEPT';
  domain?: 'GROUND' | 'AIR' | 'SPACE';
  airPos?: AirPos;                  // ext (M3): merge location for air engagements
  // ext (M4): the geometry solution that justified this battle (DEEP SKY §5)
  classification?: { type: 'MATCHED' | 'SLASH' | 'STERN_CHASE' | 'BLOCKADE';
                     mm: number; gapBurnDays: number; marginBurnDays: number;
                     slashTurns?: number; nodeId?: Id };
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
  // ext (M3): which high-altitude air hex sits over each theater (SKYWATCH §1:
  // one high-altitude hex covers an entire low-altitude theater map)
  airHexByTheater?: Record<Id, { q: number; r: number }>;
  // ext (M6): victory conditions (core §12.2). First side to reach vpThreshold wins;
  // at endTick the campaign ends and the highest VP wins (ties → draw).
  vpThreshold?: number;
  endTick?: Tick;
  // ext: per-campaign command-net reach (op-hexes). Defaults to NET.GROUND_NODE_RADIUS /
  // NET.DROPSHIP_BASE_RADIUS when omitted.
  netGroundRadius?: number;
  netBaseRadius?: number;
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
  // M4 (DEEP SKY): the system layer
  system: { nodes: Record<Id, SysNode>; lanes: Record<Id, SysLane>;
            lastSweepTick: Tick };           // watch-cadence anchor for space detection
  emissions: Record<Id, Emission>;           // jump flashes & drive burns in flight
  jumpDrives: Record<Id, JumpDrive>;         // keyed by vessel unit id
  // ext: the career loop — recovered wrecks awaiting / undergoing refit
  refits?: Record<Id, RefitProject>;         // optional: absent in pre-career logs
  // M6: VP scoring & endings
  lastScoredTick: Tick;                      // daily-accrual anchor (core §12.1)
  ended?: { winnerSideId: Id | null; reason: string; tick: Tick }; // campaign over (§12.2)
}

/** Something bright happened in space; every observer sees it `lag` later (DEEP SKY §4). */
export interface Emission {
  id: Id;
  kind: 'JUMP_FLASH' | 'DRIVE_BURN';
  sourceFormationId: Id;
  sourceSideId: Id;
  pos: Position;                    // where it happened (NodePos / LanePos snapshot)
  tick: Tick;                       // when it was TRUE
  massClass: string;                // what the light carries: a rough mass class
  vectorNote?: string;              // burns: "the enemy knows where you're going"
  observedBy: Id[];                 // sides whose light cone has caught up
}

export const hexKey = (q: number, r: number) => `${q},${r}`;
export const scoutKey = (theaterId: Id, q: number, r: number) => `${theaterId}:${q},${r}`;
