# OVERRIDE GM TOOL — Unified Technical Specification
### Data schema & engine design for Modules 0 (Core), 1 (SKYWATCH), 2 (DEEP SKY)
*Written to be handed to Claude Code as the build brief.*

---

## 0. Architecture in One Paragraph

The tool is an **event-sourced fog-of-war engine**. There is exactly one **Truth State** (the GM's reality), mutated only by an append-only **Event Log** produced by the **Tick Engine**. Each player side never reads Truth: it reads a **View Projection** — a pure function `project(truth, sideId, now) → ViewState` that filters by contact ladder level, on-net status, report delays, and light lag. All randomness comes from a **seeded, logged RNG** so the campaign is fully auditable afterward (the Table Covenant, core rules 13.3). Battles are not simulated: the engine emits a **Handoff Package**, humans fight it on the tabletop, and a **Battle Result** is ingested back.

```
Orders (per side) ─┐
                   ▼
            ┌─────────────┐    events     ┌──────────┐
            │ TICK ENGINE │──────────────▶│ EVENT LOG│──▶ Truth State
            └─────────────┘               └──────────┘        │
                 ▲    │ handoff package                       ▼
   Battle Result ┘    ▼                              project(side) ──▶ Player Views
                  Tabletop (humans)
```

**Recommended stack** (suggestion, not law): TypeScript everywhere; SQLite (or plain JSON files) for persistence of the event log; a small web server with one GM screen and N player screens (websocket push); hex math via `honeycomb-grid` or hand-rolled axial coords. No AI, no pathfinding cleverness needed in v1 — the GM is in the loop for everything ambiguous.

---

## 1. Conventions

### 1.1 Time
The base tick is the **Contact Turn (6 min)**. Everything else is integer multiples:

```ts
type Tick = number;                  // absolute ticks since campaign start
const TICKS_PER_PULSE = 10;          // 1 h
const TICKS_PER_WATCH = 60;          // 6 h
const TICKS_PER_DAY   = 240;
type ClockMode = 'WATCH' | 'PULSE' | 'CONTACT';
```

Day/night: `isNight(tick)` from campaign config (`dawnTick`, `duskTick` per day, default 0600/1800 local).

### 1.2 Identity & dice
```ts
type Id = string;                    // ulid/uuid
interface DieRoll { id: Id; tick: Tick; purpose: string; dice: '2d6'|'1d6';
                    result: number; seedCursor: number; }   // every roll logged
```

### 1.3 Space — three position layers, one union
```ts
// Module 0: operational (low-altitude) grid, axial coords per theater
interface GroundPos { kind:'ground'; theaterId: Id; q: number; r: number; }

// Module 1: high-altitude grid + altitude ladder
type Band = 'DECK'|'LOW'|'HIGH'|'SUBORBITAL'|'ORBIT';
interface AirPos { kind:'air'; gridQ: number; gridR: number; band: Band;
                   altLevel: number; velocity: number; vectorDeg: number; }

// Module 2: system node-and-lane graph
interface NodePos { kind:'node'; nodeId: Id; }
interface LanePos { kind:'lane'; laneId: Id; progressAU: number;
                    velocityKps: number; burnProfile: BurnProfile;
                    flipped: boolean; }
type Position = GroundPos | AirPos | NodePos | LanePos;
```

### 1.4 Terrain & infrastructure (Module 0)
```ts
type TerrainType = 'CLEAR'|'WOODS'|'ROUGH'|'HILLS'|'MOUNTAIN'|'WATER'|'SWAMP'|'URBAN';
type InfraTag = 'ROAD'|'RAIL'|'BRIDGE'|'TOWN'|'CITY'|'FORT'|'SPACEPORT'|'FACTORY'
              | 'HPG'|'DEPOT'|'SENSOR_STATION'|'AIRSTRIP';
interface Hex { theaterId: Id; q:number; r:number; terrain: TerrainType;
                infra: InfraTag[]; objective?: { vpPerDay:number; hidden:boolean;
                fake?:boolean; ownerSideId?: Id }; minefieldIds: Id[]; }
```

### 1.5 System graph (Module 2)
```ts
type NodeType = 'JUMP_ZENITH'|'JUMP_NADIR'|'PIRATE_POINT'|'PLANET'|'MOON'
              | 'GAS_GIANT'|'BELT_SECTOR'|'STATION_RECHARGE'|'STATION_OTHER'|'SHIPYARD';
interface SysNode { id: Id; type: NodeType; name: string;
                    theaterId?: Id;          // PLANET/MOON nodes embed a Module-0 theater
                    surveyedBy: Id[];        // sides holding the survey (pirate points)
                    secret: boolean; }       // pirate points start true
interface SysLane { id: Id; a: Id; b: Id; distanceAU: number; }
// transitDays(d_AU, g) = 2.835 * Math.sqrt(d_AU / g)   // flip-at-midpoint, arrive at rest
// noFlip: time/2 at arrival, velocity = a*t (ballistic; SLASH-only arrival)
```

---

## 2. Core Entities

### 2.1 Sides, units, people
```ts
interface Side { id: Id; name: string; vp: number;
                 commandNodes: Id[];          // formation/facility ids able to anchor nets
                 reprisalsOwed: number; }     // DEEP SKY 7.4

interface Pilot { id: Id; name: string; gunnery: number; piloting: number;
                  kills: number; ace: boolean; fatigue: number;       // SKYWATCH 11
                  status: 'OK'|'WOUNDED'|'DOWNED'|'CAPTURED'|'KIA'|'POOL'; }

interface Unit {                               // one 'Mech / vehicle / fighter / DropShip...
  id: Id; sideId: Id; name: string; model: string;
  class: 'MECH'|'VEHICLE'|'INFANTRY'|'BA'|'PROTO'|'VTOL'|'CONV_FIGHTER'
       | 'ASF'|'SMALL_CRAFT'|'DROPSHIP'|'JUMPSHIP'|'WARSHIP'|'SUPPORT'|'NAVAL';
  bv: number; pv: number;                      // BR derivations
  walkOrCruise: number; run: number; jump: number;
  safeThrust?: number; maxThrust?: number;
  fuel?: FuelLedger;                           // §2.4
  damage: 'OK'|'DAMAGED'|'CRIPPLED'|'DESTROYED'|'SALVAGE';
  pilotIds: Id[]; ammoState: 'FULL'|'PARTIAL'|'DRY';
  tags: string[];                              // 'ECM','BEAGLE','AA','C3M','MASH','HQ',
}                                              // 'ENGINEER','DECOY','SKYEYE','LF_BATTERY','SAIL'...

interface Formation {                          // the counter (core rules §3) — also flights & squadrons
  id: Id; sideId: Id; name: string; unitIds: Id[];
  pos: Position; facing?: number;
  omp: number; br: number; sigBase: number; sns: {passive:number; active:number};
  rdy: number;                                  // 0..10
  emcon: 'DARK'|'PASSIVE'|'ACTIVE';
  posture: 'NONE'|'HIDE'|'DUG_IN'|'DIGGING'|'FORTIFIED';
  onNet: boolean; netNodeId?: Id;
  currentOrderId?: Id; standingOrderIds: Id[];
  mounted?: { carrierFormationId: Id };
  alertState?: 'ALERT5'|'ALERT15'|'ALERT60'|'STAND_DOWN';   // flights (SKYWATCH 3.1)
  supply: { lastSuppliedTick: Tick; inSupply: boolean };
}
```

### 2.2 Facilities & logistics
```ts
interface Facility {           // airbase, depot, spaceport, recharge station, shipyard...
  id: Id; sideId: Id; pos: Position; tags: InfraTag[];
  fuelFarmTons: number; supplyPoints: number;
  turnaroundCrews: { total:number; busyUntil: Tick[] };
  isCommandNode: boolean; sensorStation?: {passive:number; active:number};
}
interface SalvageToken { id: Id; hex: GroundPos; sourceUnitId: Id; heldBy?: Id; }
interface Marker {             // downed crew, minefield, sentinel drone, fuel cache, decoy truth
  id: Id; kind:'DOWNED_CREW'|'MINEFIELD'|'SENTINEL_DRONE'|'FUEL_CACHE'|'WRECK';
  pos: Position; sideId?: Id; payload: Record<string, unknown>;
  beaconActive?: boolean;      // downed crew may go beacon-dark
}
```

### 2.3 Satellites & orbital schedule (core 8.6)
```ts
interface Satellite { id: Id; sideId: Id; kind:'RECON'|'COMM';
                      corridor: {q:number; r:number}[];      // 10-wide ground track centerline
                      periodPulses: number; nextPassTick: Tick; alive: boolean;
                      knownTo: Id[]; }                       // sides that can schedule around it
```

### 2.4 Fuel — one ledger, two lenses (SKYWATCH 2 / DEEP SKY 3)
```ts
interface FuelLedger {
  // tactical (fighters, small craft; DropShips at handoff)
  fp: number; fpPerTon: number;                // 80 ASF, 160 conv, ~30 large DropShip
  // strategic (DropShips/WarShips in transit)
  tons: number; tonsPerBurnDay?: number;       // e.g. 1.84
  jokerFp?: number; bingoFp?: number;          // recomputed continuously in flight
}
// invariant: fp == round(tons * fpPerTon) at conversion moments
// map-change conversion (TW): descending battle map: fp *= 2 ; ascending: fp = floor(fp/2)
```

### 2.5 Contacts — the heart of double-blind
Contacts are **per observer-side, per target formation**. Truth never leaks; views render only this:
```ts
type LadderLevel = 0|1|2|3|4;        // 0 none, 1 GHOST, 2 SHADOW, 3 CONTACT, 4 LOCK
interface Contact {
  id: Id; observerSideId: Id; targetFormationId: Id;
  level: LadderLevel;
  lastConfirmedTick: Tick;            // for fade: -1 level per pulse w/o redetect
  estPos: Position; posErrorHexes: number;    // GHOST: ±1
  estVector?: number; estSizeClass?: string; estComposition?: string;  // filled by level
  staleAsOfTick: Tick;                // light lag / off-net delay: when this info was TRUE
}
interface ContactReport {             // the narrative artifact players actually receive
  id: Id; sideId: Id; generatedTick: Tick; deliveredTick: Tick|null;   // null = undelivered (courier killed?)
  sourceFormationId: Id; contactId: Id; text: string;  // GM-editable before delivery (noise injection)
}
```

### 2.6 Orders — discriminated union with triggers
```ts
type GroundOrderKind = 'MOVE'|'FORCED_MARCH'|'HIDE'|'DIG_IN'|'PATROL'|'SCREEN'
                     | 'STRIKE'|'SHADOW'|'RESUPPLY'|'REST'|'REPAIR';
type AirMission     = 'CAP'|'ORBITAL_STANDBY'|'STRIKE'|'CAS'|'SWEEP'|'ESCORT'
                     | 'RECON'|'INTERDICTION'|'FERRY'|'TANKER'|'SAR';
type SpaceOrderKind = 'TRANSIT'|'COLD_COAST'|'STATION_KEEP'|'INTERCEPT'|'SKIM_FUEL'
                     | 'RECHARGE_SAIL'|'QUICK_CHARGE'|'JUMP'|'INSPECT'|'BLOCKADE'|'BOARD';

interface Trigger { when: 'CONTACT_WITHIN'|'DETECTED_SELF'|'TICK_REACHED'|'HEX_REACHED'
                        | 'FUEL_BELOW'|'RDY_BELOW'|'ALLY_ENGAGED';
                    param: number|string; }
interface Order {
  id: Id; sideId: Id; formationId: Id; issuedTick: Tick; effectiveTick: Tick;  // net delay applied here
  kind: GroundOrderKind|AirMission|SpaceOrderKind;
  path?: Position[]; targetContactId?: Id; targetHex?: GroundPos; station?: Position;
  burnProfile?: BurnProfile;                       // §3.4
  conditionals: { trigger: Trigger; thenOrder: Omit<Order,'conditionals'> }[];
  emconOverride?: Formation['emcon'];
}
interface ATO { id: Id; sideId: Id; pulse: number; orderIds: Id[]; }  // capturable object! (SKYWATCH 4)
```

---

## 3. Engine Subsystems (pseudocode-level)

### 3.1 The Tick Loop
```
loop:
  mode ← chooseClockMode()            // CONTACT if any cross-side pair within 5 op-hexes
                                      //   and at least one side has level ≥1 on the other;
                                      // PULSE if any theater has active ground ops;
                                      // else WATCH
  dt ← ticksFor(mode)                 // 1 / 10 / 60
  applyDueOrders(); moveEverything(dt); burnFuel(dt)
  runDetectionPass(); ladderFadePass(); deliverReports()
  evaluateTriggers(); evaluateEngagements()
  emitEventsToLog(); advanceClock(dt)
  if engagementPending: pause(), exportHandoff(), await ingestBattleResult()
  if nothingHappenedForAnySide: continue silently (compression)
  else: notify GM, render per-side diffs
```
"Nothing happened" = no new/changed contacts, no report deliveries, no trigger fires, no arrivals, no fuel threshold crossings, for **any** side. The GM screen always shows truth and may pause/inject at will.

### 3.2 Detection pass (core §6, SKYWATCH §5, DEEP SKY §4)
```
for each (searcher S, target T) of opposing sides sharing a layer:
  if outOfRange(S,T): continue
  tn ← T.sigBase
      + postureMods(T)        // hide+2, dugin+1, terrain, night(visual)+2, rain+1
      + emconMods(T)          // DARK+2, ACTIVE−2
      + motionMods(T)         // moving−1, forcedMarch/sprint−2, jump−2, firedThisTick−3
      + ecmMods(T) + stealthMods(T)
      + spaceMods(T)          // coasting=11 flat, burning/jumpflash = AUTO (skip roll)
  roll ← 2d6 + searcherMods(S)   // ACTIVE+2, PATROL+1, sensor specials
  if AUTO or roll ≥ tn:
      contact.level = min(4, level+1); contact.lastConfirmedTick = now
      contact.staleAsOfTick = now − lightLagTicks(S,T)        // DEEP SKY 4.2: 10 min/AU
      queueContactReport(S, contact)   // delivered only when source on-net; else hold
  side-effects: if S.emcon == ACTIVE → S is easier to find this tick (reciprocity)
artillery fire: firing hex auto-CONTACT to all enemy sensors in range + enemy batteries in range
ECM haze: ACTIVE searchers within range see an 'ECM_HAZE' pseudo-contact at the bubble hex
```

### 3.3 Net & report delivery (core §4.2)
```
formation.onNet ⇔ within net radius of a friendly command node
                   (12 op-hex ground node / 24 dropship-base / theater-wide if comm sat alive)
                   and not inside hostile ECM bubble and not EMCON DARK
reports from off-net sources: held until (back on net) | (courier order executes) — set deliveredTick then
order latency: onNet → next tick; offNet → undeliverable (conditionals keep running)
decapitation: command node destroyed → all formations netted to it go offNet;
              re-net = 1 pulse per formation to another node
```

### 3.4 Movement & fuel
```
GROUND (contact): spend OMP per hex cost table; (pulse): OMP×10 road / ×5 cross-country
AIR: ledger costs — takeoff(VSTOL 10/runway 4), climb 2/level, cruise 1 FP/high-hex @2 hex/min,
     dash 2 FP/hex @SafeThrust hex/min, loiter 2 FP/min (lean 1), orbit 0
     continuously recompute joker = rtbDashCost*1.25, bingo = rtbCruiseCost*1.10
SPACE: BurnProfile = {g: number, flipAtAU?: number, coastFromAU?: number}
     tonsBurned = tonsPerBurnDay * g * days(dt); position integration along lane
     arrival velocity from profile; noFlip ⇒ ballistic flag (SLASH-only)
```

### 3.5 Encounter classification (DEEP SKY §5)
```
MM(ship) = burnDaysRemaining * g_max * crewGLimitFactor
gap      = |ΔV| expressed in burn-days needed to null it
if both ~at rest at same node:            BLOCKADE
else if interceptor.MM ≥ 2*gap:           MATCHED
else if canReachPathInTime:               SLASH  (tabletop turns = 1d6+4, logged roll)
else if sameLane && behind:               STERN_CHASE (overtakeTick computed; battle then)
else:                                     NO_ENGAGEMENT (report near-miss to GM only)
```

### 3.6 Handoff Package (export) & Battle Result (import)
```ts
interface HandoffPackage {
  id: Id; tick: Tick;
  table: 'GROUND'|'LOW_ALT_ATMO'|'SPACE'|'GROUND_WITH_AIR';
  mapSpec: { terrainByHex?: TerrainType[]; sheetsHint: string[]; nodeName?: string };
  perSide: Array<{
    sideId: Id; entryEdge: 'N'|'NE'|'SE'|'S'|'SW'|'NW'|'ANY_HALF';
    deploysFirst: boolean; initiativeBonus: number; initiativeBonusTurns: number;
    hiddenSetup: boolean; fortified: boolean; rdyTnPenalty: 0|1|2;
    units: Array<{ unitId: Id; velocity?: number; altLevel?: number;
                   fpOnTable?: number; jokerFp?: number; bingoFp?: number;
                   ammoState: string; damage: string; pilotSkills: [number,number] }>;
    offboard: { artillery: Array<{unitId: Id; rangeHexesRemaining: number}>;
                airOnStation: Array<{formationId: Id; arrivesTurn: number; fpOnStation: number}>;
                reinforcements: Array<{formationId: Id; arrivesTurn: number; edge: string}> };
  }>;
  specialRules: string[];      // 'SLASH:9_TURNS', 'DROP_CORRIDOR', 'BOARDING', etc.
}
interface BattleResult {
  handoffId: Id; victorSideId?: Id; hexControlSideId?: Id;
  unitOutcomes: Array<{ unitId: Id; damage: Unit['damage']; fpRemaining?: number;
                        ammoState: string; pilotOutcomes: Array<{pilotId: Id; status: Pilot['status']}> }>;
  ejections: Array<{ pilotId: Id; pos: Position }>;     // → DOWNED_CREW markers
  withdrewVia?: Record<Id,'N'|'NE'|'SE'|'S'|'SW'|'NW'>; // feeds pursuit
  turnsElapsed: number; notes: string;
}
```
Optional v2: emit MegaMek-compatible unit lists (`.mul`) inside the package.

### 3.7 Jump board (DEEP SKY §7)
```ts
interface JumpDrive { vesselUnitId: Id; chargePct: number; chargeRateHrsTo100: number;  // 151–210 by star
                      sail: 'STOWED'|'DEPLOYED'|'DESTROYED'; lfBatteryCharged?: boolean;
                      kfDamage: 'NONE'|'MINOR'|'MAJOR'|'DEAD'; }
// deployed sail: vessel cannot thrust; capital hit on sail → DESTROYED
// emergency furl: 2 watches; roll ≤5 → chargePct = 0
// quick-charge attempt: 2d6 ≥8 success in 5 watches; ≤3 → kfDamage escalates (GM severity roll)
// pirate point jump: needs node.secret==false||surveyedBy.includes(side); 2d6 ≥9 (≥7 surveyed); ≤4 misjump table
```

---

## 4. View Projection (what each level reveals)

| Field | GHOST | SHADOW | CONTACT | LOCK |
|---|---|---|---|---|
| Position | ±1 hex / node only | exact-ish | exact | exact |
| Vector/heading | — | yes | yes | yes |
| Size class | — | yes | yes | yes |
| Composition (types/weights) | — | — | yes | yes |
| Full TO&E, damage, EMCON | — | — | — | yes |
| Targetable by arty/air w/o penalty | — | — | −2 | yes |

Plus per-side overlays: own formations & ledgers (always), scouted terrain only, aged ghosts (render with staleness timestamp), delivered reports inbox, own ATO/orders, VP track, **never** the RNG, never other sides' anything. The GM screen renders truth + all three views side-by-side + the event log + inject/noise controls.

---

## 5. Build Plan for Claude Code

**Milestone 1 — Kernel:** entities, event log, seeded RNG, tick loop with clock compression, Module-0 ground movement + detection + contact ladder + per-side views (text/JSON UI is fine). *Acceptance test:* scripted two-side scenario — a hidden battalion (DARK, woods, night) crosses a sensor line; verify TN math (SIG 5+2+1+2+2=12 ⇒ effectively invisible) and report delivery only when scout returns on-net.

**Milestone 2 — Orders & engagement:** order union + conditionals + net latency + Evasion + HandoffPackage/BattleResult round-trip incl. salvage tokens, RDY effects.

**Milestone 3 — SKYWATCH:** flight ledger engine, ATO plotting, alert states, chase mode, joker/bingo live calc, merge export with Energy State. *Acceptance test:* reproduce the Module-1 §12 Shilone day tick-for-tick (400→240→179→159 FP).

**Milestone 4 — DEEP SKY:** system graph, brachistochrone solver, burn-day ledgers + skimming, light-lag contact staleness, encounter classifier, jump board. *Acceptance test:* reproduce Module-2 §9.1 Operation SKEAN: jump flash latency 83 min at 10 AU; cold-coast detachment stays SIG 11 until the gas-giant picket's active sweep; classifier returns MATCHED with ~2.1 burn-day margin.

**Milestone 5 — Polish:** map UIs (hex render + system graph), GM noise-injection editor, MegaMek export, post-campaign audit viewer (replay the log with all fog lifted — the victory lap feature).

**Implementation notes for Claude Code:**
- Keep every formula in one `rules.ts` constants module mirroring the three rulebooks' quick-reference appendices — the user *will* house-rule numbers.
- Determinism: `(campaignSeed, eventIndex) → roll`; store `seedCursor` on every DieRoll.
- All projections pure functions; never persist player views.
- Unit tests = the quick-reference tables. The rulebooks are the spec; this document is the schema.

*Companion to the OVERRIDE core rules, SKYWATCH, and DEEP SKY documents. Fan project; BattleTech © The Topps Company, Inc., published by Catalyst Game Labs.*
