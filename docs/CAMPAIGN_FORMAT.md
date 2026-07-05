# OVERRIDE — Campaign File Format

A campaign is a single JSON file. `demo/campaign.json` is the worked example; this
documents every field. Load and run a custom file with:

```sh
npm run dev -- mycampaign.json --log mywar.jsonl
```

On load the file is **validated** — if anything is wrong you get a list of readable
problems (unknown side, hex out of bounds, bad unit class, …) instead of a crash.
Every field the validator knows is listed below; **bold = required**, the rest optional
with their defaults.

Coordinates are axial hex `q,r` (0-based). Time is in **ticks** (1 tick = 6 min;
10 = 1 pulse/hour; 60 = 1 watch/6h; 240 = 1 day). All game numbers live in
`src/rules.ts` — this file is only the *scenario*.

---

## Top level

```jsonc
{
  "seed": "CAVANAUGH-1",        // REQUIRED. Drives every die + the player access tokens.
  "config": { … },             // REQUIRED
  "theaters": [ … ],           // REQUIRED, ≥1
  "sides": [ … ],              // REQUIRED, ≥1
  "facilities": [ … ],         // optional
  "satellites": [ … ],         // optional
  "formations": [ … ],         // optional (but you'll want some)
  "commandNodes": { … },       // optional — who anchors each side's net
  "orders": [ … ],             // optional — pre-plotted opening orders
  "system": { "nodes": [], "lanes": [] },  // optional — the DEEP SKY layer
  "markers": [ … ]             // optional — minefields, downed crew, caches…
}
```

## `config`

| field | req | default | notes |
|---|---|---|---|
| **name** | ✓ | — | shown in the UI |
| dawnTick / duskTick | | 60 / 180 | tick-of-day; night raises detection TNs (D-006) |
| weather | | CLEAR | `CLEAR` · `RAIN` · `STORM` (rain +1 to detection) |
| vpThreshold | | — | first side to this many VP wins (core §12.2) |
| endTick | | — | campaign ends here; highest VP wins, tie = draw |
| airHexByTheater | | `{}` | `{ "theaterId": {"q":0,"r":0} }` — the ORIGIN of the theater's air region on the global air grid (D-037: the sky is congruent — air hex origin+(q,r) sits directly over ground hex (q,r)); `{q:0,r:0}` makes air and ground coordinates identical |

## `theaters[]` — the ground maps

```jsonc
{ "id": "cavanaugh", "name": "Cavanaugh Valley",
  "width": 24, "height": 16, "defaultTerrain": "CLEAR",
  "overrides": [ … ] }
```

Every hex starts as `defaultTerrain` with no infrastructure; `overrides` paint the
exceptions. Each override:

| field | req | notes |
|---|---|---|
| **q**, **r** | ✓ | must be inside `width`×`height` |
| terrain | | `CLEAR WOODS ROUGH HILLS MOUNTAIN WATER SWAMP URBAN` |
| infra | | array of `ROAD RAIL BRIDGE TOWN CITY FORT SPACEPORT FACTORY HPG DEPOT SENSOR_STATION AIRSTRIP COMM_RELAY` |
| objective | | `{ "vpPerDay": 3, "hidden": false, "fake": false, "ownerSideId": "blue" }` |

**Objectives**: `vpPerDay` scores daily for whoever holds the hex (uncontested
occupation flips control). `hidden` hides it from players until discovered/owned;
`fake` is a decoy that never scores; `ownerSideId` pre-assigns starting control.

## `sides[]`

```jsonc
{ "id": "blue", "name": "Cavanaugh Defense Force", "vp": 0 }
```
`vp` optional (default 0).

## `commandNodes`

```jsonc
{ "blue": ["blue-spaceport", "blue-line-co"], "red": ["red-hq"] }
```
Per side, the facility or formation ids that anchor the command net (core §4.2).
Formations within net range of one of these are on-net (orders/reports flow live).

## `facilities[]` — airbases, depots, sensor stations, spaceports

```jsonc
{ "id": "blue-airbase", "sideId": "blue", "name": "Airstrip Anvil",
  "theaterId": "cavanaugh", "q": 4, "r": 9,
  "tags": ["AIRSTRIP"], "fuelFarmTons": 25, "supplyPoints": 0,
  "turnaroundCrews": 2, "isCommandNode": false,
  "sensorStation": { "passive": 6, "active": 12 }, "activeSweep": true }
```

`sensorStation` makes it an early-warning radar; `activeSweep: true` runs it hot
(detects more, but a picket on ACTIVE is itself loud). `turnaroundCrews` is the count
of flights it can rearm/refuel at once. A `COMM_RELAY` tag makes the facility a
**relay mast** (D-048): chained back to a command node (≤ 24 hexes per hop, relays
included), it nets formations at the normal 12-hex radius — the authored way to keep a
distant garrison commandable, and an authored weak point for the enemy to cut.
Formations relay too: any unit with an `HQ` tag (Mobile HQs derive it from the sheet)
chains the same way while its formation is not EMCON DARK, not jammed, and not aboard
a carrier.

A `capitalBattery` makes the facility an **anti-capital emplacement** (D-050):

```jsonc
{ "id": "red-silo", "sideId": "red", "name": "Coastal Defense Silo",
  "theaterId": "cavanaugh", "q": 10, "r": 8,
  "capitalBattery": { "weapon": "WHITE_SHARK", "shots": 8 } }
```

`weapon` is any key in `rules.CAPITAL_WEAPONS` — 31 real Total Warfare capital and
sub-capital weapons (capital missiles `BARRACUDA WHITE_SHARK KILLER_WHALE`, naval
autocannons `NAC_10`…`NAC_40`, naval gauss/lasers/PPCs, mass drivers, and the
sub-capital line), each carrying its printed damage steps and range **bands**
(short/medium/long/extreme air hexes at the 1:1 18-km scale; to-hit 5/7/9/11 by
band). Sub-capitals and the Barracuda also track fighters. It fires on
capital hulls transitioning or flying inside its range — landing denial — with a
finite magazine (`shots`; energy mounts — naval lasers/PPCs, sub-capital lasers,
mass drivers — ignore it), and it is
silenced while an enemy ground formation stands in its hex. An optional
`"knownTo": ["blue"]` pre-spots the facility for those sides (public spaceports,
prewar maps — D-051.1); otherwise enemies learn it from recon photos, ground scouts,
or its own launch plume. Units: an optional
`"flak": N` on any unit overrides the derived flak battery strength (D-050 —
normally graded automatically from the card's guns when it carries the
Anti-Aircraft Targeting quirk).

## `satellites[]`

```jsonc
{ "id": "blue-sat-1", "sideId": "blue", "kind": "RECON", "theaterId": "cavanaugh",
  "corridor": [ {"q":0,"r":8}, {"q":23,"r":8} ], "periodPulses": 4, "nextPassTick": 20 }
```
`RECON` scans a 10-wide ground track every `periodPulses`; `COMM` extends the net
theater-wide while alive.

## `formations[]` — the counters

A formation lives in exactly **one** place — pick one position style:

- **ground**: `"theaterId": "cavanaugh", "q": 8, "r": 6`
- **air**: `"airPos": { "q": 0, "r": 0, "band": "HIGH", "altLevel": 6 }`
- **space**: `"nodeId": "zenith"`

```jsonc
{ "id": "blue-line-co", "sideId": "blue", "name": "Castle Company",
  "theaterId": "cavanaugh", "q": 5, "r": 8,
  "omp": 4, "sigBase": 6, "sns": { "passive": 4, "active": 8 },
  "emcon": "PASSIVE", "posture": "DUG_IN", "rdy": 10, "facing": 0,
  "alertState": "ALERT15",                      // flights only
  "flight": { "homeFacilityId": "blue-airbase" }, // marks an air formation grounded at a base
  "carrier": { "bays": 2, "crews": 1, "avFuelTons": 40 }, // a DropShip/carrier
  "mountedOn": "blue-dropship",                  // starts embarked in that carrier's bay
  "units": [ … ] }
```

| field | req | default | notes |
|---|---|---|---|
| **id**, **sideId**, **name** | ✓ | | |
| **sigBase** | ✓ | | base signature: Bn 5 · Co 6 · Lance 7 · single 9 · squad 10 |
| omp | | slowest unit's Walk MP | operational hexes per **hour** at the 18 km scale (mech ≈ 3, vehicle ≈ 4, hover/VTOL ≈ 8). If omitted, derived from the formation's **slowest** unit `walkOrCruise` (default 4) — so a unit's speed matters automatically; set `omp` to override |
| sns | | mech 2/4 | `{ passive, active }` sensor ranges |
| emcon | | PASSIVE | `DARK PASSIVE ACTIVE` |
| posture | | NONE | `NONE HIDE DUG_IN DIGGING FORTIFIED` |
| rdy | | 10 | readiness 0–10 |
| facing | | 0 | |
| alertState | | — | flights: `ALERT5 ALERT15 ALERT60 STAND_DOWN` |
| flight | | — | `{ homeFacilityId, homeCarrierId }` — present ⇒ air formation. `homeCarrierId` makes it **carrier-based**: RTB and joker/bingo track that DropShip as it moves |
| carrier | | — | `{ bays, crews, avFuelTons }` — marks a DropShip/carrier. `bays` caps embarked formations; recovered flights rearm from `crews` turnaround crews drawing `avFuelTons` of aviation fuel (GM screen → **Carrier ops**) |
| mountedOn | | — | id of a carrier this formation starts **embarked** in — it rides that carrier and can't move/fly on its own until it disembarks, drops, or launches |

### `units[]`

```jsonc
{ "name": "Castle Actual", "model": "Cyclops CP-10-Z", "class": "MECH",
  "tags": ["HQ"], "damage": "OK", "ammoState": "FULL",
  "pilot": { "name": "Maj. Vane", "gunnery": 3, "piloting": 4, "ace": false },
  "fuelFp": 400, "safeThrust": 6,                  // aerospace
  "fuelTons": 150, "tonsPerBurnDay": 1.84, "maxThrust": 4,  // DropShip/WarShip
  "drive": { "chargePct": 0, "sail": "STOWED" } } // JumpShip/WarShip K-F drive
```

| field | req | default | notes |
|---|---|---|---|
| **name** | ✓ | | |
| **class** | ✓ | | `MECH VEHICLE INFANTRY BA PROTO VTOL CONV_FIGHTER ASF SMALL_CRAFT DROPSHIP JUMPSHIP WARSHIP SUPPORT NAVAL` |
| model | | name | record-sheet model; `.mul` export splits "Chassis Model" on the last space |
| tags | | `[]` | `ECM ANGEL_ECM BEAGLE AA C3M MASH HQ ENGINEER DECOY SKYEYE LF_BATTERY STEALTH RECON WHEELED` … |
| damage | | OK | `OK DAMAGED CRIPPLED DESTROYED SALVAGE` |
| ammoState | | FULL | `FULL PARTIAL DRY` |
| pilot | | — | `"Name"` (regular 4/5) **or** `{ name, gunnery, piloting, ace, kills, status }` (skills 0–8). Named pilots have **careers**: XP from battles improves skills, kills earn the ace flag, wounds heal on the clock (README → career loop) |
| bv / pv / walkOrCruise / run / jump | | sensible | TO&E derivations, usually fine to omit |
| fuelFp / safeThrust | | — | aerospace tactical fuel (80 FP/ton) |
| fuelTons / tonsPerBurnDay / maxThrust | | — | strategic burn-day fuel (DropShips/WarShips, 30 FP/ton tactical) |
| drive | | — | K-F drive: `{ chargePct 0–100, sail STOWED/DEPLOYED/DESTROYED, kfDamage, chargeRateHrsTo100, lfBatteryCharged }` |

## `system` — the DEEP SKY layer (optional)

```jsonc
"system": {
  "nodes": [
    { "id": "zenith", "type": "JUMP_ZENITH", "name": "Zenith Point" },
    { "id": "cavanaugh-ii", "type": "PLANET", "name": "Cavanaugh II", "theaterId": "cavanaugh" },
    { "id": "mistral", "type": "GAS_GIANT", "name": "Mistral", "objective": { "vpPerDay": 1 } },
    { "id": "l1", "type": "PIRATE_POINT", "name": "L1", "secret": true }
  ],
  "lanes": [
    { "a": "zenith", "b": "cavanaugh-ii", "distanceAU": 10 },
    { "a": "zenith", "b": "mistral", "distanceAU": 4 }
  ]
}
```

Node `type`: `JUMP_ZENITH JUMP_NADIR PIRATE_POINT PLANET MOON GAS_GIANT BELT_SECTOR
STATION_RECHARGE STATION_OTHER SHIPYARD`. `theaterId` links a planet/moon to its ground
map. `secret: true` (pirate points) hides the node from players until surveyed.
`objective: { vpPerDay, ownerSideId }` makes a held node score VP/day. Lanes need
`distanceAU > 0` and both ends to exist.

### Standing rules (D-049)

A formation can carry **rules** — persistent if-then reflexes evaluated every step,
whatever order it is running, even off-net:

```jsonc
{ "id": "red-sap-0", "...": "...",
  "rules": [
    { "when": "CONTACT_WITHIN", "param": 2,
      "then": { "kind": "DEMOLISH", "targetHex": { "q": 21, "r": 33 } } },
    { "when": "RDY_BELOW", "param": 4, "then": { "kind": "REST" }, "repeat": true }
  ] }
```

`when`/`param` use the trigger vocabulary below; `then` takes `kind` plus optional
`path`, `targetHex`, `targetContactId`, `emconOverride`. A fired rule spawns its
then-order (which supersedes the current order and cancels any queued plan) and
disarms; `repeat: true` re-arms it when the trigger goes false again (edge-triggered).
Rules are the right home for wired demolition charges, registered fire missions, and
fall-back reflexes — they survive order changes, where conditionals die with their
order.

## `orders[]` — pre-plotted opening moves (optional)

```jsonc
{ "id": "order-red-1", "sideId": "red", "formationId": "red-recon-1",
  "kind": "MOVE", "effectiveTick": 0,
  "path": [ {"q":20,"r":6}, {"q":18,"r":7} ],
  "conditionals": [
    { "trigger": { "when": "CONTACT_WITHIN", "param": 5 },
      "then": { "kind": "STRIKE", "targetContactId": "contact:red:blue-line-co" } }
  ] }
```

`kind` is any ground (`MOVE FORCED_MARCH MOVE_CAUTIOUS HIDE DIG_IN PATROL SCREEN STRIKE
SHADOW RESUPPLY REST REARM REPAIR EMBARK DISEMBARK FIRE LAY_MINES BREACH DEMOLISH
BUILD_BRIDGE`), air (`CAP SWEEP RECON STRIKE_AIR CAS
ESCORT INTERDICTION FERRY TANKER SAR ORBITAL_STANDBY LIFT_OFF LAND ASCEND`) or space
(`TRANSIT COLD_COAST STATION_KEEP INTERCEPT SKIM_FUEL RECHARGE_SAIL QUICK_CHARGE JUMP
INSPECT BLOCKADE BOARD DESCEND`) order. `DESCEND` needs the vessel at a node with a
`theaterId` (a planet/moon); `ASCEND` climbs to `destinationNodeId` (defaults to the node
embedding the theater it flies over).

Extras: `airStation: {q,r}` + `airPath: true` (treat `path` as air hexes) + `airSpeed`
+ `loiterTicks` for air missions; `laneId`/`burnProfile` for space transits;
`targetContactId` for STRIKE/SWEEP/FIRE; `targetFormationId` for EMBARK (the carrier to
load into); `targetHex` for LAND/DISEMBARK, FIRE (the target hex), and
DEMOLISH/BUILD_BRIDGE (the work site — must be in or beside the engineer's hex);
`emconOverride`. `conditionals[]` fire even off-net (`when`: `CONTACT_WITHIN
DETECTED_SELF TICK_REACHED HEX_REACHED FUEL_BELOW RDY_BELOW ALLY_ENGAGED`, with
`param`); a `then` order may carry `path`, `targetContactId`, or `targetHex` (a wired
demolition charge is a conditional with `then: { "kind": "DEMOLISH", "targetHex":
{...} }`). An order may carry `afterOrderId` naming another order in the file: it becomes a
PLAN STEP that only activates once the named order completes (D-049 — steps of one plan
share an issuedTick; any newer activation cancels the stale remainder). Gotcha:
conditionals die with their order, and instant orders (HIDE, DEMOLISH) complete
immediately — a trigger that must outlive its order belongs in the formation's
`rules[]`, not in `conditionals[]`.

## `markers[]` — battlefield furniture (optional)

```jsonc
{ "id": "mf-1", "kind": "MINEFIELD", "theaterId": "cavanaugh", "q": 12, "r": 8, "sideId": "blue" }
{ "id": "crew-1", "kind": "DOWNED_CREW", "nodeId": "mistral", "beaconActive": true }
```
`kind`: `DOWNED_CREW MINEFIELD SENTINEL_DRONE FUEL_CACHE WRECK`. Position is either
`theaterId+q+r` or `nodeId`. `payload` (object) carries kind-specific data.

---

## Minimal complete example

```json
{
  "seed": "SKIRMISH-1",
  "config": { "name": "Border Skirmish", "vpThreshold": 10 },
  "theaters": [{ "id": "valley", "name": "Valley", "width": 20, "height": 14,
    "defaultTerrain": "CLEAR",
    "overrides": [{ "q": 10, "r": 7, "infra": ["TOWN"],
      "objective": { "vpPerDay": 2, "hidden": false } }] }],
  "sides": [{ "id": "blue", "name": "Defenders" }, { "id": "red", "name": "Raiders" }],
  "facilities": [{ "id": "blue-base", "sideId": "blue", "name": "Base", "theaterId": "valley",
    "q": 2, "r": 7, "tags": ["DEPOT"], "supplyPoints": 30, "isCommandNode": true }],
  "satellites": [],
  "formations": [
    { "id": "blue-co", "sideId": "blue", "name": "Guard Company", "theaterId": "valley",
      "q": 4, "r": 7, "omp": 4, "sigBase": 6,
      "units": [{ "name": "Cyclops", "model": "Cyclops CP-10-Z", "class": "MECH", "tags": ["HQ"] }] },
    { "id": "red-lance", "sideId": "red", "name": "Raider Lance", "theaterId": "valley",
      "q": 17, "r": 7, "omp": 5, "sigBase": 7, "emcon": "DARK",
      "units": [{ "name": "Panther", "model": "Panther PNT-9R", "class": "MECH" }] }
  ],
  "commandNodes": { "blue": ["blue-base"], "red": ["red-lance"] },
  "orders": [{ "id": "red-advance", "sideId": "red", "formationId": "red-lance",
    "kind": "MOVE_CAUTIOUS", "path": [{ "q": 14, "r": 7 }, { "q": 11, "r": 7 }] }]
}
```

Validate it just by trying to run it — the loader reports any problems by line of intent,
e.g. `mycampaign.json has 2 problem(s): - formation "red-lance": hex 17,7 is outside
theater "valley" (20×14) …`.
