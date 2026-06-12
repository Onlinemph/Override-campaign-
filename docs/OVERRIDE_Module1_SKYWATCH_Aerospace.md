# OVERRIDE MODULE 1: SKYWATCH
### The Aerospace Game — Fuel, Scrambles, and the Merge

*"Amateurs talk thrust. Professionals talk fuel fraction."*

SKYWATCH replaces and expands OVERRIDE Section 8.4. It turns the air war into its own complete game with one iron law: **fuel is the gameplay, and every air combat is fought on a real tabletop.** The operational layer never rolls an "abstract aero battle" — it exists only to decide *who meets whom, where, at what velocity, with how much gas in the tanks.* Then *Total Warfare* takes over.

The campaign currency of the air war is the **Fuel Point (FP)**: 80 FP per ton of fuel, 1 FP per Thrust Point spent — the same accounting the tabletop already uses, so a fighter's fuel state flows from campaign to table and back with no conversion at all. That continuity is the whole module.

**Three pillars:**
1. **The Flight Ledger:** every sortie is a plotted fuel budget the GM tool tracks in real time.
2. **The Response Ladder:** strip alert vs. atmospheric CAP vs. orbital standby — the fast/cheap/ready triangle where you only get to pick two.
3. **The Merge:** when fighters meet, the operational state *generates* the tabletop battle — map, edges, altitude, starting velocity, and remaining FP — and the dice take it from there.

---

## 1. The Sky Grid & The Altitude Ladder

Aircraft do not crawl the ground map. All air movement happens on the **high-altitude grid** (1 hex = 18 km, 1 air turn = 60 seconds; one OVERRIDE contact turn = 6 air turns, one pulse = 60). One high-altitude hex covers an entire low-altitude theater map, so a single-theater campaign's air war plays out across a handful of surface hexes plus the **Altitude Ladder** above each:

| Band | Alt. Levels | Who's Here | Notes |
|---|---|---|---|
| **DECK (NOE)** | 1 | Strike runs, terrain-masked ingress | Visual/terrain detection rules of the ground war apply; +2 PSR in mountains |
| **LOW** | 2–4 | CAS, dogfights over battles, VTOL ceiling overlap | Battles here can spill onto ground maps |
| **HIGH** | 5–7 | Cruise transit, CAP stations, recon | The economical band: cruise ~2 FP/min |
| **SUBORBITAL** | 8–10 | Ascent/descent corridors, drop release points | Climbing costs 2 FP per level |
| **ORBIT** | — | DropShips, satellites, standby fighters | **Loiter = 0 FP** (free fall); the fuel sanctuary |

- **Climb:** 2 FP per altitude level. Ground → orbit ≈ 10 levels: **~30 FP up** (climb + circularization), **~35 FP down** (deorbit burn + descent control + approach), per the standard profile.
- **Descend within atmosphere:** free (trade altitude for speed — note it on the ledger as stored energy, see 7.3).
- **Map-change conversion (TW standard):** when a battle moves from the high-altitude map down to a low-altitude map, **double** each unit's remaining FP; moving up, **halve** (round down). The GM tool applies this automatically at handoff.

---

## 2. The Flight Ledger

Every airborne unit has a live ledger in the GM tool. Standard costs:

| Action | FP Cost |
|---|---|
| V/STOL takeoff | 10 |
| Runway takeoff | 4 |
| V/STOL landing | 5 |
| Runway landing | 2 |
| Climb one altitude level | 2 |
| **Cruise transit** (HIGH band) | **1 FP per high-altitude hex** (speed: 2 hexes/min) |
| **Dash transit** | 2 FP per hex (speed: Safe Thrust hexes/min) |
| Atmospheric loiter (CAP) | 2 FP/min (1 FP/min minimum-burn "lean loiter," −1 to detection rolls you make — you're wallowing) |
| Orbital loiter | 0 |
| **Tabletop combat** | Native TW rule: 1 FP per Thrust Point spent, tracked on the record sheet |

**Worked baseline — SL-17 Shilone** (65t, 6/9, 5 tons = **400 FP**):
- Runway takeoff (4) + climb to HIGH (12) + 6 hexes out (6) + **60 min CAP** (120) + 6 back (6) + descend (0) + land (2) = **150 FP**, leaving a **250 FP combat reserve** — about 27 turns at Max Thrust. Generous.
- Same mission flown 30 hexes out (540 km): 150 + 48 transit = 198 FP. Still healthy.
- Same mission at **dash** both ways with 20 min of Max Thrust combat: the reserve evaporates. The ledger *is* the leash.

Conventional fighters use identical rules but sip fuel: halve all transit/loiter costs. They are your endurance CAP and your interdiction trucks — until an aerospace fighter finds them.

---

## 3. Airbases, Turnaround & The Fuel Farm

An **Air Facility** is any spaceport, airstrip tag, grounded DropShip, or carrier vessel. Each has:

- **Fuel Farm:** stockpiled fuel in tons (80 FP each). Fuel is tracked *separately from Supply Points* — 1 SP converts to 2 tons of aviation fuel at a depot, but the fuel has to be trucked or flown to the facility. Fuel farms are high-value targets: a strike that destroys one grounds an air wing more surely than shooting down its fighters. Expect raids.
- **Turnaround crews:** each crew can rearm + refuel one flight (up to 6 fighters) in **2 pulses**, or **1 pulse "hot pit"** (refuel + reload only external ordnance; roll 2d6, on 2–3 a mishap costs 1d6×10 FP of farm stock and the flight stands down a pulse). Facilities have 1–3 crews.
- **Capture:** an intact captured facility yields its remaining farm. Defenders may torch the farm (1 contact turn, very visible).

### 3.1 Alert States (set per flight, per pulse)
| State | Where | Launch Delay | Cost |
|---|---|---|---|
| **ALERT-5** | Cockpit, engines hot | This contact turn | Crew fatigue 2×/pulse (Section 11); 5 FP/pulse idle burn |
| **ALERT-15** | Cockpit, cold | Next contact turn | Crew fatigue 1×/pulse |
| **ALERT-60** | Hangar | 1 pulse | — |
| **STAND-DOWN** | Hangar, maintenance | 2 pulses | Restores crew fatigue |

---

## 4. Missions & The Air Tasking Order

Air power in OVERRIDE is plotted, not reactive — that's what makes it double-blind. Each pulse, players file an **Air Tasking Order (ATO)** with the GM tool: per flight, a mission type and a **plotted route** (takeoff → waypoints by high-altitude hex → station/target → recovery base). The tool flies the plot, burns the ledger, and rolls detection as the flight crosses each hex. Routes can include **conditionals** (*"If bounced before waypoint 2, abort and RTB at dash"*).

| Mission | Profile |
|---|---|
| **CAP** | Loiter a designated high-altitude hex at chosen band; auto-commits against detected hostiles entering the zone (response: same contact turn in-hex, next turn for adjacent hexes) |
| **ORBITAL STANDBY** | Park in orbit over a hex at 0 FP/min; responds to tasking in **3 contact turns** (deorbit + descent, ~35 FP) — the slow, deep reserve |
| **STRIKE / CAS** | Attack a ground contact (needs ≥ CONTACT intel; vs LOCK no penalty). Resolves on the ground tabletop per TW air rules |
| **SWEEP** | Fly a route hunting enemy aircraft; engages anything it detects |
| **ESCORT** | Tether to another flight/DropShip; fights whatever engages the package |
| **RECON** | Scan a 5-hex-wide corridor (ground formations, per Section 6.2 of the core rules) |
| **INTERDICTION** | Station over a route; strikes supply convoys/rail movers detected beneath |
| **FERRY / TANKER** | Reposition, or (with cargo/fuel pods) deliver fuel: 1 ton delivered per 2 tons carried |
| **SAR** | Recover a downed crew marker (Section 8.4) |

**No omniscient vectoring:** a flight only gets re-tasked mid-air if it is **on-net** (core rules 4.2 — and a flight at the DECK band in mountains is not). Otherwise it flies its plot. Your enemy is fighting your *planning cycle*, not your reflexes — and a captured ATO (overrun air base, captured pilot) is an intelligence catastrophe.

---

## 5. Seeing the Sky

Aircraft are detected with the core detection roll (2d6 ≥ SIG), with air-specific physics:

- **Base SIG:** flight of 3–6 aircraft 6; pair 8; single 9; DropShip under thrust **3** (a torch in the sky — effectively automatic for anyone looking).
- **Burn brightness:** at Dash or in climb −2 SIG; at lean loiter +1; **ballistic/gliding (zero thrust) +3**. The classic SKYWATCH play: cruise high, cut engines, glide the last hexes onto the target. Silent, fast-falling, and committed.
- **DECK band:** detected only by formations/sensors in the same low-altitude theater hex line of approach (terrain masking) — but PSR hazards and AA small-arms apply.
- **Radar horizon:** ground sensors detect HIGH-band aircraft at any range within their theater hex, LOW band only within 6 operational hexes, DECK per above. Fixed Sensor Stations and Mobile HQs see one high-altitude hex further out — your early-warning line.
- **Sensor aircraft:** a conventional aircraft fitted as a **Skyeye** (GM-approved refit, replaces ordnance) is a flying Sensor Station (6/12, plus air search across its hex and all adjacent). Slow, fat, SIG 5. Every air war revolves around killing or protecting it.
- Contacts climb the same GHOST→LOCK ladder. You cannot plot an interception against less than SHADOW (you know *something* crossed the line, not where it's going).

---

## 6. The Scramble & The Chase

When a hostile air contact appears, defenders respond down the ladder: CAP in-hex (now), CAP adjacent (next turn), strip alert (per alert state), orbit standby (3 contact turns). Then the GM tool runs the geometry **on the grid, in contact turns** — no dice, just movement:

- Pursuer and target move their transit speeds (cruise 12 hexes/contact turn; dash 6×ST).
- Interception occurs when the pursuer ends a contact turn in the target's hex **and** holds at least SHADOW on it. A target that goes ballistic-quiet, drops to the DECK, or breaks its plotted route (if on-net) can shake a GHOST-level pursuer — the tool just keeps rolling detection.
- **Tail-chase rule:** if the pursuer's speed doesn't exceed the target's, interception only happens if the target turns, loiters, or runs out of map (orbit counts as out of map — see 6.1).
- A target that *accepts* battle may instead turn into the merge at any point. Sometimes the trap is the point.

### 6.1 Nobody Sanctuaries Forever
Climbing to orbit to escape costs ~30 FP and 2 contact turns of bright, predictable burning (−2 SIG, fixed corridor): pursuers within 2 hexes get one free interception attempt at the suborbital band before the target circularizes. Orbit is a sanctuary you must *earn through* a gauntlet.

---

## 7. THE MERGE: Tabletop Handoff

All air combat is fought with real miniatures and real record sheets. The operational layer hands the table four things — **map, vectors, energy, and fuel** — then gets out of the way.

### 7.1 Which Table
| Where the intercept happened | Tabletop |
|---|---|
| ORBIT / SUBORBITAL | **High-altitude (space) map**, standard TW/SO space rules |
| HIGH / LOW bands | **Low-altitude map** with atmospheric rules (stalls, altitude, control rolls) |
| DECK, or over an ongoing ground battle | **Ground mapsheets**, TW air-units-on-ground-maps rules — fighters scream across the same hexes the 'Mechs are fighting on |
| Mixed (e.g., CAP dives on a strike at the DECK) | Start on the low-altitude map; the GM applies the ×2/÷2 fuel conversion if play transitions |

### 7.2 Setup From the Operational State
- **Edges & facing:** each flight enters from the map edge matching its grid approach vector, at its current altitude band.
- **Starting velocity = transit mode:** cruise = velocity 2; dash = velocity equal to Safe Thrust; gliding strikers = velocity 2 + 1 per altitude level dropped on the way in. Velocity is set up exactly as TW space/atmo rules expect — the campaign simply dictates the number.
- **Surprise:** if one side held CONTACT+ and the other had ≤ GHOST at the moment of interception, the blind side sets up first and the sighted side enters anywhere on its half's edges after seeing that deployment. Getting bounced should feel like getting bounced.

### 7.3 Energy Is Initiative
At the merge, compare **Energy State** = starting velocity + current altitude level. The higher side wins initiative ties for the first 3 turns and may decline the first head-to-head pass (slashing attack). Speed you paid fuel for on the grid is advantage you cash on the table. This is the module's soul: *the dogfight is won during the transit plot.*

### 7.4 Fuel On the Table
Each fighter's record sheet starts with its **live ledger FP** (after map conversion). Standard TW fuel expenditure applies: every Thrust Point spent burns 1 FP. The GM tool pre-computes each fighter's:
- **JOKER** (ledger FP needed to RTB at dash + 25%): a warning — announce it aloud, in character if possible.
- **BINGO** (RTB at cruise + 10%): the fighter must disengage (TW disengagement rules: exit a map edge) within 3 turns or accept the consequences below.

### 7.5 Fighting Past Bingo — FUMES
A pilot may always choose to stay. Past Bingo, when FP hits the cruise-home cost: the aircraft is on **FUMES**. It may glide (atmosphere: lose 1 altitude/turn, no thrust) toward any friendly facility in its theater hex; landing dead-stick is a PSR at +4 (+2 with a runway). Failure: crash, crew survival roll 8+ (eject before impact: 5+, but the airframe is gone). Over water or enemy ground, ejection creates a **DOWNED CREW** marker. Heroic, stupid, and extremely BattleTech.

---

## 8. After the Merge

### 8.1 Disengagement & Pursuit
A flight that exits the table returns to the grid at its exit velocity and vector; if hostiles remain airborne with speed advantage and fuel, the chase resumes per Section 6 — possibly producing a *second* battle, at worse fuel states, closer to somebody's AA umbrella. Air wars in SKYWATCH end when somebody's ledger says so.

### 8.2 Recovery & Attrition
Returning fighters land (ledger pays the cost — a shot-up fighter landing V/STOL on fumes is its own drama), then queue for turnaround crews. Armor/structure damage repairs per core rules 10.4. Airframes are scarce: SKYWATCH campaigns are usually lost at 30–40% wing attrition, not 100%.

### 8.3 Aces
Track kills per crew. At 5 kills: +1 initiative when this pilot leads a flight at the merge, and the enemy learns the pilot's callsign (psychological warfare is encouraged). Losing an ace is a −1 RDY event for the whole wing.

### 8.4 DOWNED CREW & The SAR Game
Every ejection drops a marker on the operational map (GM knows truth; the owner gets a GHOST-quality position from the beacon — unless the crew goes beacon-dark fearing capture). VTOLs or ground formations can recover them; enemy infantry can capture them. A captured aircrew gives the captor **one random page of the owner's current ATO**. Suddenly your infantry screen has a second job, and a downed ace generates the best ground scenario of the campaign for free.

---

## 9. Air-to-Ground

- **Strikes & CAS** resolve on the ground tabletop per TW rules (strafing, dive bombing, altitude bombing) — the flight appears over the battle on the turn its grid transit arrives, fights with its real FP, and leaves at Bingo. CAS **station time** is therefore a real number the ground commander can see ticking.
- Strikes need ≥ CONTACT on the target (vs LOCK: no penalty; vs CONTACT: −2 to-hit on the table from imperfect cueing). You cannot bomb a GHOST.
- **AA bites back:** any formation with dedicated AA units forces incoming strikes to the LOW band or above (flak ceiling) unless the strike accepts a DECK run through their engagement envelope (resolved on-table; bring armor or bring friends).
- **Interdiction** kills logistics: a convoy caught under an interdiction station fights a ground tabletop against strafing runs with whatever escort it has. Three burned convoys will end an offensive that three lost lances wouldn't.

## 10. DropShips & The Heavy Sky

- DropShips fly the same grid and ledger (their massive tonnage uses standard DropShip fuel ratings; the GM tool handles it). Under thrust they are SIG 3 — **escort or accept interception**, every time.
- **Intercepting a drop:** fighters may attack the drop corridor during the 2 contact turns of descent — a space-map battle at SUBORBITAL where one side is mostly trying to *get past*. Scattering the escort scatters the drop (+2 hexes drop scatter per escort flight destroyed or driven off).
- **Boarding/Capital actions:** grappling and boarding ops use published rules and are encouraged exactly once per campaign, because everyone will talk about it forever.
- Orbital fire support requires Supremacy per core 8.7 and paints a 3-contact-turn predictable orbit — a standing invitation to every fighter with 30 FP of climb left in the tank.

## 11. Crews

Each crew tracks **Fatigue**: +1 per sortie, +1 per 4 pulses at ALERT-5, +2 per ejection. At Fatigue 4+: +1 to all Piloting/Gunnery TNs. At 7+: the flight surgeon grounds them. A full day of stand-down clears 4. Wings that fly maximum-effort ATOs for three straight days fall out of the sky on their own — historically accurate, mechanically enforced.

---

## 12. Worked Example: One Shilone, One Day

**0500 (Pulse 5):** *Talon-2* (Shilone, 400 FP) takes ALERT-15. Fatigue +1/pulse begins.
**0900:** Sensor Station reports SHADOW, fast mover crossing the early-warning line at HIGH, inbound. ATO conditional triggers: scramble.
**0901 (contact turns):** Runway takeoff (4 FP), climb to HIGH (12 FP), dash 2 contact turns = 36 hexes at 2 FP/hex... GM tool computes intercept 3 hexes ahead of the bandit's plot. Ledger: 400 − 4 − 12 − 144(!) = **240 FP**. Dash is expensive. That was the decision of the day.
**The Merge:** low-altitude map. *Talon-2* enters at velocity 6 (dash), Energy State 6+6=12; the bandit (cruising, vel 2, level 6) has 8. *Talon-2* declines the head-on pass, slashes from above. Tabletop: 9 turns of combat, 61 FP burned, bandit's wing torn off at turn 7 — DOWNED CREW marker for the enemy, SAR scenario seeded.
**RTB:** 179 FP left, JOKER was 90 — comfortable. Cruise home 18 hexes (18 FP), land (2). **159 FP remaining**, hot-pit turnaround, Fatigue 3.
**1500:** The ATO wants him on CAP at dusk. The wing commander looks at Fatigue 3 and the fuel farm down to 11 tons, and starts making real command decisions. *That* is SKYWATCH.

---

## 13. GM Tool Additions (delta to core spec 13.2)

1. **Flight Ledger engine:** per-aircraft FP with auto-costed takeoff/climb/transit/loiter; JOKER/BINGO auto-computation from live position; ×2/÷2 map-conversion at handoff.
2. **ATO interface:** plotted routes with waypoints + conditionals; per-pulse execution; on-net re-tasking gate.
3. **Chase mode:** contact-turn grid movement for pursuit geometry with live detection rolls.
4. **Merge export:** one-click battle sheet — map type, edges, per-fighter velocity/altitude/FP/Joker/Bingo, surprise state, ace flags.
5. **Facility ledger:** fuel farms, turnaround crew queues, alert boards, crew fatigue tracker.
6. **Marker layer:** DOWNED CREW beacons (true vs. reported position), satellite/orbital schedule overlaps.

---

## Appendix — SKYWATCH Quick Reference

**Fuel:** 80 FP/ton · 1 FP per Thrust Point (table) · Cruise 1 FP/hex @ 2 hex/min · Dash 2 FP/hex @ ST hex/min · CAP loiter 2 FP/min (lean 1) · Orbit 0 · Climb 2 FP/level · To orbit ~30 FP / down ~35 · V/STOL T-O/land 10/5 · Runway 4/2 · Map change: down ×2, up ÷2
**Response:** CAP in-hex now · CAP adjacent +1 CT · ALERT-5 now / -15 +1 CT / -60 1 pulse · Orbit standby 3 CT
**Merge setup:** entry velocity = transit mode · Energy = velocity + altitude · higher Energy: init ties ×3 turns + may decline first pass · bounced side deploys first
**Fuel discipline:** JOKER = RTB-dash +25% (warn) · BINGO = RTB-cruise +10% (disengage in 3) · FUMES: glide, dead-stick PSR +4, eject 5+
**Detection:** flight SIG 6 / pair 8 / single 9 / DropShip burning 3 · Dash/climb −2 · glide +3 · DECK = terrain-masked
**Crews:** Fatigue +1/sortie · 4+: +1 TNs · 7+: grounded · day stand-down clears 4

*SKYWATCH is a fan framework for use with the BattleTech tabletop game (© The Topps Company, Inc.; rules published by Catalyst Game Labs). All actual combat resolution uses your published rulebooks; this module reproduces no rules text.*
