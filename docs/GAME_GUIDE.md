# OVERRIDE — The Complete Game Guide

Every mechanic, every unit type, every action — how the campaign engine actually works.
All numbers quoted here live in `src/rules.ts` and can be house-ruled there; the in-app
**📘 field manual** (`/manual`) always shows your server's live values. Where a decision
was a judgment call, the ID (D-###) points to `DECISIONS.md`.

**The short version of the whole game:** two (or more) sides fight a planetary campaign
under real fog of war. Each side sees only its own screen. You give *orders*, time
passes, sensors grope for the enemy, supply lines strain — and the moment opposing
formations actually collide, the campaign **freezes** and hands you a tabletop battle
setup. You fight it with real BattleTech on a real table, type the result back in, and
the war moves on carrying every consequence: damage stays on the record sheets, pilots
heal or improve, wrecks become salvage, fuel spent is fuel gone.

---

## 1. Time — the clock

Time moves in **ticks of 6 minutes** (one contact turn). The engine picks its own gear:

| Tier | Step | When |
|---|---|---|
| **CONTACT** | 6 min | opposing formations within 5 hexes *and* at least one side knows it |
| **PULSE** | 1 hour | active ground operations somewhere (orders running, live contacts) |
| **WATCH** | 6 hours | nothing near anything |

240 ticks = 1 day. Dawn is 06:00, dusk 18:00 — night matters (see *Seeing*). The GM
steps the clock manually or sets **autopace** (one step every N real minutes, pausing
automatically while a battle is frozen). Orders are plotted at any time and take effect
next tick. **Orders stand**: a formation keeps executing its last order until you
replace it.

---

## 2. The three maps

- **Ground theaters** — hex maps at 18 km/hex. Formations, facilities, terrain, roads.
- **The air layer** — one high-altitude grid above the theaters; a whole theater map
  sits under a single air hex. Flights, DropShips in atmosphere.
- **The system map** — nodes (jump points, planets, moons, gas giants, stations, belts,
  pirate points) connected by lanes measured in AU. DropShips, JumpShips, WarShips.

Units cross between layers: takeoff/landing (ground ↔ air), ASCEND/DESCEND (air ↔
orbit node), and jumps (node ↔ node, instantly, with a system-wide flash).

---

## 3. Unit types — all fourteen classes

Every unit's stats (speed, class, gear tags, BV, fuel) derive from its **real record
sheet**: the model name resolves against the bundled MegaMek library and the .mtf/.blk
is parsed. Explicitly authored values always win.

| Class | Moves as | Notes |
|---|---|---|
| **MECH** | ground | climbs mountains; OMP from Walk MP |
| **INFANTRY** | ground | climbs mountains; near-invisible dug into urban/woods (SIG 13); urban SIG bonus +3 |
| **BA** (battle armor) | ground | as infantry, mech-grade squad |
| **PROTO** | ground | as mechs |
| **VEHICLE** (tracked) | ground | barred from mountains |
| **VEHICLE** (wheeled — tag `WHEELED`) | ground | double cost off-road in rough/woods/swamp; barred from mountains |
| **VEHICLE** (hover — tag `HOVER`) | ground, skims | crosses **water and swamp at cost 1**; mountains are a wall |
| **VTOL** | flies the ground map | **ignores terrain entirely** — every hex costs 1, mountains and lakes included — at **×2 OMP**. Takes no road bonus (and no road signature penalty): it flies straight. A recon VTOL carries the best mobile sensors in the game (passive 4 / active 8) |
| **NAVAL** | water only | cost 1 in water hexes, impassable everywhere else |
| **SUPPORT** | ground | trucks, towed guns, MASH, mobile HQs; barred from mountains; usually wheeled |
| **CONV_FIGHTER** | air | sips fuel — **half cost** on transit and loiter |
| **ASF** (aerospace fighter) | air + space-capable | full fuel costs, full thrust |
| **SMALL_CRAFT / DROPSHIP** | air + space | physical carriers (see §12); hull shape matters: **SPHEROID** crawls at 1 air hex/turn in atmosphere, **AERODYNE** flies at full cruise/dash |
| **JUMPSHIP / WARSHIP** | space | K-F drives, sails, the jump board; JumpShips are taboo to kill (−10 VP + Reprisal) |

**A formation moves like its most restrictive member** — the same rule as speed (OMP =
slowest Walk/Cruise MP in the formation). A special motion family (VTOL, hover, naval)
applies only when *every* unit in the formation shares it; mix a tank into a mech lance
and the column is barred from mountains.

### Terrain × motion — who can enter what

| Terrain | Mech / Inf / BA / Proto | Tracked | Wheeled | Hover | VTOL | Naval | SIG mod | Blocks LOS |
|---|---|---|---|---|---|---|---|---|
| CLEAR | 1 | 1 | 1 | 1 | 1 | ✗ | — | no |
| WOODS | 2 | 2 | 4 | 2 | 1 | ✗ | +1 | no |
| ROUGH | 2 | 2 | 4 | 2 | 1 | ✗ | — | no |
| HILLS | 2 | 2 | 2 | 2 | 1 | ✗ | — | **yes** |
| MOUNTAIN | 3 | ✗ | ✗ | ✗ | 1 | ✗ | — | **yes** |
| WATER | ✗ | ✗ | ✗ | 1 | 1 | 1 | — | no |
| SWAMP | 3 | 3 | 6 | 1 | 1 | ✗ | +1 | no |
| URBAN | 1 | 1 | 1 | 1 | 1 | ✗ | +2 (inf +3) | **yes** |

*(numbers are OMP cost to enter the hex in contact mode; ✗ = impassable)*

**Roads & rail**: entry cost ×½ (minimum 1) in contact mode; ×1.5 speed at pulse scale.
Marching on a road makes you predictable: SIG −1 to be spotted. VTOLs ignore roads both
ways. An impassable hex on your plotted route **stalls the column** — the order sits
with a ⏳ reason on your screen until you re-plot.

### Speeds in real terms

OMP is hexes per hour. A mech battalion ≈ 3 (54 km/h), tanks ≈ 4, hover/VTOL ≈ 8×2
(~140+ km/h effective for VTOLs with the ×2). In contact mode you get OMP/10 of budget
per 6-minute turn — units visibly crawl hex to hex when the enemy is close.

---

## 4. Formations — the counters you command

- **SIG (signature)** by size: battalion 5, company 6, lance 7, single unit 9, foot
  squad 10. Bigger = easier to spot.
- **RDY (readiness 0–10)**: your fuel-for-humans. −1 per battle (−2 if you lost), −1
  per pulse of forced march, −1 per day out of supply. REST recovers +2/pulse in supply
  (+1 without). Bands bite: RDY 5–7 = +1 TN on everything at the table, 2–4 = +2 TN and
  attacks need a 2d6 ≥ 8 commitment check, 0–1 = the formation can only rout.
- **Posture**: `HIDE` (SIG +2, breaks when you move), `DIGGING` → `DUG_IN` after 2
  pulses (SIG +1, fortified at the table; engineers halve the digging), `FORTIFIED`
  (authored). **Moving breaks HIDE and DUG_IN** — always.
- **EMCON**: `DARK` (SIG +2, passive sensor range −2, **off the command net**),
  `PASSIVE` (normal), `ACTIVE` (radar blazing: your searches roll +2, but SIG −2 — you
  are a lighthouse).
- Formations carry supply (`carriedSp`) if they're convoys, fuel ledgers if they fly,
  bays if they're carriers.

---

## 5. Seeing & being seen — the contact ladder

You never see enemy units. You see **contacts**, which climb four rungs:

1. **GHOST** — something's there; position ±1 hex, nothing else.
2. **SHADOW** — a track: heading and rough size. Enough to plot a STRIKE, a SHADOW
   tail, or an air intercept (nothing can be intercepted below SHADOW).
3. **CONTACT** — composition: what kinds of units. Artillery and air can now target it
   (at −2 on the table; clean at LOCK).
4. **LOCK** — the full picture, down to the unit list.

**The roll**: each detection window, every searcher rolls 2d6 against the target's
TN = SIG + modifiers. Success climbs the ladder one rung. Contacts **fade one rung per
pulse** without re-detection. Sharing a hex is an automatic mutual LOCK.

**Target modifiers (make you harder or easier to see):** moving −1, forced march /
sprint −2, jump jets −2, firing artillery −3 (your firing hex is *automatically*
revealed at CONTACT to counter-battery), road march −1, HIDE +2, cautious movement +2
(keeps concealment, suppresses the moving penalty — D-006), dug in +1, night +2 to all
passive sensing, rain +1, Guardian ECM +1, Angel ECM +2, stealth armor +2, EMCON DARK
+2, EMCON ACTIVE −2, terrain (woods/swamp +1, urban +2, infantry in urban +3).

**Searcher modifiers (change your roll):** EMCON ACTIVE +2, a PATROL order +1, lean
loiter −1 (a fuel-sipping flight searches badly).

**Sensor ranges (op-hexes, passive/active):** standard mech 2/4, Beagle-probe-equipped
3/5, recon VTOL 4/8, Mobile HQ or sensor vehicle 4/8, fixed sensor station 6/12, the
Mk1 Eyeball 3 by day / 1 at night (needs line of sight — hills, mountains, and cities
block it). EMCON DARK cuts your own passive range by 2.

**Recon satellites** sweep a 10-hex-wide ground track every 4 pulses. **Comm satellites**
make your net theater-wide.

**Deception**: a `DECOY` unit makes its formation read one size class *bigger* to
everything below LOCK. A false transponder squawk in space holds until inspected
(2d6 ≥ 9) — or until you maneuver like a warship, which fails it automatically.

**Reports travel.** Detections made by an off-net scout sit in its logbook and reach
your inbox only when *it* returns to the net. What your screen shows is what your side
has been *told* — the estimate can be hexes stale. The war diary (📖) is your side's
chronicle of everything delivered.

---

## 6. The command net

Orders only reach formations **on the net**: within reach of a command node — your HQ
formation (radius 12), a grounded DropShip or fixed base (radius 24), facilities as
authored, any comm satellite (theater-wide). Hostile ECM cuts the net in its own hex.

Off-net formations are on their own: they run their standing order and their
**conditionals** (which is why you plot them). They cannot receive new orders until
they're reached — physically. The GM has a "send a runner" recall action for stranded
units. Losing your HQ hurts more than losing a lance.

**Conditionals** ride on any order and fire even off-net:

| Trigger | Fires when |
|---|---|
| `CONTACT_WITHIN` | an enemy contact closes within N hexes |
| `DETECTED_SELF` | the formation realizes it's been spotted |
| `TICK_REACHED` | the clock hits T |
| `HEX_REACHED` | the formation arrives somewhere |
| `FUEL_BELOW` | the flight ledger drops below N |
| `RDY_BELOW` | readiness drops below N |
| `ALLY_ENGAGED` | a friendly formation gets pulled into a battle |

A fired conditional replaces the current order with its embedded then-order. This is
how you script a picket that runs home when spotted, or a reserve that marches to the
guns.

---

## 7. Orders — the complete reference

The player screen's order picker filters to what the selected formation can actually do
(check **show all** to see everything). Every waiting order shows a ⏳ plain-language
stall reason.

### Ground orders

| Order | What actually happens |
|---|---|
| **MOVE** | follow the plotted waypoints exactly (the engine walks the drawn line hex by hex); completes on arrival |
| **FORCED_MARCH** | ×1.5 speed, **RDY −1 per pulse marched**, SIG −2 while moving |
| **MOVE_CAUTIOUS** | half speed, keeps HIDE-grade concealment (+2 SIG, no moving penalty) |
| **HIDE** | posture → HIDE immediately (SIG +2). Breaks the moment you move |
| **DIG_IN** | posture → DIGGING; DUG_IN after 2 pulses (1 with engineers). Fortified at the table |
| **PATROL** | active sweep: +1 on all this formation's detection rolls |
| **SCREEN** | tripwire: any enemy moving within reach triggers an interception battle |
| **STRIKE** | march on a *contact* (≥ SHADOW): re-paths every step toward the latest delivered estimate; arrival forces a battle — or completes with a miss if the intel was stale. Blind = holds with "no usable fix" |
| **SHADOW** | tail a contact at 2-hex standoff: closes when the trail stretches, holds when near, never enters the ring (no battle). Standing order; a faded contact just parks the tail |
| **REST** | recover RDY +2/pulse in supply (+1 without) |
| **REARM** | refill ammo at a stocked depot/factory/spaceport **or convoy** in your hex — 1 SP per unit. Waits (with a reason) until supply exists |
| **REPAIR** | queue every DAMAGED/CRIPPLED unit into the shop in your hex (or your carrier's bays). DAMAGED: 1 SP + 1 day. CRIPPLED: 2 SP + 3 days. Comes back with a **clean record sheet** |
| **RESUPPLY** | a convoy pours its carried SP into a friendly depot/factory/spaceport it's parked on |
| **EMBARK** | march to a friendly carrier's live position and load into a free bay when it's landed. Waits at the ramp if the bays are full or the ship is aloft |
| **DISEMBARK** | step out of the bay onto the carrier's hex (or adjacent) once it lands |

Engineer-tagged formations also run the **engineer toolkit** (GM actions): lay a hidden
minefield (1 pulse), breach one (2 pulses), build a bridge (4 pulses), demolish a
bridge (instant, loud — SIG −3 that turn). Minefields bite movers with a BR-3
quick-resolution hit and are revealed when they bite.

Artillery formations execute **FIRE missions** (GM-run, core §9.1): a standing mission
that shoots each step at a spotted hex (needs ≥ CONTACT), quick-resolves against
whatever is truly there — and reveals the battery's own hex at CONTACT to every enemy
that can range it. Shoot-and-scoot is the lifestyle. Ranges: Arrow IV 8 hexes, Sniper
18, Thumper 21, Long Tom 30, cruise missiles 50–120.

### Air orders (flights, VTOL-carriers excluded — flights are ASF/conventional fighters and DropShips)

All launches gate on: turnaround finished, crews not fatigue-grounded (fatigue ≥ 7),
and — for intercepts — a track at SHADOW or better. Launch delay depends on the alert
state; the climb-out pays flak under the departure path.

| Order | What actually happens |
|---|---|
| **CAP** | fly to a station, loiter (paying the ledger), engage anything hostile resolved in your hex — CAP and SWEEP have standing intercept intent |
| **SWEEP** | as CAP but prowling a route |
| **STRIKE_AIR / CAS** | fly a ground-attack mission; while holding one within 24 air hexes of a battle, you appear in its handoff as **off-board air support** with arrival timing |
| **ESCORT / FERRY / INTERDICTION / RECON / SAR / TANKER** | fly the plotted route/station; RECON widens your search; TANKER transfers fuel 1 ton delivered per 2 carried (GM action); SAR recovers downed crew markers |
| **ORBITAL_STANDBY** | hold ready in orbit (responds in ~3 ticks) |
| **LIFT_OFF** | (DropShips) get airborne and *hold* — a standing hover until your next order |
| **LAND** | put down on any **passable** hex — no facility needed. Water refuses the landing. Outranks a fuel-forced RTB: putting down now is how a bingo ship saves itself |
| **ASCEND** | climb the gravity well: ~36 min and 80 FP to the planet's orbit node |

Chasing works on predicted intercept points ("ahead of the bandit's plot") when the
track is live; a cold trail means the bandit shook you and the flight turns home.

### Space orders (vessels at nodes / on lanes)

| Order | What actually happens |
|---|---|
| **TRANSIT** | burn a lane: accelerate, flip, brake (real brachistochrone math; `burnProfile.g` sets the G). Your 1G+ drive plume is **automatically detected system-wide after light lag** (8.3 min/AU) — everyone learns your vector and mass class |
| **COLD_COAST** | drift the lane dark: slow, quiet (SIG 11), the sneaky approach |
| **STATION_KEEP** | hold at a node (SIG 8) |
| **INTERCEPT** | commit to an encounter: the classifier solves the geometry (MATCHED / SLASH / STERN_CHASE / BLOCKADE / no-solution) and freezes a SPACE battle |
| **SKIM_FUEL** | scoop a gas giant: 1d6×10 tons per watch, piloting TN 7 |
| **RECHARGE_SAIL** | deploy the sail and charge the K-F drive (≈ a week; can't thrust while deployed) |
| **QUICK_CHARGE** | at a recharge station: 2d6 ≥ 8 fills in 5 watches; ≤ 3 damages the drive |
| **JUMP** | through the door: needs 100% charge or an L-F battery. Pirate points need the survey (secret until acquired) and roll 2d6 ≥ 9 (≥ 7 surveyed); ≤ 4 misjumps. The jump flash announces you system-wide, after light lag |
| **INSPECT** | customs: resolve a transponder squawk (lie holds on 2d6 ≥ 9; a hard-burning "merchant" fails automatically) |
| **BLOCKADE / BOARD** | intent markers the GM resolves — blockades choke off-world imports (see Supply); boarding is possible against a crippled ship in a MATCHED encounter |
| **DESCEND** | re-enter from a planet/moon node into its theater's air layer: ~18 min, 20 FP (the atmosphere does the braking) |

---

## 8. Battles — the table takes over

The engine **never simulates combat**. Battles trigger when: opposing formations share
a hex, a SCREEN trips, a STRIKE arrives, an air chase catches its target, or a space
INTERCEPT commits. The campaign freezes.

1. **Evasion** (ground): the defender may slip — opposed 2d6 + OMP, +2 if the attacker
   only holds GHOST/SHADOW; win by 3+ to slide 2 hexes (auto-detected at CONTACT).
2. **The handoff** is built from the operational state: entry edges from real approach
   headings; **intel = initiative** (+1 per ladder-level advantage, 3 turns; a live C3
   master adds +1; disadvantaged side deploys first); HIDE = hidden setup; DUG_IN =
   fortified; low RDY = TN penalties; off-board artillery in range; CAS on call with
   arrival turns; friendly formations nearby as reinforcements (arriving turn = 5 ×
   distance in hexes); and every unit's **persisted record-sheet damage** from previous
   fights.
3. **Fight it** — in the built-in battle tracker (⚔, real Override record cards) or on
   paper via the **🖨 battle pack** (printable briefing + rosters with damage pre-marked
   + a result form).
4. **The result comes home**: damage states, exact marked-up sheets, ammo, fuel
   remaining, pilot hits and kills, ejections, who held the field. Ingesting unfreezes
   the campaign. Survivors of a battle hold mutual LOCK.

Air merges add energy: starting velocity + altitude; higher energy wins initiative ties
for 3 turns and may decline the first pass. A side at CONTACT+ vs a blind (≤ GHOST)
enemy *bounces* them. BINGO fuel forces disengagement within 3 turns. Space battles get
the classifier's geometry (slash duration, velocity gap) and fresher-light initiative.

---

## 9. Supply & the economy

- Every formation eats **1 SP/day** (×2 after fighting or force-marching), drawn along
  a road-favoring supply line up to 30 hexes (half range off-road) from a stocked
  depot/spaceport/factory or a convoy.
- **Cut off** ⇒ RDY −1 per day. This kills armies quieter than guns do.
- **Factories** mint 2 SP/day while you hold them. **Convoys** carry 10 SP per truck
  formation and deliver with RESUPPLY.
- **Off-world imports** flow into spaceports until the enemy holds *every* jump point
  uncontested — a **blockade**.
- **Salvage**: wrecks on a field you held become tokens; haul one to a depot and roll
  2d6 ≥ 8 — an intact recovery queues a **refit** (3 SP, 4 days → the unit joins your
  roster with a pool pilot); a failure strips 2 SP of parts. Air kills rain their wrecks
  onto the map below.
- **Aviation fuel**: 1 SP converts to 2 tons at a depot. Carriers stock their own
  (`avFuelTons`).

---

## 10. Pilots — the career loop

Named pilots persist. On every battle ingest, surviving crews earn XP: **+1 survive,
+1 win, +2 per kill**. Every **8 XP** the weaker of gunnery/piloting improves (gunnery
on ties; floors 1/2). **5 kills** makes an ace — announced in enemy briefings, because
fear is a weapon.

**Wounds**: each pilot hit takes **3 days** of bed rest — **1 day** if your side fields
a live MASH unit. The exact hit count carries to the next battle's condition track
until healed. Ejected crews become **downed-crew markers** on the map: send anything to
their hex for SAR pickup and they return to your pilot **pool**, from which refitted
salvage and replacements are crewed.

**Aircrew fatigue** (separate from wounds): +1 per sortie, +2 per ejection, +1/pulse
standing ALERT-5. At 4, table TNs suffer; at **7 the crew is grounded**. STAND_DOWN
clears it (−1 per 6 pulses).

---

## 11. The sky — fuel is the game

Every airborne tick pays the **flight ledger** (FP). Cruise 1 FP/hex (12 hexes/turn),
dash 2 FP/hex (safe thrust × 6 hexes/turn), loiter 2 FP/min (lean loiter 1 — but your
searches roll −1). Conventional fighters pay **half** on transit and loiter. Takeoff:
10 FP vertical, 4 with a runway (AIRSTRIP/SPACEPORT). Climbing costs 2 FP/level.

**JOKER / BINGO**, recomputed live from your actual distance home: JOKER (return-at-dash
× 1.25) is the warning; **BINGO** (return-at-cruise × 1.10) cancels the mission and
turns the flight home automatically. Home is your base — or your **carrier, wherever
it has moved**.

**Alert states** (grounded flights): ALERT-5 launches instantly but burns fuel and
fatigues crews every pulse; ALERT-15 in 1 tick; ALERT-60 in an hour; STAND_DOWN in 2
hours but recovers fatigue.

**Turnaround** (rearm + refuel): 2 pulses per flight (≤ 6 aircraft per crew) from a
facility's fuel farm — or **hot pit** in 1 pulse with a mishap chance (2d6 ≤ 3: burn
1d6×10 FP of farm stock and stand down a pulse).

**Spheroid vs aerodyne** (the user ruling, D-030): a spheroid DropShip stands on its
drive plume — **1 air hex per turn** in atmosphere, cruise or dash. Its fast lane is
vertical: ASCEND to orbit, cross the system map, DESCEND onto the hex you want.
Aerodynes fly like aircraft at full speed.

---

## 12. Carriers — the physical DropShip story

A formation with a `carrier` block (bays, crews, av-fuel) is a physical transport:

- Embarked formations **ride along invisibly** — no signature, no supply draw of their
  own (the ship feeds them), skipped by every detection pass. The hull masks the cargo.
- Players fly their own ships: **EMBARK** (troops march to the ramp), **LIFT_OFF**
  (standing hover), **LAND** (any passable hex), **DISEMBARK**, plus space transit with
  the troops aboard. GM extras: **combat drop** (1d6 scatter, reduced by piloting
  margin, +2 in storms, +2 through flak; the dropped force arrives at LOCK for everyone
  watching the sky) and mid-air fighter launch/recovery.
- A stowed **flight** with an air mission scrambles straight off the deck; its
  RTB/joker/bingo then track the carrier as it moves, and it **auto-recovers into a free
  bay** on return (full bays = wave-off, holding over the ship).
- **Carrier rearm**: a recovered flight tops off from ship stores — one crew, standard
  turnaround time, drawn from `avFuelTons`. Carrier crews also run **repairs** on
  embarked units at sea/in flight.
- If the carrier dies, embarked formations are stranded at its last position.

---

## 13. Flak — the ground bites back

Tactical AA (`AA`-tagged units, e.g. a Partisan) can't reach high-band transit — it
kills at the **interface points**. Any launch, landing, final approach, drop pass, or
deck scramble inside an AA umbrella (battery's hex + 2) takes **one 2d6 shot per
battery, hitting on ≥ 8** for one damage step (OK→DAMAGED→CRIPPLED). Dropping through
flak also scatters +2 hexes. Firing reveals the battery at CONTACT — shoot and be seen,
exactly like artillery.

---

## 14. Space — the system war

- **Burns are physics**: transit time = 2.835 × √(AU ÷ G) days, flip at midpoint. Higher
  G is faster but grinds crews: −1 RDY per 2 days at 1.5G, per day at 2G; 3G+ needs
  couches and daily medical checks.
- **Light lag rules intelligence**: every 1G+ drive plume and every jump flash is
  detected *automatically* by everyone — 8.3 minutes per AU later. You see where ships
  *were*. Cold-coasting (SIG 11) and station-keeping (SIG 8) are the quiet options;
  pickets on active sweep resolve coasters near their node at −2 TN.
- **The jump board**: sails take ~a week to charge (can't thrust while deployed);
  emergency furl risks the charge; quick-charge at stations risks the drive; L-F
  batteries jump on stored charge. **Pirate points** are secret until surveyed and
  risky (misjump on ≤ 4). Killing a JumpShip is taboo (−10 VP and a Reprisal);
  capturing one is a prize (+15 VP).
- **Encounters** are classified from real geometry: MATCHED (full battle, boarding
  possible if you cripple them), SLASH (4+1d6 tabletop turns as you flash past),
  STERN_CHASE, BLOCKADE (defender picks the range bracket).

---

## 15. Victory

Objectives accrue VP daily to whoever **controls** them (occupy uncontested; you keep
it until it's taken back): spaceport/capital 3, factory/HPG 2, depot/named terrain 1.
System objectives: shipyard 3, jump point / recharge station 2, refinery 1; one-shots
for convoys, cripples, captures, stolen surveys. Some objectives are **hidden**; some
are **fake** (they score nothing — reconnaissance matters). First side to the campaign's
VP threshold wins, or highest total at the end tick.

---

## 16. The GM's toolkit

Step / run-to-event / autopace the clock; **↶ undo step** and **⏪ rewind** to any
earlier day (with a receipt of what gets undone); spawn reinforcements (enriched from
their record sheets); inject hand-written reports and phantom contacts; edit undelivered
reports (the noise editor); recall stranded formations; resolve evasion, salvage,
refits, drops, SAR, tanker transfers, inspections; export handoffs to the ⚔ battle
tracker or the 🖨 paper battle pack; and audit any moment of the war event-by-event
(`/audit`). Player links are per-side tokens — players physically cannot see the other
side's screen. `--gm-key` locks the GM screens; `--log file.jsonl` makes the campaign
survive restarts; `OVERRIDE_AUTOPACE` + Discord webhooks run the slow war while
everyone's at work.

---

*Quick cross-reference: the in-app field manual (`/manual`) is the player-facing
summary with live numbers; `docs/HOSTING.md` covers running the server;
`docs/OPERATION_DAGGERPOINT.md` is a full worked campaign using every mechanic here;
`DECISIONS.md` records why each rule reads the way it does.*
