# OVERRIDE MODULE 2: DEEP SKY
### DropShips, WarShips & The System War

*"A planet is a target. A system is a chessboard. A jump point is a door — and somebody is always watching the door."*

DEEP SKY extends OVERRIDE upward from the orbital shell to the whole star system: jump arrivals, week-long transit burns, blockades, convoy wars, WarShip actions, and boarding ops. The iron law of Module 1 still rules: **no abstract battles.** When ships meet, the system layer hands the tabletop a map, vectors, velocities, and fuel ledgers, and you fight it out with *Total Warfare / Strategic Operations* capital rules.

### The Research Anchors (what's canon vs. house-ruled)
DEEP SKY is built on published BattleTech physics, so your existing books remain the authority:
- **Transit math:** the standard profile is 1G acceleration to midpoint, flip, 1G braking. Time follows the brachistochrone formula — **T (days) = 2.835 × √(distance in AU ÷ acceleration in G)**. For a Sol-type (G2V) star, jump point to habitable zone ≈ **9–10 days at 1G**. *Campaign Operations'* Primary Solar Stats Table (pp. 100–101) gives exact transit times, proximity-limit distances, and sail-charge times per spectral class — use it as the master reference; the table in Section 2 is an approximation for play.
- **Strategic fuel:** vessels burn fuel by their record sheet's **Tons per Burn-Day** rating (1.84 t/day at constant 1G for most military DropShips). Tactical play converts at the sheet's tactical fuel points per ton (large DropShips typically 30 FP/ton).
- **Jump operations:** K-F drives recharge by solar sail in **151–210 hours (6–9 days)** depending on spectral class; recharge stations can transfer a charge in ~150 hours or risk a damaging quick-charge; JumpShips maneuver at only ~0.1G station-keeping; lithium-fusion batteries store a second jump; nonstandard "pirate points" exist but are transitory and risky.
- **House rules are flagged ⚙ inline** — mostly crew-G limits, the light-lag intelligence system, and encounter-geometry simplifications.

---

## 1. The System Map: Nodes & Lanes

At system scale, hex grids lie to you: everything meaningful is a point mass or a burn between point masses. DEEP SKY therefore plays on a **node-and-lane map**, with the high-altitude grid (Module 1) nested inside every planetary node:

**Nodes:** Zenith & Nadir jump points · planets and major moons (each containing its own Module 0/1 theater) · gas giants (fuel!) · asteroid belt sectors · stations (recharge, mining, shipyard) · known pirate points (planetary L1s and transitory solutions — GM keeps the *current* valid set secret).

**Lanes:** any node pair, labeled with distance (AU) and 1G transit time from the formula above. The GM tool stores the geometry; players see a subway-style system diagram with travel times — which is honestly how a DropShip captain sees it too.

### 1.1 The Three-Tier Clock
DEEP SKY adds a top gear to the OVERRIDE clock:

| Tier | Length | Used For |
|---|---|---|
| **Watch** | 6 hours | System transits, recharge timers, blockade routine |
| **Pulse** | 1 hour | Planetary operations (core rules) |
| **Contact Turn** | 6 min | Maneuver, intercepts, drops |

The GM tool runs Watches until an event (detection, arrival, intercept window) demands finer time, then shifts down — same compression philosophy, bigger sky.

---

## 2. Transit: The Burn

A vessel on a lane declares a **burn profile**:

| Profile | Speed | Fuel | Notes |
|---|---|---|---|
| **Standard (1G)** | Table 2.1 times | 1 × Tons/Burn-Day per day | The default of the universe |
| **Military burn (1.5G / 2G)** | ÷√1.5 / ÷√2 (≈ −18% / −29% time) | 1.5× / 2× burn rate | ⚙ Crew fatigue: −1 formation RDY per 2 days at 1.5G, per day at 2G |
| **Hard burn (3G+)** | ÷√G | G× burn rate | ⚙ Requires acceleration couches; embarked ground troops arrive at −2 RDY; daily 2d6 ≥ 4 or a medical casualty |
| **Cold coast** | Burn hard early, then drift ballistic | Near zero while coasting | Slow overall, nearly invisible (Section 4) — the infiltrator's profile |
| **Station-keeping** | Holding at a node | Negligible (0.1G class) | JumpShips can do no better than this |

### 2.1 Transit Times, Standard Points → Inner System (1G) ⚙*approximate — use Campaign Ops pp. 100–101 for exact values*

| Star Class | Transit | Sail Recharge |
|---|---|---|
| M (red dwarf) | 2–4 days | ~200+ hrs |
| K | 4–6 days | ~190 hrs |
| G (Sol-like) | 7–10 days | ~180 hrs |
| F | 11–20 days | ~170 hrs |
| A and brighter | 25–40 days | ~155 hrs |

**The strategic shape of BattleTech naval war is right there in that table:** in most systems, the defender gets **a week of warning** between jump flash and orbit — *if* they see the flash, *if* the attacker came in the front door, and *if* the attacker burned hot the whole way. Every DEEP SKY mechanic below is about attacking one of those three "ifs."

### 2.2 Mid-Course Decisions
A vessel may re-plot mid-lane (divert to another node, flip early to arrive slow, flip late to arrive *fast*). The GM tool recomputes from current position/velocity. **Arrival velocity matters:** a standard profile arrives at rest; a no-flip "battering ram" profile arrives in half the time carrying enormous velocity — it cannot stop, cannot land, and gets exactly one slashing pass at whatever it aimed at (Section 5). Yes, this enables the heroic idiot maneuver. It's BattleTech.

---

## 3. Strategic Fuel: The Burn-Day Ledger

Every vessel's ledger now has two linked accounts:
- **Strategic:** fuel tonnage, spent at Tons/Burn-Day × G while thrusting. A *Union* with 150 tons aboard at 1.84 t/burn-day has ~81 days of 1G endurance — fuel rarely limits one transit, but it absolutely limits a *campaign* of maneuvers, and high-G intercepts drink it fast.
- **Tactical:** at battle handoff, remaining tonnage converts at the record sheet's tactical rate (typically 30 FP/ton for DropShips); after battle, FP spent convert back. One ledger, two lenses — same philosophy as Module 1.

**Refueling:**
- **Stations & tenders:** transfer at 1 watch per 100 tons docked.
- **Gas giant skimming:** a DropShip at a gas giant node may scoop and refine hydrogen: 1d6 × 10 tons per watch, with a Piloting check (failure: minor structural damage, try again). Gas giants are therefore *strategic terrain* — the deep-system gas station every raider plots around — and mining a system's giant is a classic place to hide a picket.
- **Water cracking:** at any node with ice/water (most moons, belts), 2d6 tons per watch with cargo/refinery capacity.
- ⚙ Fuel cached at nodes (depot pods) is a thing. So is stealing it.

---

## 4. Seeing the System: Light-Lag Intelligence

Space hides nothing and tells you everything *late*. DEEP SKY's double-blind engine:

### 4.1 Everything Emits
| Event | Detectability |
|---|---|
| **Jump arrival** | The K-F flash (EM/IR burst) is detected **automatically, system-wide** — after light lag (4.2). What's detected: that a jump occurred at that point, and a rough mass class (JumpShip vs. WarShip vs. small) |
| **Fusion drive at 1G+** | Automatic detection by any watching node/vessel with line of sight — after light lag. Burn vector and acceleration are readable: the enemy knows *where you're going and when you'll arrive* |
| **Cold-coasting vessel** | SIG 11 per watch per searcher (⚙); +1 if drifting through a belt sector; active radar sweeps from a picket reduce TN by 2 within its node |
| **Station-keeping at a node** | SIG 8; transponder games apply (4.3) |

### 4.2 ⚙ The Light-Lag Rule
All passive detection is delayed **10 minutes per AU** of separation (round to the nearest pulse; at Watch scale, anything ≥ 6 AU is one Watch stale). The GM tool timestamps every contact with *when it was emitted*. Players see a system map of *light-cones, not truths*: that burn flare near the gas giant is four hours old, and the ship that made it has had four hours to flip, coast, or change its mind. Deep-system maneuver is a game of telegraphed lies — exactly the texture a double-blind GM tool can deliver that paper never could.

### 4.3 Transponders & False Flags
Civilian traffic exists (GM seeds neutral movers per system). Vessels broadcast, squawk false (merchant codes on a *Leopard* — 2d6 ≥ 9 per close inspection to hold the lie, automatic failure if you maneuver like a warship), or run silent (no squawk = treated as hostile by any picket that resolves you). Customs interception of a "merchant" that is actually an assault DropShip full of marines is a complete scenario generator on its own.

### 4.4 Pickets, Drones & Arrays
- **Picket vessel/fighter pair at a node:** active sensor bubble, resolves coasting contacts at TN −2, inspects traffic.
- **Passive array (station/satellite):** halves light-lag staleness penalty for its owner at that node (dedicated big-aperture optics).
- ⚙ **Sentinel drones** (cargo-deployed, 5 tons): park on a lane or pirate point; one-shot burst transmission when something passes within 0.05 AU — SIG 12 to find, brutal to lose your covert approach to.

---

## 5. Interception & Encounter Geometry

When two forces' paths could cross, the GM tool solves the geometry (positions, velocities, fuel margins) and classifies the encounter. ⚙ The classification rule is deliberately simple:

**Maneuver Margin (MM)** = burn-days of fuel a vessel can still spend × its G rating, discounted for crew limits. The tool compares the interceptor's MM against the velocity gap it must close.

| Encounter | Condition | What Hits the Table |
|---|---|---|
| **MATCHED ENGAGEMENT** | Interceptor MM ≥ 2× gap (it can match vectors with reserve) | Standard space battle on the high-altitude/space map, both sides at maneuver velocities, full SO capital rules. Boarding possible if a target is crippled |
| **SLASHING PASS** | Interceptor can reach the path but not match velocity | A timed battle: **1d6+4 tabletop turns** within weapons envelope at high closing velocity, then physics separates everyone. Set up at max playable velocity, head-on vectors. One pass. Make it count |
| **STERN CHASE** | Pursuer behind on same lane | Battle only when overtake completes (tool computes watches-to-overtake); the quarry may burn harder (fuel/crew costs) or jettison cargo/drop a fighter screen to force the pursuer to choose |
| **BLOCKADE ACTION** | Both effectively at rest at a node | Standard battle; defender picks range bracket (they own the geometry) |

**Refusing battle:** a force that sees the intercept coming (light-lag permitting!) can divert — at the cost of time, fuel, and *telling everyone watching exactly where it now isn't going*. The system war is mostly people spending fuel to make other people spend time.

---

## 6. The Tabletop Handoff (Capital Edition)

Setup is generated, then published rules take over completely:
- **Map:** space map (high-altitude rules) at the encounter node or lane point. Planetary-node battles may include the atmospheric interface row — and can cascade down into Module 1 and Module 0 battles. A full planetary assault is three nested tabletops in one afternoon, and it is glorious.
- **Vectors & velocity:** from the geometry solution; standard profiles arrive at rest, intercepts arrive hot, slashing passes arrive screaming.
- **Fuel:** tactical FP from the burn-day ledger (Section 3). A WarShip that hard-burned across the system fights with the gas it has left — Module 1's Bingo discipline applies to squadrons too.
- **Intel = initiative:** the side with fresher light (lower staleness on its opponent at commit time) gets +1 initiative for 3 turns; total surprise (undetected cold-coaster opening fire) uses Module 1's bounce rules.
- **Screens:** carried fighters launch per published rules; capital missiles, point defense, sub-capital weapons all per SO. Nothing here is rewritten; DEEP SKY only decides the starting conditions.

### 6.1 Boarding Actions
A crippled or grappled vessel (MATCHED encounters only) can be boarded: marines/battle armor fight compartment battles per published boarding/zero-G rules — on the table, as always. A captured JumpShip is the single most valuable object in any DEEP SKY campaign (see 7.4), and a boarding-capable assault DropShip is the scariest "merchant" in the sky.

---

## 7. Jump Operations: The Door

### 7.1 Arrival
Jump-ins are placed by the GM at the declared point. The flash announces you (4.1). Arriving forces have **velocity ≈ 0** and JumpShips can barely move thereafter (0.1G station-keeping) — the jump point is where JumpShips *stay*, which is why everyone fights about them.

### 7.2 The Recharge Clock
A K-F drive recharges by sail in **151–210 hours by star class** (~30 Watches in a Sol-type system). While the sail is deployed: the JumpShip cannot thrust at all, and the sail itself is fragile — ⚙ any capital-scale hit on the sail destroys it (weeks to re-rig a spare, if carried). A JumpShip may emergency-furl the sail in 2 Watches, losing accumulated charge on a 2d6 roll of ≤ 5. **The recharge clock is the strategic vulnerability window of the entire universe** — a defender who can't beat the invasion fleet can still try to murder its ride home, and every invader knows it.

- **Recharge stations:** transfer a full charge in ~150 hours of beamed transfer, or **quick-charge** by direct connection — ⚙ 2d6 per attempt: 8+ success in 5 Watches; 3 or less inflicts K-F drive damage (GM rolls severity; worst case the drive is dead at the dock). Desperation has a rulebook entry.
- **Lithium-fusion batteries:** ships so equipped arrive with a second jump banked — they can jump in, act, and *leave before any recharge clock runs*. L-F battery WarShips are DEEP SKY's apex predators and should be priced accordingly in campaign budgets.

### 7.3 Pirate Points
Nonstandard points (planetary L1s and transitory gravitational solutions) trade safety for position — a pirate-point arrival can cut transit from days to **hours**. Per core rules: GM approval + 2d6 ≥ 9 (⚙ ≥ 7 with a current survey of the system, ≤ 4 = misjump table). The GM keeps the live pirate-point solution set secret; *acquiring a system survey* (espionage, captured nav data, bribed ComStar adept) is a campaign objective worth more than a battalion.

### 7.4 The JumpShip Taboo
Canonically, even the Succession Wars mostly spared JumpShips — they are too rare to replace. ⚙ Optional rule with teeth: destroying (not capturing) a JumpShip costs the killer **−10 VP and a Reprisal event** (GM grants the wronged side an off-map reinforcement or intel windfall). Capturing one intact: **+15 VP** and you keep it. The incentive gradient *is* the lore.

---

## 8. WarShips & The Heavy Line

- WarShips transit, burn, and refuel like everything else (their Tons/Burn-Day is just bigger), and unlike JumpShips they jump *and* maneuver — a WarShip parked on your jump point is a closed door.
- **Naval gunnery support:** a WarShip at a planetary node feeds Module 0 Section 8.7 orbital fire, with everything Module 1 says about predictable orbits still applying.
- **Pocket WarShips** (capital-missile DropShips) are the poor power's navy: they hide in convoy manifests (4.3) until the inspection goes very wrong.
- **Squadron fuel doctrine:** the GM tool tracks each hull's ledger; fleets move at their thirstiest member's profile. Fleet colliers (tanker DropShips) extend reach and die first. Sound familiar, ground players? It should — DEEP SKY is OVERRIDE's logistics war wearing a vac suit.

---

## 9. The System Campaign

**Convoy war:** off-world supply (SP, fuel, replacement units) arrives by scheduled JumpShip convoys — public arrivals (the flash!), then a transit lane everyone can compute. Escort them in, or watch your planetary campaign starve per core Section 10. **Blockade:** control of both standard points + pickets on known pirate points = imported SP cut to zero; blockade runners cold-coast in from deliberately distant arrival points, weeks early.

**Objective menu (VP/day or one-shot):** hold a jump point 2 · recharge station 2 · gas giant refinery 1 · shipyard 3 · convoy delivered 3 · convoy destroyed 3 · enemy WarShip crippled 5 · JumpShip captured 15 · system survey stolen 5.

### 9.1 Worked Invasion: *Operation SKEAN* (G2V system)
**W0:** Attacker jumps in at zenith — flash seen planetside 83 minutes later (10 AU light lag). Force reads as one *Invader* + four DropShip masses. The defender now owns one fact and nine days.
**W1–4:** Two attacker DropShips burn 1G for the planet, arrival vector public. Two more... aren't burning. (They detached cold, coasting toward the gas giant. SIG 11. The defender's picket there is about to matter.)
**W12:** Defender's pocket WarShip and fighters lift to a planetary L1 pirate point on a hunch. GM tool says nothing. Light says nothing. Sweat.
**W20:** Picket at the gas giant resolves a coasting contact — MATCHED intercept available with 2.1 burn-days of margin. Tabletop: space map, picket vs. an assault DropShip full of marines headed for the refinery. The system war has begun, and the "main" invasion force is still four days out.
**W36:** Invasion fleet brakes into orbit — Module 1 takes over the sky, Module 0 the ground, and somewhere behind everything, an *Invader* sits at zenith under sail, 22 Watches from a charge, with the defender's last two fighters quietly tanking up at the gas giant for the longest cold coast of their lives.
Three nested wars. One campaign. That's DEEP SKY.

---

## 10. GM Tool Additions (delta to Modules 0–1)

1. **System geometry engine:** node/lane graph; brachistochrone solver (T = 2.835 × √(AU/G)) with mid-course re-plots and arrival-velocity tracking.
2. **Light-lag layer:** per-observer event timestamps; every player map renders the *light-cone* view, with staleness shown per contact.
3. **Burn-day ledgers:** strategic tonnage ↔ tactical FP conversion at handoff; fleet-level thirst tracking; refuel/skim operations.
4. **Encounter classifier:** MM-vs-gap solver outputting MATCHED / SLASH / STERN CHASE / BLOCKADE plus full table-setup export (vectors, velocities, FP, intel initiative).
5. **Jump board:** recharge clocks per drive, sail states, L-F charge flags, secret pirate-point solution set, misjump resolution.
6. **Traffic generator:** neutral/civilian movers with transponder identities for the false-flag game.

---

## Appendix — DEEP SKY Quick Reference

**Clock:** Watch 6h → Pulse 1h → Contact Turn 6 min
**Transit:** T(days) = 2.835 × √(AU ÷ G) · standard = 1G flip-at-midpoint, arrive at rest · no-flip = ½ time, arrive ballistic (slash only)
**Fuel:** Tons/Burn-Day × G while thrusting (most mil. DropShips 1.84) · tactical ≈ 30 FP/ton at handoff · skim gas giant 1d6×10 t/watch
**Seeing:** jump flash & 1G burns = auto-detect after light lag (10 min/AU) · cold coast SIG 11 · false flag holds on 9+
**Encounters:** MATCHED (MM ≥ 2× gap) = full battle · SLASH = 1d6+4 turns, one pass · STERN CHASE = overtake or nothing · all on the table
**Jump ops:** recharge 151–210 hrs by star class · sail deployed = no thrust, fragile · quick-charge 8+/risk on ≤3 · L-F battery = banked second jump · pirate point 9+ (7+ with survey)
**Taboo:** kill a JumpShip −10 VP + Reprisal · capture +15 VP

*DEEP SKY is a fan framework for use with the BattleTech tabletop game (© The Topps Company, Inc.; rules published by Catalyst Game Labs). Transit, fuel, and recharge figures reference published materials — consult Campaign Operations and Strategic Operations for authoritative tables; all combat uses your rulebooks.*
