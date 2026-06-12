# BATTLETECH: OVERRIDE
### Operational Command Rules for Double-Blind Campaign Play

*"The map is not the territory. The territory is what your sensors say it is — until a PPC says otherwise."*

OVERRIDE is a campaign layer that sits on top of standard BattleTech. It uses the **Low-Altitude Map** and **High-Altitude Map** from *Total Warfare* as the standard movement framework for *every* asset in a combined-arms BattleTech force — from a foot infantry platoon to a *McKenna*-class battleship. It is built ground-up for **double-blind play with a GameMaster running a digital tool**: players never see the true map, only the intelligence picture their forces have earned.

When opposing formations collide, OVERRIDE hands off cleanly to a normal BattleTech tabletop battle (or Alpha Strike, or a quick-resolution roll), then absorbs the results back into the campaign — damage, ammo, salvage, pilots, and all.

**Design pillars:**
1. **One movement grid for everything.** The aerospace hex scales already published in *Total Warfare* are reused as the operational and strategic grid. No new maps to invent.
2. **Information is the resource.** Tonnage wins battles; intelligence decides which battles happen.
3. **Everything in the box matters.** Artillery, satellites, VTOLs, engineers, MASH trucks, decoys, and DropShips all have a job that BattleMechs cannot do.
4. **It must still feel like BattleTech.** Walking MP, BV, Long Tom ranges, jump points, EMCON drama, and the eternal truth that an Urbanmech in a city hex is a problem.

---

## 1. The Two Spheres: Scale & Maps

OVERRIDE plays on two nested hex grids, both straight out of the aerospace rules:

| Sphere | Grid | 1 Hex Equals | Who Lives Here |
|---|---|---|---|
| **Operational Sphere** | Low-Altitude Map | One ground mapsheet (~500 m across) | All ground forces, VTOLs, atmospheric aerospace, landed DropShips |
| **Strategic Sphere** | High-Altitude Map | One full low-altitude map | Orbiting DropShips, WarShips, satellites, JumpShips at the system edge, inbound drops |

**The Theater.** The GM builds the campaign theater as one or more low-altitude maps (a 30×40 hex theater is roughly 15×20 km — a continent's worth of fighting at BattleTech engagement densities). Each low-altitude hex carries:
- **Terrain type** (see 5.2) — this also dictates which mapsheets are used if a battle erupts there.
- **Infrastructure tags** — Road, Rail, Bridge, Town, City, Fortification, Spaceport, Factory, HPG, Depot, Sensor Station.
- **Objective markers** (GM-only until discovered).

**The Orbital Shell.** A standard high-altitude map sits "above" each theater. Its atmospheric interface row is the gateway between spheres: drops, landings, launches, and atmospheric strikes all transit through it (Section 8).

**The golden conversion:** because one low-altitude hex = one ground mapsheet, every range published "in mapsheets" in *Tactical Operations* (artillery!) converts to operational hexes **1:1, with zero math.** This is not a coincidence; it is the reason OVERRIDE uses this scale.

---

## 2. The OVERRIDE Clock

Double-blind campaigns die when players spend an evening moving counters through empty terrain. OVERRIDE uses a **two-speed clock** managed by the GM tool:

### 2.1 Pulses (Strategic Time)
- **1 Pulse = 1 hour.** 24 pulses per day, with a day/night track (night affects detection, Section 6).
- During pulses, players submit **Orders** (Section 4) for each formation. The GM tool executes all sides' orders simultaneously and silently.
- The GM tool **compresses time**: if no detection events, contacts, fires, or order-triggers occur, it fast-forwards pulse after pulse, stopping only when *something happens for someone*. Players experience "Pulse 0600… Pulse 1100, new contact report" — exactly like a real command staff.

### 2.2 Contact Turns (Operational Time)
- When opposing formations are within **5 operational hexes** of each other *and at least one side knows it*, the GM drops the clock into **Contact Turns of 6 minutes** (10 per pulse).
- In contact time, movement is resolved hex-by-hex, detection is rolled every turn, and players make real maneuver decisions: flank, screen, withdraw, spring the ambush.
- If formations enter the same hex (or choose to engage at range with fires), go to **Engagement** (Section 7).
- When no live contact remains, the GM zooms back out to pulses.

### 2.3 The Elegant Bit
A unit's **Operational MP (OMP) equals its Walking/Cruise MP**, spent per contact turn (6 min) at 1 OMP per clear hex. A 4/6 'Mech formation crossing 4 × 500 m hexes per 6 minutes is moving ~20 km/h cross-country — exactly right for a combat formation in hostile territory. During pulses, a formation on a Move order covers **OMP × 10 hexes per pulse** on roads, **OMP × 5** cross-country (terrain permitting). The numbers you already know *are* the campaign numbers.

---

## 3. Formations: The Counters

Players do not push individual 'Mechs around the theater; they push **Formations** — a lance, a star, a company, an armor platoon, a battery, a DropShip. Every formation is a counter in the GM tool with five stats, all derived from its real TO&E:

| Stat | Meaning | Derived From |
|---|---|---|
| **OMP** | Operational Movement Points | *Slowest* Walk/Cruise MP in the formation |
| **BR** | Battle Rating | Total BV2 ÷ 100 (or total Alpha Strike PV) — used for quick resolution & intel sizing |
| **SIG** | Signature — how hard it is to detect | Base by size (3.1), modified by posture |
| **SNS** | Sensor Rating — how well it detects | Best sensor suite in the formation (6.2) |
| **RDY** | Readiness 0–10 | Starts 10; eroded by combat, forced march, supply failure |

### 3.1 Base Signature
Bigger formations are easier to find. Detection rolls (Section 6) must equal or exceed the target's SIG on 2d6 after modifiers:

| Formation Size | Base SIG |
|---|---|
| Battalion+ / DropShip (grounded) | 5 |
| Company / Trinary / large convoy | 6 |
| Lance / Star / platoon column | 7 |
| Single vehicle or 'Mech / BA squad | 9 |
| Foot infantry squad / sensor team | 10 |

### 3.2 Readiness
RDY is the formation's fuel-fatigue-morale gauge:
- −1 per battle fought; −2 if it lost. −1 per pulse of **forced march** (moving at +50% pulse speed). −1 per day without supply (Section 10).
- At **RDY 7–5:** +1 to all Piloting/Gunnery TNs in battles. At **RDY 4–2:** +2, and the formation must roll 8+ on 2d6 to accept an Attack order. At **RDY 1–0:** the formation will only Defend, Withdraw, or Rout.
- Recover +2 RDY per full pulse of **Rest** in supply; +1 if resting without supply.

### 3.3 Mixed Formations & Transports
- Infantry mounted in vehicles/APCs use the carrier's OMP. Dismounting/mounting costs a full contact turn.
- A formation moves at its slowest element. Detaching a sub-formation (e.g., dropping the Saladins off to sprint ahead) creates a new counter mid-game — the GM tool should make this one click.
- Towed artillery, support trucks, and MASH units have OMP 2 (wheeled, road-bound: they pay double for non-road hexes).

---

## 4. Command & Orders: The Double-Blind Engine

This is the heart of OVERRIDE. **Players never see the GM's map.** Each side has its own filtered view showing only: its formations, terrain it has scouted, and enemy **contacts** at their current intelligence level (Section 6.4).

### 4.1 Orders
During each pulse (or each contact turn, in contact time) players issue one order per formation:

| Order | Effect |
|---|---|
| **Move** (path) | Travel the plotted path. SIG −1 (moving things are louder). |
| **Forced March** | Move ×1.5 speed. SIG −2, RDY −1 per pulse. |
| **Hide** | Hold position, EMCON Dark, max concealment. SIG +2 (harder to detect). Cannot use active sensors. |
| **Dig In** | After 2 pulses: counts as fortified in battle (cover, +1 init); SIG +1. Engineers halve the time. |
| **Patrol** (radius) | Sweep up to 3 hexes around position; counts as actively searching. |
| **Screen** (line) | Hold a hex line; automatically intercepts enemy formations attempting to pass. |
| **Strike** (target hex/contact) | Close with and attack a known contact. |
| **Shadow** (contact) | Maintain 3–5 hex distance from a contact, keep it detected, avoid engagement. |
| **Resupply / Rest / Repair** | Logistics actions (Section 10). |
| **Conditional** | Any order with a trigger: *"If contact within 6 hexes of Hill 204, fall back to phase line BLUE."* The GM tool executes these even when the player isn't 'present' at that formation. |

### 4.2 Command Nets & the Fog Inside Your Own Army
BattleTech is a universe of jammed comms and lostech. OVERRIDE makes your own C3 a gameplay object:

- Each side has one or more **Command Nodes**: a Mobile HQ vehicle, a command 'Mech (e.g., *Cyclops*, *Atlas* with comms gear), a grounded command DropShip, or a fixed base.
- A formation within **12 operational hexes** of a friendly Command Node (24 for a DropShip/base; satellite relay = theater-wide) is **on-net**: it can receive new orders instantly and its contact reports appear on the player map in real time.
- A formation **off-net** runs on its last orders (including conditionals). Its contact reports arrive only when it returns to net or sends a courier/VTOL relay — the GM tool timestamps and *delays* this intelligence. Yes, that means you can be looking at where the enemy was three hours ago. Welcome to operational command.
- **Decapitation matters:** destroy a Command Node and every formation on that net goes off-net until command is re-established (1 pulse per formation to re-net to another node). ECM bubbles (Guardian, Angel) can locally cut nets too.

### 4.3 Written Truth
All orders go to the GM tool with a pulse timestamp. Disputes are settled by the log, not by memory. The tool is the referee's referee.

---

## 5. Operational Movement: Everything On One Grid

### 5.1 Movement Rates by Asset Class

All speeds in operational hexes per **contact turn** (6 min). Pulse movement = ×10 on roads, ×5 cross-country.

| Asset | OMP (per contact turn) | Notes |
|---|---|---|
| BattleMechs / ProtoMechs | Walk MP | May **Sprint** (Run MP) for 1 turn per 3 turns; SIG −2 while sprinting |
| Tracked / Wheeled vehicles | Cruise MP | Wheeled pay double in rough/woods/swamp; ×½ cost on roads |
| Hovercraft / WiGE | Cruise MP | Free over water/swamp; cannot enter mountain hexes |
| Battle Armor | Ground/Jump MP (min 1) | Usually mounted on omnis or APCs |
| Foot / Motorized / Mech. infantry | 1 / 2 / 3 | Foot infantry in covering terrain gets SIG +2 |
| VTOLs | Cruise MP ×2 | Ignore terrain; must land or return to base for fuel every 20 turns |
| Conventional fighters | Safe Thrust ×8 | Atmosphere only; cheap CAP and recon |
| Aerospace fighters | Safe Thrust ×16 | Effectively theater-wide per turn; played as **Sorties** (Section 8.4) |
| DropShips (atmo flight) | Safe Thrust ×8 | Landing/lifting takes a full contact turn at SIG 0 — everyone sees it |
| Naval vessels | Cruise MP | Water hexes only; superb artillery platforms |
| Rail movement | 12 | Along rail hexes only; instant battalion shuffles — until someone blows the bridge |

### 5.2 Operational Terrain

Each low-altitude hex has a dominant terrain (per *TW* low-altitude terrain, extended):

| Hex Terrain | OMP Cost | Battle Mapsheets | Detection Effect |
|---|---|---|---|
| Clear / Fields | 1 | Open terrain sheets | — |
| Woods / Jungle | 2 | Heavy woods sheets | Targets SIG +1 |
| Rough / Badlands | 2 | Rolling hills, rough | — |
| Hills | 2 | Hill sheets | Blocks visual LOS between ground formations |
| Mountain | 3 ('Mechs/infantry only) | Mountain sheets | Blocks LOS; radio shadow (off-net unless relay) |
| Water (deep) | — (naval/hover only) | Lake/coast sheets | — |
| Swamp | 3 (hover: 1) | Swamp sheets | Targets SIG +1 |
| Urban / Town | 1 | City sheets | Targets SIG +2; infantry SIG +3 |
| Road / Rail (overlay) | ½ (min 1) | Add road | Movement on roads SIG −1 (predictable) |

**LOS on the operational map:** ground-to-ground visual detection requires an unblocked line of hexes (hills/mountains/urban block). Sensors care less about LOS; satellites and aircraft ignore it entirely.

### 5.3 Forced March & Breakdown
Formations on Forced March risk it: each pulse, roll 2d6; on a 3 or less, one unit (GM picks, weighted to vehicles) suffers a breakdown and is left behind with a crew (recoverable by Repair order). The Inner Sphere runs on duct tape.

---

## 6. Intelligence & Detection: The Real Game

Nothing on the enemy side appears on your map unless you *earn* it. Detection is rolled by the GM tool — silently, constantly.

### 6.1 Emissions Posture (EMCON)
Every formation holds one of three postures, set by its order:

| Posture | Effect on Being Detected | Effect on Detecting |
|---|---|---|
| **DARK** | SIG +2 | Passive sensors only, SNS −2; off-net (no transmissions!) unless using couriers/laser links |
| **PASSIVE** (default) | — | Passive sensor ranges |
| **ACTIVE** | SIG −2 (you are a lighthouse) | Active sensor ranges (doubled), SNS +2 |

The reciprocity is the drama: lighting up your radar is the fastest way to find them — and to be found.

### 6.2 Sensor Ranges (in operational hexes)

| Sensor Source | Passive | Active |
|---|---|---|
| Standard 'Mech / vehicle sensors | 2 | 4 |
| Beagle Probe / Clan AP in formation | 3 | 5 |
| Recon VTOL / conventional ftr (per pass) | 4 | 8 |
| Mobile HQ / sensor vehicle / Listening Post | 4 | 8 |
| Fixed Sensor Station hex | 6 | 12 |
| Aerospace recon sortie | scans a 5-hex-wide corridor along its flight path | — |
| Recon satellite (per orbital window) | scans a 10-hex-wide ground track | — |
| Mk1 Eyeball (any formation, visual, LOS) | 3 (1 at night) | — |

### 6.3 The Detection Roll
Each contact turn (each pulse in strategic time), for every searcher/target pair in range, the GM tool rolls **2d6 ≥ target's modified SIG**:

**Target SIG modifiers** (apply to the TN):
- Moving −1; Forced March / Sprinting −2; Jump jets used −2
- **Fired weapons this turn: −3** (artillery: automatic detection of firing hex — counter-battery radar is a thing, see 9.3)
- Hide order +2; Dug in +1; terrain bonus per 5.2; Night +2 *vs visual only*
- Guardian-class ECM in formation +1 (Angel +2) — but a hex with ECM running shows as a **"haze"** anomaly to Active searchers within range (ECM is itself an emission; clever players exploit this both ways)
- Stealth-armored single units +2
- Rain/storm +1 (all sensors), but thunderstorms ground VTOLs and scatter drops

**Searcher modifiers** (apply to the roll): ACTIVE +2; Patrol order +1; SNS specials per 6.2.

### 6.4 The Contact Ladder
Each success climbs the target one rung; each pulse with no successful detection drops it one rung (it fades to a last-known-position ghost on the player map):

| Level | Codename | What the Player's Map Shows |
|---|---|---|
| 0 | — | Nothing |
| 1 | **GHOST** | "Something" in a hex: an unidentified return, no size, ±1 hex position error |
| 2 | **SHADOW** | Size class (lance? company? battalion?) and movement vector |
| 3 | **CONTACT** | Composition by type & weight class ("4 heavy 'Mechs, ~6 vehicles"), accurate position |
| 4 | **LOCK** | Full TO&E, damage state, EMCON posture; can be targeted by artillery/airstrikes without spotter penalty |

A formation in the same hex as an enemy, or that survives a battle against it, gets automatic LOCK.

### 6.5 Deception: Fighting the Sensor War
- **Decoy formations:** dedicated comms trucks or infantry with transmitters imitate a formation at one size class larger. They are real counters with SIG as the faked size; a CONTACT-level detection (or a visual at ≤2 hexes) exposes them. Cheap. Devastating. Very Davion.
- **Emission discipline plays:** a battalion moving DARK on a stormy night through woods (SIG 5 +2 +1 +1 +2 = TN 11) is functionally invisible. This is how Kurita does it.
- **Chaff & feints:** firing one artillery round from a hex you're abandoning hands the enemy a confident, wrong LOCK.
- **Counter-intel:** destroying scouts before they return to net deletes their undelivered reports from the enemy map. Killing the messenger works.

### 6.6 What the GM Tool Sends Players
Intelligence arrives as timestamped **contact reports**, only when the detecting formation is on-net:

> *PULSE 1400 — FLASH — Recon Lance "Vixen": SHADOW, company-strength armor column, hex 2117, heading NW along Route 9. Confidence: moderate.*

The tool should let the GM inject noise: false positives in storms, stale duplicates, a GHOST that's actually migrating fauna. Sparingly. Cruelly.

---

## 7. Engagement: From Counters to the Tabletop

### 7.1 Triggering Battle
Battle occurs when (a) opposing formations occupy the same operational hex, (b) a Screen order intercepts a mover, or (c) a Strike order reaches its target. The defender may attempt **Evasion** before setup: opposed 2d6 + OMP + (2 if attacker only has GHOST/SHADOW); winner by 3+ slips away, moving 2 hexes any direction — but is automatically detected at CONTACT.

### 7.2 Battle Generation — The Handoff
The operational state dictates the tabletop, automatically:

1. **Mapsheets:** drawn from the hex's terrain type (5.2). Adjacent-hex terrain seeds the map edges.
2. **Entry edges & deployment:** each side enters from the map edge matching its operational approach vector. A formation that was Hiding or Dug In sets up hidden/fortified per *TW/TO* rules. Ambushes earned on the operational map are ambushes on the table.
3. **Intelligence = initiative:** compare contact levels on each other. Each level of advantage = +1 initiative for the first 3 turns, and the disadvantaged side deploys first.
4. **Readiness:** apply RDY skill penalties (3.2).
5. **Reinforcements:** any friendly formation within N operational hexes arrives on turn (N × 5) on the appropriate edge, if on-net and ordered in. Battles create gravity.
6. **Off-board support:** artillery in range (Section 9) and on-station air sorties (8.4) are available per their standard rules.

### 7.3 Three Resolution Modes
The GM picks per engagement (sides should agree on defaults in session zero):
- **Full BattleTech:** total warfare, the long way. Best for the campaign's set-piece battles.
- **Alpha Strike:** for big multi-formation collisions.
- **Quick Resolution (GM roll-off):** for skirmishes nobody wants to set a table for. Each side rolls 2d6 + (BR advantage: +1 per 25% edge) + (intel advantage) + (terrain/fortification +1/+2) + (RDY mods). Compare totals: loser takes (difference × 5)% of its BR as damage, distributed by the GM across units (destroyed/crippled/damaged); winner takes half that. Loser retreats 1 hex per point of difference. Re-roll each contact turn if both sides press.

### 7.4 Breakoff & Pursuit
On the tabletop, a side may withdraw off its entry edge; the operational pursuit then runs in contact turns (faster OMP catches slower). Hovercraft earn their keep here. A routing formation (RDY ≤ 1) moves at forced-march speed away from all known contacts and cannot be ordered for 2 pulses.

### 7.5 The Field Belongs to the Victor
The side holding the battle hex afterward controls **salvage**: downed enemy machines become salvage tokens (Section 10.4). This single rule makes "winning ugly" matter, exactly as it should in BattleTech.
---

## 8. Aerospace Operations: The Strategic Sphere

The high-altitude map is its own theater, and whoever wins it shapes everything below.

### 8.1 Arrival & The Jump
- JumpShips arrive at the zenith/nadir point (or a **pirate point**, GM approval + 9+ on 2d6; failure = misjump mishap table). Transit from standard points to orbit takes **days** at 1G — the GM tool tracks the burn as a countdown visible only to the owner... unless detected.
- An inbound DropShip under thrust is a torch. Planetary sensor stations and satellites detect burning DropShips automatically at 3 days out; a **ballistic ("cold") approach** is SIG 8 to detect per day but triples transit time and forces a high-G terminal burn (Piloting checks, RDY −1 to embarked troops).

### 8.2 Orbital Control
Each pulse, compare aerospace strength in the orbital shell (sum of fighter/DropShip/WarShip BR on station):

| Status | You Get |
|---|---|
| **Supremacy** (3:1+) | Free satellite passes, drops anywhere, orbital fire support, enemy aerospace grounded or dead |
| **Superiority** (3:2+) | Sorties at no penalty; enemy sorties intercepted on 8+ |
| **Contested** | Every sortie risks interception (8.5) |
| **Denied** | Your sorties intercepted on 6+; no drops without escort |

### 8.3 Combat Drops & Landings
- **Drop:** a DropShip on the interface row releases formations onto any target hex within its drop corridor. Scatter: 1d6 hexes in a random direction, reduced by 1 per point the Piloting check succeeds, +2 hexes if dropped through thunderstorm or ECM-heavy hex. Dropping troops arrive at LOCK-level visibility to anyone watching the sky — but they arrive *now*, anywhere. The fundamental BattleTech trade.
- **Landing:** a DropShip grounds in a clear/spaceport hex (full contact turn, SIG 0 during descent). Grounded DropShips are Command Nodes, supply depots (10.2), and SIG 5 artillery magnets. Protect them or lift them.
- **Lifting under fire** requires a Piloting check at +2; enemy formations in the hex get a free engagement round first.

### 8.4 Sorties (Fighters & Conventional Aircraft)
Aerospace doesn't crawl the map; it **sorties** from a base hex (spaceport, grounded DropShip, airstrip) or carrier:
1. Player declares mission: **CAP** (defend a 6-hex zone), **Strike** (hit a contact ≥ SHADOW), **Recon** (scan corridor, 6.2), **Interdiction** (attack supply movement along a route), or **Escort**.
2. Transit is near-instant on the operational map (Safe Thrust ×16); the real currency is **fuel/turnaround**: each sortie costs 1 pulse out, time on station (CAP: up to 4 pulses; conventional fighters 8 — they sip fuel), 1 pulse back, 2 pulses rearm.
3. **Strikes** resolve per standard air-to-ground rules on the tabletop if a battle is running, or as a Quick Resolution attack (BR of the flight vs target, target gets AA bonuses: +2 if the formation includes dedicated AA units — bring your Partisans).
4. Strikes against anything below CONTACT level suffer −4: you cannot bomb a GHOST, you can only bomb a hex and pray.

### 8.5 Interception
In Contested/Denied air, each sortie risks interception (8.2). Resolve as an aerospace engagement (full rules on the high/low-altitude map — they're already the right scale! — or quick resolution). Surviving aborted sorties return to base.

### 8.6 Satellites & Orbital Windows
- Each recon satellite has an orbital period: its ground track (a 10-hex corridor chosen at launch) is scanned **once every 4 pulses**. Predictable — which means the enemy who spots your satellite (Active sensors, or witnessing the launch) can *schedule around your eyes*. Hiding from the sky on a timetable is a core OVERRIDE skill.
- Comm satellites extend command nets theater-wide.
- Satellites can be killed by aerospace sortie or capital weapons; doing so blinds a side dramatically and is worth a battle by itself.

### 8.7 Orbital Fire Support
With Supremacy and a WarShip or capital-missile DropShip on station: bombard a LOCK-level target hex. Treat as massed artillery (9) with a 1-pulse delay and the subtlety of a falling moon. Collateral: infrastructure tags in the hex degrade one step. The Ares Conventions are watching.

---

## 9. Fires: Artillery, Missiles & the Long Arm

Because 1 operational hex = 1 mapsheet, **published artillery ranges work natively**:

| System | Operational Range (hexes) |
|---|---|
| Arrow IV | 8 |
| Thumper | 21 |
| Sniper | 18 |
| Long Tom | 30 |
| Cruise Missile 50/70/90/120 | 50 / 70 / 90 / 120 (cross-theater) |

### 9.1 Fire Missions
A battery with a fire order shoots once per contact turn (or once per pulse at harassment rate):
- **Against LOCK targets:** resolve normally (on table if a battle is running; otherwise Quick Resolution: 2d6 + battery BR/5 vs target, damage as 7.3, infantry and soft vehicles suffer double).
- **Against CONTACT:** −2. **Against SHADOW/GHOST or bare hexes:** −4, and a miss tells the enemy *exactly* what you don't know.
- **Spotting:** a friendly formation with LOS to the target removes intel penalties — the classic forward-observer loop, now an operational decision about where your scouts die.

### 9.2 Counter-Battery
Any artillery shot **automatically reveals its firing hex at CONTACT level** to every enemy formation with sensors in range and to any enemy battery within its own range (counter-battery radar). Shoot-and-scoot (fire, then Move) is the entire lifestyle of an OVERRIDE artillerist.

### 9.3 Minefields & Engineers
- Engineer formations may, per pulse: lay a minefield in their hex (hidden; revealed when it bites — entering enemies take a Quick Resolution hit at BR 3), breach one (2 pulses), blow a Bridge/Rail tag (instant, loud, SIG −3), build a bridge (4 pulses), or fortify (halves Dig In time, 4.1).
- Blown bridges turn rivers back into walls. Tracked battalions reroute; hover battalions grin.

---

## 10. Logistics: The War Behind the War

### 10.1 Supply Points (SP)
Abstracted but sharp. Each formation consumes **1 SP per day** (double on a day it fought or forced-marched). SP live in **Depots**: spaceport hexes, grounded DropShips, depot tags, or supply convoys (truck formations carrying 10 SP each, OMP 3, SIG 5 — fat, slow, delicious targets).

### 10.2 Lines of Supply
A formation is **in supply** if a path of friendly-controlled hexes ≤ 30 hexes (½ off-road) connects it to a depot, OR a convoy reaches it. Out of supply: RDY −1/day, no ammo replenishment, energy-weapon-only loadouts start looking very wise.

### 10.3 Interdiction
Convoys and supply lines can be hit by raids, air interdiction sorties, and partisan infantry. A campaign can be won by an enemy who never wins a battle and never lets you fight at full ammo. This is intended.

### 10.4 Repair & Salvage
Between battles, formations on Repair orders at a depot/MASH/repair-vehicle:
- Re-arm: 1 SP per unit re-ammoed. Armor repair: 1 pulse per 2 units (field) / per 4 (depot). Internal/critical repairs: depot only, 1 SP + 4 pulses per unit, 8+ on 2d6 for lostech.
- **Salvage tokens** (7.5) hauled to a depot (needs a transport/recovery vehicle) yield: a repairable unit on 8+ (2d6), else 2 SP of parts. Captured *intact* depots and spaceports change hands with their SP. Garrison your rear.
- **MASH formations:** each MASH in your force allows one downed pilot/crew per battle to return after 2 days instead of being lost for the campaign. Dispossessed pilots pool at depots awaiting salvage 'Mechs — a very BattleTech economy of grief and reward.

---

## 11. Special Assets Quick Sheet

| Asset | Operational Role |
|---|---|
| **Recon VTOLs** | Best detection-per-C-bill in the game; fragile; fuel-limited |
| **Battle Armor** | Ride omnis; SIG 9 ambushers; only infantry that survives discovery |
| **Hidden infantry** | In Urban/Woods at Hide: SIG 13+ — effectively invisible listening posts until they fire |
| **Listening posts** | Infantry + sensor kit: passive 4-hex bubble, feeds the net while DARK (laser uplink) |
| **C3 networks** | Formation fights with C3 bonuses on-table *only if* on-net at battle start — protect the master |
| **Mobile HQ** | Command Node + SNS 4/8; its loss is a 4.2 decapitation event |
| **Decoy/EW trucks** | Section 6.5; also: one per side may attempt **net intrusion** vs an enemy on ACTIVE: 10+ on 2d6 steals one random enemy contact report this pulse |
| **Naval assets** | Mobile Long Tom platforms with absurd RDY endurance; oceans are highways |
| **ProtoMechs** | Star moves as one counter, SIG as a vehicle lance; cheap screen-fillers |
| **Civilian infrastructure** | HPG hex: off-world reinforcement requests. Factory hex: +2 SP/day while held. Hearts-and-minds optional rules left to the GM's conscience |

---

## 12. Campaign Structure & Victory

### 12.1 Objectives
The GM seeds the theater with objective hexes (some public, some hidden, some *fake*). Standard values per day held: Spaceport 3 VP, Capital city 3, Factory 2, HPG 2, Depot 1, named terrain 1. Add mission cards per side (e.g., *"Extract the defecting scientist from hex 0819 — worth 10 VP, the enemy doesn't know which hex"*) so victory is never just attrition.

### 12.2 Endings
Campaign ends at a VP threshold, a wall-clock date (e.g., "the relief fleet jumps in on Day 12"), or one side's withdrawal. Surviving forces, salvage, and pilots carry into the next campaign — OVERRIDE chains naturally into a war.

### 12.3 Example Frame: *The Cavanaugh Salient* (10 days)
Attacker: reinforced battalion + aerospace wing + 2 DropShips, arrives via standard jump point Day 0 (lands Day 3, or burns hard for Day 2 at RDY cost). Defender: 2 companies + conventional air + garrison infantry + 1 satellite + fixed sensor net, dug in around a spaceport and a Long Tom battery whose position is the campaign's central secret. First side to 25 VP, or attacker fails if below 15 VP at Day 10. Every system above gets exercised inside one long weekend or a few weeks of asynchronous play.

---

## 13. The GM & The Digital Tool

### 13.1 The GM's Job
The GM is the sensor net, the radio static, and the fog itself: execute simultaneous orders, roll detection silently, narrate contact reports in-fiction, adjudicate Quick Resolutions, and keep both sides' paranoia healthy. The GM never advantages a side; the GM advantages *uncertainty*.

### 13.2 Minimum Tool Spec
Whether it's a spreadsheet, a VTT layer, or custom software, the tool must hold:
1. **Truth map:** all counters, terrain, tags, minefields, satellites and their schedules.
2. **Per-side filtered views:** own forces + scouted terrain + contacts at current ladder level, with last-known ghosts that age visually.
3. **Order queue:** timestamped orders incl. conditionals; simultaneous execution per pulse; off-net delay handling.
4. **Detection engine:** auto-roll every searcher/target pair per tick; emit contact reports only to on-net recipients.
5. **The clock:** pulse fast-forward with stop-on-event; contact-turn mode within 5 hexes.
6. **Ledgers:** SP, RDY, ammo state, salvage tokens, pilot roster, VP.
7. **Battle handoff export:** one click produces the tabletop setup sheet — maps, edges, forces, hidden setup rights, intel/initiative mods, available off-board fires — and one form to ingest results back.

### 13.3 Table Covenant
Double-blind only works on trust: players don't peek, don't meta from the GM's dice cadence, and accept that a stale map is a *fair* map. In exchange the GM promises symmetric rules, logged rolls (auditable after the campaign), and that every nasty surprise was earned by somebody's good play.

---

## Appendix A — One-Page Quick Reference

**Scales:** Op hex = 1 mapsheet ≈ 500 m · Strategic hex = 1 low-alt map · Pulse = 1 hr · Contact turn = 6 min
**Movement:** OMP = Walk/Cruise MP per contact turn · Pulse: ×10 road / ×5 cross-country · Forced march ×1.5, RDY −1
**Detection:** 2d6 ≥ target SIG · Base SIG: Bn 5 / Co 6 / Lance 7 / Unit 9 / Squad 10 · Moving −1 · Firing −3 · Hide +2 · Urban +2 / Woods +1 · Night +2 (visual) · ACTIVE searcher +2 but own SIG −2
**Contact ladder:** GHOST → SHADOW → CONTACT → LOCK (artillery/air want LOCK)
**Engagement:** same hex / screen / strike → tabletop, Alpha Strike, or Quick Resolution (2d6 + BR/intel/terrain mods; loser takes diff ×5% BR)
**Artillery ranges (hexes):** Arrow IV 8 · Sniper 18 · Thumper 21 · Long Tom 30 · Firing = auto CONTACT on your hex
**Air:** Sortie = 1 pulse out / station / 1 back / 2 rearm · Strikes need ≥ CONTACT
**Supply:** 1 SP/day per formation (×2 if fighting) · supply line ≤ 30 road hexes to depot · out of supply: RDY −1/day
**Readiness:** 7–5: +1 TNs · 4–2: +2, attack on 8+ · 1–0: rout

*OVERRIDE is a fan framework for use with the BattleTech tabletop game. BattleTech is a registered trademark of The Topps Company, Inc.; game rules referenced are published by Catalyst Game Labs. This document defines campaign-layer procedures only and reproduces no published rules text.*
