# DECISIONS.md — OVERRIDE GM Tool

Log of every judgment call, ambiguity, or deviation, with reasoning.
Authority order: **spec defines data model & architecture; the three rulebooks define
game behavior and all numbers.** Conflicts are flagged here and resolved by the GM (user).

Status legend: ✅ decided (technical, by builder) · ❓ OPEN — awaiting GM ruling

---

## D-001 ✅ Event log persistence: JSONL first, behind a storage interface
The spec allows "SQLite (or plain JSON files)". Starting with **JSONL** (one event per
line, append-only file): zero native dependencies, trivially auditable/diffable, and the
post-campaign audit viewer (M5) can replay it with `readline`. The log store is a small
interface (`append`, `readAll`, `length`) so a SQLite adapter can drop in later without
touching the engine. Revisit if campaigns grow past ~10⁵ events.

## D-002 ✅ Test framework: Vitest
Native TypeScript, fast, no transpile step. The acceptance scenarios are plain test files.

## D-003 ✅ Hex math: hand-rolled axial coordinates
Spec offers `honeycomb-grid` or hand-rolled; hand-rolled chosen. We need exactly:
distance, neighbors, hex lines (for LOS and corridors), and range queries — ~80 lines,
fully unit-tested, no dependency drift.

## D-004 ✅ RNG: splitmix64-style pure function over (campaignSeed, eventIndex)
Spec mandates `(campaignSeed, eventIndex) → roll` with `seedCursor` stored per roll.
Implementation: a stateless mix function — `roll = f(seed, cursor)` — so any roll is
reproducible in isolation (audit) and replay never drifts. Cursor increments per die
rolled, not per call, so a 2d6 consumes two cursor positions (logged as one DieRoll with
the starting cursor).

## D-005 ✅ The four requirement documents are committed under `docs/`
They are the spec of record; code review of rules.ts should happen against them in-repo.

## D-006 ✅ RESOLVED (GM ruling 2026-06-12): spec example wins — option (a)
GM selected option (a): a **MOVE_CAUTIOUS** order grants Hide's +2 concealment while
moving at half pulse speed and suppresses the moving −1; **night +2 applies to all
passive sensing** (visual *and* electronic passive), with "visual only" retained as the
Mk1 Eyeball's range reduction at night (3 → 1). Active sensors take no night modifier.
M1 acceptance TN: battalion 5 + cautious +2 + DARK +2 + woods +1 + night +2 = **12**.
All five remain independent constants in rules.ts. `MOVE_CAUTIOUS` is added to
`GroundOrderKind` (schema extension, noted inline in types.ts).

Original conflict report follows for the record.

### (record) M1 acceptance test TN-12 cannot be assembled from Module 0 tables as written
Spec M1 acceptance: *"hidden battalion (DARK, woods, night) crosses a sensor line; verify
TN math (SIG 5+2+1+2+2=12)."* Problems:

1. **The named modifiers only sum to 10.** Battalion 5 + DARK +2 + woods +1 + night +2 = 10.
   The fourth +2 is most plausibly **Hide** ("hidden battalion") — but core rules 4.1
   defines Hide as *"Hold position"*, and this battalion is moving across a sensor line.
2. **Night is "+2 vs visual only"** (core 6.3). A *sensor line* (Fixed Sensor Station,
   passive 6 / active 12) is presumably not visual, so strictly the +2 night should not
   apply to it — yet it is part of the spec's 12.
3. **Moving −1 is not applied**, although the battalion is moving. Note the core rulebook's
   own worked example (6.5: "battalion moving DARK on a stormy night through woods,
   SIG 5+2+1+1+2 = TN 11") *also* omits the moving −1. Two independent examples omitting
   it suggests intent (perhaps "moving" −1 is meant for contact-turn detection, not
   pulse-scale creep), but the 6.3 table does not say so.

Strict-rulebook arithmetic vs. a non-visual sensor line would give battalion 5 + DARK 2 +
woods 1 − moving 1 = **TN 8**, i.e. *very* detectable — which contradicts both the spec's
acceptance criterion and the core book's explicit fiction ("functionally invisible…
This is how Kurita does it").

**Candidate resolutions (GM to pick):**
- **(a) Spec-example wins, recommended:** the M1 scenario uses TN 12 = base 5 + Hide-style
  concealment discipline +2 + DARK +2 + woods +1 + night +2, with night applying to the
  sensor line and no moving −1 at pulse scale. Mechanically: allow a "MOVE_CAUTIOUS"
  posture (move at half pulse speed, gain the Hide +2, suppress the moving −1), and apply
  night +2 to all passive sensors, reserving "visual only" for the Mk1 Eyeball row's
  *range halving* at night. All five numbers stay as individually house-ruleable
  constants in rules.ts.
- **(b) Rulebook-strict:** moving −1 applies, night is visual-only, Hide impossible while
  moving. The acceptance test then verifies TN 12 only for a *visual* searcher against a
  *stationary* hidden battalion, and verifies the crossing scenario at the lower TN with
  seeded rolls that happen to miss. (Weakens the "effectively invisible" criterion.)
- **(c) Something else** — GM specifies the exact five-modifier decomposition of 12.

**Status:** OPEN — blocking the exact assertions of the M1 acceptance test (the engine,
TN-assembly code, and all other tests are unaffected; every modifier is a rules.ts
constant either way).

## D-007 ✅ M1 scenario reading: the *defender's* scout carries the delayed report
Spec: "report delivery only when scout returns on-net." Read as: a defender scout gains a
contact on the battalion while beyond net radius (or DARK), the report is generated with
`deliveredTick = null`, and delivers — with its original `generatedTick` timestamp — when
the scout re-enters net radius of the defender command node. This also gives the
counter-intel negative test (kill the scout before return ⇒ report never delivers).

---

## D-008 ✅ Small interpretive calls made during M1 implementation
Each of these is a one-line judgment where the rulebooks are silent or vague; all are
constants/flags in rules.ts or commented at the use site, and all are GM-overridable.

1. **ECM net-cut radius:** core 4.2 says ECM bubbles "can locally cut nets" but gives no
   radius. Guardian's 6 TW hexes ≈ 180 m < 1 op hex, so `NET.ECM_NET_CUT_RADIUS = 0`
   (same op-hex only).
2. **Re-net delay applies only after losing a node** (decapitation/destruction). A scout
   simply re-entering its own live node's radius is on-net immediately — core 4.2 reads
   the 1-pulse cost as re-establishing command, not as radio acquisition. Re-nets run in
   parallel (1 pulse each), not serially.
3. **SHADOW position is exact** (`posErrorHexes = 0`). Spec §4 says "exact-ish"; only
   GHOST has a defined ±1 error, so the error model is GHOST-only.
4. **GHOST scatter is hash-derived, not RNG-cursor-derived:** the ±1 hex error comes from
   a pure hash of (campaignSeed, contactId, detectionTick), so it is deterministic and
   auditable but does not consume seedCursor (D-004 reserves the cursor for dice).
5. **Delivered-intel model:** the per-side *view* renders only the latest **delivered**
   report snapshot per contact (level, est. position, as-of tick). The truth-side ladder
   (climb/fade) governs detection mechanics; the view's freshness is expressed by the
   `staleAsOfTick` timestamp, exactly the "last-known ghosts that age visually" of core
   13.2. Delivered snapshots are not retro-faded — a courier-delivered stale SHADOW
   report stays visible *as a stale report*.
6. **Views never expose `targetFormationId`** (a true-identity key); contacts are keyed
   to players by contactId only. LOCK reveals composition/TO&E content, not internal ids.
7. **Detection cadence = once per engine step** (contact turn in CONTACT mode, pulse in
   PULSE mode, watch in WATCH mode). Core 6.3 specifies per-contact-turn and per-pulse;
   WATCH-rate detection only ever applies when no ground ops are active.
8. **"Active ground ops" (PULSE criterion)** = any side has an incomplete order, or any
   contact at level ≥ 1 exists. Otherwise WATCH.
9. **Sensor stations & satellites are always on-net sources** for report delivery
   (fixed infrastructure / downlink); formations use the 4.2 net rules.
10. **Night applies to satellites** (passive optics per D-006's "all passive sensing").
11. **Forced-march breakdown roll (core 5.3)** is parked as a rules.ts constant but the
    engine hook is deferred to M2 (orders milestone) — it needs the Repair order loop to
    matter. RDY −1/pulse of forced march *is* implemented in M1.
12. **Hidden objectives** stay invisible in views until a GM reveal (no automatic
    discovery rule exists in Module 0); fake objectives render as real until exposed.
13. **EMCON DARK searcher penalty (core §6.1 "Passive sensors only, SNS −2"):** read as
    a passive-range penalty of −2 hexes (SNS is the range stat per §6.2), eyeballs
    unaffected. Constant `SENSOR_RANGES.DARK_PASSIVE_RANGE_PENALTY`.
14. **Order supersession:** when several orders for one formation are due, the most
    recently plotted (highest effectiveTick) wins and preempts the active order
    (`ORDER_SUPERSEDED` event). Needed so a plotted RTB can interrupt a standing PATROL;
    matches "the GM tool executes these even when the player isn't present".
15. **Reports carry new information only:** a contact report is queued on a ladder climb
    or a position change, not on every re-confirmation of a stationary LOCK (which would
    flood the inbox in contact time). Re-confirmations still refresh the fade clock.
16. **Genesis net initialization:** `Campaign.create` runs the net & scouted-terrain
    passes at tick 0 and appends the resulting events to the log, so formations standing
    inside their node's radius start on-net (and order entry works before the first step)
    without any out-of-band state mutation.

---

## D-009 ✅ Milestone 2 interpretive calls (orders & engagement)
The spec lists the M2 deliverables but defines no fixed M2 acceptance scenario, so the
gate is the round-trip acceptance test (`test/acceptance/m2-strike-roundtrip.test.ts`)
plus all M1 tests staying green. Calls made, all rules.ts-backed and GM-overridable:

1. **Conditionals fire off-net** (spec §3.3): `triggerPass` evaluates a formation's active
   order conditionals every step regardless of net status, then spawns the embedded
   `thenOrder` (fresh id, effective next tick) which supersedes the current order via the
   existing M1 order-activation machinery. A fired conditional is marked `fired` so it
   cannot re-fire.
2. **Trigger semantics:** TICK_REACHED/RDY_BELOW/HEX_REACHED are literal; CONTACT_WITHIN =
   an *own-side* contact (level ≥1) within N hexes; DETECTED_SELF = an *enemy* holds
   ladder ≥ param (default 1) on this formation; ALLY_ENGAGED = a live engagement
   involving a friendly within N hexes. FUEL_BELOW is parked until M3 (always false).
3. **Attacker/defender** (drives evasion bonus & initiative): STRIKE → striker attacks;
   SCREEN → the mover attacks, screener defends; SAME_HEX → the side with the better
   contact ladder on the other is the attacker (it pressed the fight), tie broken by who
   moved this step, then by deterministic id order.
4. **SAME_HEX requires a fresh arrival** (someone with `transient.moved !== NONE` in the
   hex) so a resolved battle whose forces remain co-located does not instantly re-trigger.
   STRIKE/SCREEN have explicit triggers and are exempt from this guard.
5. **STRIKE movement** re-paths toward the *delivered* contact estimate each step (stale
   intel ⇒ you march to where the enemy was). Reaching the estimate hex with the enemy
   present ⇒ battle; reaching it empty ⇒ the order completes with a miss (no pathfinding
   cleverness — the GM is in the loop). STRIKE never self-completes in the movement pass;
   the engagement pass owns its arrival.
6. **One engagement at a time:** the first candidate (deterministic id order) freezes the
   campaign (`pendingEngagementId`); `step()` is a no-op while frozen, exactly the spec's
   "pause(), exportHandoff(), await ingestBattleResult()".
7. **Co-located battles auto-LOCK both sides** (M1, core §6.4), so a ground SAME_HEX/STRIKE
   engagement has *zero* intel-initiative differential by construction — both sides see
   each other at LOCK at the moment of contact. The intel=initiative bonus (core §7.2.3)
   therefore only manifests for non-co-located engagements (SCREEN, where the screener is
   adjacent) or hidden setups. This is faithful, not a bug; the acceptance/handoff tests
   reflect it.
8. **Handoff entry edges** are derived from each side's spearhead `lastHeadingDeg`
   collapsed onto the package's 6-edge vocabulary; unknown heading ⇒ `ANY_HALF`. Off-board
   artillery = friendly units tagged with an `ARTILLERY_TAG_RANGE` key within range of the
   battle hex; reinforcements = friendly *on-net* formations within range, `arrivesTurn =
   hexes × 5` (core §7.2.5). Default crew 4/5 (`COMBAT.PILOT_DEFAULT_*`) when no Pilot is
   assigned.
9. **BattleResult import** emits granular events (damage, pilots, ejection markers, RDY,
   auto-LOCK, salvage, destruction, withdrawal, rout) then a final
   `BATTLE_RESULT_INGESTED` that unfreezes the campaign and stamps `lastBattleTick`. Order
   is chosen so every reference resolves before destruction; full-log replay reproduces
   truth byte-for-byte across the battle.
10. **Rout** (core §3.2/§7.4): a survivor projected to RDY ≤1 post-battle gets
    `routUntilTick = now + 2 pulses`; while routed it refuses player orders
    (`issueOrder`) and the tick loop will not activate queued orders for it. The
    *automatic* "forced-march away from contacts" rout *movement* is deferred (GM moves it
    by hand for now) — the commandability lock is the testable core.
11. **Salvage** (core §7.5): destroyed units in the battle hex become SalvageTokens held
    by the hex-controller; `resolveSalvage` rolls 2d6 ≥8 (logged) ⇒ UNIT else PARTS and
    consumes the token. Hauling-to-depot logistics deferred to a later logistics pass.
12. **Supply** (core §10.2) uses a *straight-line* depot-range test for M2 (≤30 hexes to a
    stocked friendly DEPOT/SPACEPORT); the full path-based "friendly-controlled hexes"
    supply line is deferred and logged here. Daily SP draw is anchored on each formation's
    `lastSuppliedTick` so clock compression cannot skip a day. Out of supply ⇒ −1 RDY/day.
13. **REST recovery** applies only at PULSE/WATCH scale (you do not rest mid-firefight in
    CONTACT mode): +2 RDY/pulse in supply, +1 out of supply, capped at 10.
14. **Quick Resolution stays a human procedure** (the "battles are never simulated" hard
    requirement): the GM runs it at the table / in their head and enters the outcome
    through the same BattleResult form. `turnsElapsed` is tabletop bookkeeping and does not
    advance the campaign clock.

---

## D-010 ✅ Milestone 3 (SKYWATCH) interpretive calls & conflicts
The acceptance contract is the §12 worked day reproduced tick-for-tick
(400→240→179→159 FP). Three places where Module 1 contradicts itself were resolved by
anchoring on §12, the same precedent as D-006 (the worked example is the law):

1. **Alert fatigue rates conflict.** §3.1 says ALERT-5 "2×/pulse" and ALERT-15
   "1×/pulse"; §11 says "+1 per 4 pulses at ALERT-5"; §12 says "Fatigue +1/pulse begins"
   at ALERT-15 — and then ends the day at **Fatigue 3** (4 pulses of ALERT-15 + 1
   sortie). Only A15 = ½/pulse, A5 = 1/pulse reproduces Fatigue 3. §11's "per 4 pulses"
   loses; constants in `SKYWATCH.ALERT`, trivially house-ruleable.
2. **§12's intercept geometry is internally inconsistent** ("dash 2 contact turns = 36
   hexes at 2 FP/hex" yet −144 FP; "JOKER was 90" implies a 36-hex RTB; "cruise home 18
   hexes"). The FP ledger column is exact and is the acceptance; JOKER 90 is verified as
   the 36-hex formula in the module-1 table tests; the engine's own geometry is
   self-consistent (dash = ST×6 hexes/CT, 72 hexes dashed for 144 FP).
3. **Map-change ×2/÷2 is NOT applied at handoff.** §1 says "the GM tool applies this
   automatically at handoff", but §12 puts 240 FP on the table, burns 61, and banks 179 —
   strictly 1:1. Handoff exports ledger FP unconverted; the ×2/÷2 constants exist for
   mid-battle map transitions (§7.1's "Mixed" row), applied by the GM at the table.
4. **Conventional fighters:** the spec's FuelLedger comment (160 FP/ton conv) and
   SKYWATCH §2 ("halve all transit/loiter costs") are the same advantage stated twice.
   Implemented once: 80 FP/ton for everyone, conv transit/loiter ×0.5; takeoff, climb
   and landing cost full price (they are not "transit/loiter").
5. **JOKER/BINGO are transit-only** (no landing/descent term): 90 = 36 × 2 × 1.25 exactly.
6. **Air detection model:** radar horizon at HIGH = the searcher's own theater air hex
   (sensor stations & Mobile HQs +1 air hex — the EW line); LOW band collapsed to the
   same envelope for M3 (no per-aircraft ground track yet); DECK is terrain-masked = GM
   territory; air-to-air resolution in own + adjacent air hex; an air GHOST has no
   position scatter (vague in identity, not in radar bearing).
7. **Clock:** pending scrambles, active chases, and any airborne formation within 3 air
   hexes of enemy aircraft or enemy-occupied sky run in CONTACT turns
   (`AIR_CONTACT_CLOCK_RANGE`) — §6's "on the grid, in contact turns".
8. **Night +2 extends to the sky** for passive searchers (D-006 applied consistently);
   active sweeps exempt. This is why the demo recon flies at 0700, not 0300.
9. **Pursuit prediction:** a chase steers at the target's predicted end-of-turn position
   (vector + flown speed) while the track is live (≥SHADOW), falls back to the stale
   estimate otherwise, and gives up on a cold trail (track < SHADOW, nobody home) ⇒ RTB.
   §6's tail-chase rule emerges naturally: a slower pursuer never catches a runner.
10. **Alert launch delays** are measured from the scramble call (order issue tick).
    ALERT-15 = next contact turn reproduces §12's 0900 SHADOW → 0901 takeoff exactly.
11. **After an air battle:** survivors auto-RTB; the GM records tabletop exit drift via
    `repositionAir` (§8.1 "returns to the grid at its exit velocity and vector"); in air
    merges energy is initiative (specialRules), the intel ladder grants no init bonus;
    surprise = CONTACT+ vs ≤GHOST ⇒ the bounced side deploys first, pinned to its
    approach edge.
12. **Interception requires intent**: a chase order on that contact, or a committed
    CAP/SWEEP, plus ≥SHADOW (§5/§6). Strangers crossing in the same air hex do not
    auto-battle.
13. **Replay-safety fix (latent M2 bug):** fractional accumulators (forced-march RDY,
    dig-in progress) were mutated outside the event log and would have diverged under
    replay; they now persist via `FORMATION_BOOKKEEPING` events, as do all M3 air
    anchors (fatigue clocks, launch gates, loiter countdowns).
14. **Turnaround** applies fuel/ammo at start with `readyTick` gating the next launch;
    a hot-pit mishap's stand-down pulse is folded into readyTick. Fuel farm pays
    refuel + mishap losses in tons at 80 FP/t.
15. **Deferred Module-1 mechanics** (constants parked & table-tested; engine hooks
    later): the capturable ATO artifact, ORBITAL_STANDBY & the orbit-climb gauntlet,
    drop-corridor interception, Skyeye, ESCORT/INTERDICTION/TANKER/SAR mission specials,
    AA flak ceilings, FUMES gliding & dead-stick landings, automatic ace kill-tracking.

---

## D-011 ✅ Milestone 4 (DEEP SKY) interpretive calls & conflicts
The acceptance contract is Operation SKEAN (§9.1): the 83-minute flash, the SIG-11 dark
approach broken by the picket's sweep, and a MATCHED classification at ~2.1 burn-days.

1. **Light lag: 8.3 min/AU, not 10.** §4.2 states the rule as "10 minutes per AU", but
   §9.1 (and the spec's M4 acceptance) demand the 10 AU flash land planetside after
   **83 minutes** — real light speed. Worked example wins (the D-006 precedent):
   `LIGHT_LAG_MIN_PER_AU = 8.3`, house-rule it back to 10 if you prefer round numbers.
   Lag rounds to the engine's native 6-minute tick (≥1), not "the nearest pulse" —
   pulse-rounding 83 min down to 60 would deliver information faster than light.
   §4.2's "at Watch scale ≥6 AU is one Watch stale" emerges naturally from Watch-pace
   delivery and is asserted in the acceptance.
2. **Geometry is the lane metric, not Euclidean space.** Distances (light lag, picket
   range, classifier) run over the node-and-lane graph via shortest path, with lane
   positions interpolated. The map "lies to you" less than a hex grid would (§1).
3. **The classifier's units:** MM = burnDaysRemaining × g_max × crewGLimitFactor
   (g > 2 discounts to 2/g — sustained intercepts at hard-burn G don't get full
   credit); gap = |Δv| ÷ 847.3 kps (one 1G burn-day of ΔV). Margin = MM − 2×gap.
   "Can reach the path in time" (SLASH) is simplified to MM ≥ gap/2 — the deliberate
   simplicity §5 asks for; the GM sanity-checks the geometry on the system map.
4. **Sub-1G burns are quiet.** §4.1's automatic detection applies to "fusion drive at
   1G+"; a cold-coast kick at 0.5G stays under the line (how SKEAN's detachment
   "detached cold" without lighting up every scope). Station-keeping (≤0.1G) likewise.
5. **Emissions are a floor, not a climb:** flash/burn auto-detections set the contact to
   SHADOW (position+vector+mass class, stale by light lag) without ladder inflation;
   rolled detections (cold coast SIG 11/watch/searcher, station-keeping SIG 8) climb
   normally. Space detection rolls at watch cadence regardless of clock mode.
6. **Picket sweep:** modeled as the picket formation on EMCON ACTIVE, granting −2 TN
   against targets within `PICKET_RANGE_AU = 1` of its node ("within its node", §4.4).
7. **Clock:** pure system-scale activity (space orders, space contacts) runs at WATCH;
   ground/air ops or contacts tighten to PULSE/CONTACT as before. Brachistochrone
   integration sub-steps at tick grain inside coarse steps so the flip lands where the
   physics says (a watch-grain flip overshoots the midpoint and arrives hot).
8. **Burn-profile semantics** (spec BurnProfile): thrust at g until `coastFromAU` ⇒
   ballistic (SLASH-only if still hot at arrival); otherwise brake by stopping-distance
   (never earlier than `flipAtAU`), arriving at rest. Mid-course re-plots = a new order.
9. **Space intercepts are GM-committed** (`classifyEncounter` to look, `create
   SpaceEngagement` to commit) rather than auto-triggered: §5 says the tool classifies
   "when two forces' paths could cross" and refusing battle is a real choice — the
   GM-in-the-loop owns the commit. NO_ENGAGEMENT near-misses go to the GM log only.
10. **Tactical conversion at the capital handoff:** fpOnTable = tons × fpPerTon (30 for
    big hulls); BattleResult fpRemaining converts back to tonnage for strategic-ledger
    hulls. STERN_CHASE reports the overtake estimate; the battle fires when the GM says
    the overtake completed.
11. **Jump board:** misjump (≤4 on a pirate-point throw) logs the roll and emits a
    MISJUMP event; placement and severity stay with the GM's misjump table. Quick-charge
    failure severity beyond the first escalation is likewise the GM's. The capture
    +15 VP is a GM VP adjustment (capture mechanics are tabletop boarding outcomes);
    the kill −10 VP + Reprisal is automatic on BattleResult ingestion.
12. **Skim piloting TN = 7** (§3 calls for "a Piloting check" without a number);
    failure marks minor structural damage (OK → DAMAGED) and tries again next watch.
13. **Deferred Module-2 mechanics** (constants parked & table-tested): transponders &
    false flags, customs inspection, sentinel drones, passive arrays (staleness halving),
    water cracking, station fuel transfer order flow, convoy/blockade SP pipelines,
    squadron thirst-grouping (fleets move as separate formations for now), hard-burn
    daily medical rolls, orbital fire support.

---

## D-012 ✅ Milestone 5 (Polish) decisions
1. **Map UIs are dependency-free SVG** (`src/ui/hexmap.js`, `src/ui/sysmap.js`) with one
   shared view-model module (`mapmodel.js`) so the fog rules live in exactly one place
   per audience: player models are built from ViewStates (already fogged by
   `project()`), GM/audit models from raw truth. The renderers never see anything the
   projection didn't approve.
2. **Grid extent is public geography** (paper maps of the planet exist); terrain
   *content* stays scouted-only. ViewState gains `theaters` (bounds), `ownFacilities`,
   and `ownSatellites` (own + `knownTo` — core §8.6's "schedule around your eyes"),
   all leak-tested.
3. **The GM belief overlay**: the truth map can superimpose what any chosen side has
   been *told* (delivered snapshots) — the heart of running a double-blind game is
   seeing the gap between the two.
4. **Noise editor**: undelivered reports are editable via `REPORT_EDITED` (in the log,
   so the lie is auditable — the Table Covenant survives the GM's cruelty); phantom
   contacts are injected as delivered snapshots against a synthetic target id and fade
   naturally through the normal ladder. Core §6.6: sparingly, cruelly.
5. **MegaMek export is best-effort** (.mul v1.0): chassis/model split heuristically from
   `Unit.model`, crew skills carried, campaign state (fuel, ammo, setup rights) as XML
   comments. Names must match MegaMek's cache to autoload.
6. **Audit viewer** replays the log server-side (`replay(events[0..n])`) per request —
   the event-sourced core makes "truth at any moment" a pure function, which IS the
   victory-lap feature. No state is kept; the log remains the only authority.

---

## D-013 ✅ Milestone 7 (Fires & Logistics) interpretive calls
Roadmap acceptance: the §6.5 chaff trick + an offensive starved by a cut supply line.
Both pass through the full engine (`test/acceptance/m7-fires-logistics.test.ts`).

1. **`FIRE` is a new GroundOrderKind** (schema extension, like MOVE_CAUTIOUS in D-006):
   a *standing* fire mission. The §4.1 orders table doesn't name an artillery order, but
   §9.1 says "a battery with a fire order"; a persistent order matches "once per contact
   turn / once per pulse at harassment rate" better than a one-shot.
2. **Artillery Quick Resolution** (core §9.1): when no battle is running the engine
   resolves fires itself — `2d6 + floor(BR/5) + intel penalty ≥ HIT_TN(6)`, damage by
   stepping a target unit's damage state (soft targets double, big margins step harder).
   This is the §7.3/§9.1 "Quick Resolution" path; set-piece batteries still go to the
   table (the engine freezes during engagements, so FIRE only auto-resolves out of
   battle). HIT_TN/BIG_MARGIN are ⚙ house-rule knobs in `rules.ts FIRES`.
3. **Counter-battery = CONTACT, not LOCK.** §9.2 says the firing hex is revealed "at
   CONTACT level"; §6.5's flavor says "confident, wrong LOCK." The rule (§9.2) wins —
   CONTACT is the floor; normal detection may then climb it (a unit that just fired is
   SIG −3, often trivially LOCKed anyway). Counter-battery reach = an enemy whose
   *sensors or own tube range* covers the firing hex (a battery can range counter-fire
   even without radar), independent of normal sensor range — "counter-battery radar is a
   thing."
4. **The spotter loop** (§9.1): any friendly formation with clear LOS to the target hex
   removes the intel penalty (forward observer), checked via the same hex-line LOS as
   ground visual detection.
5. **Minefield bite** (§9.3): an enemy that *enters* (transient.moved ≠ NONE) a mined hex
   rolls 2d6 ≥7 to take a hit (soft doubles); your own mines never bite you; the bite
   reveals the field via a GM note + the damage event. The "Quick Resolution at BR 3" is
   abstracted to this roll — modest, GM-overridable. Minefields persist after biting.
6. **Engineer toolkit** is ENGINEER-tag-gated; LAY_MINES 1 pulse, BREACH 2, BUILD_BRIDGE
   4 (engPulseAcc accumulator, event-sourced); DEMOLISH is instant and loud (strips
   BRIDGE/RAIL, flags the engineer FIRED for the −3 SIG noise per §9.3).
7. **Path-based supply** (core §10.2) replaces M2's straight-line test (supersedes
   D-009.12): a Dijkstra line of friendly-controlled hexes, road/rail cost 1, off-road 2
   (the "½ off-road" rule → budget 30), routed around hexes holding a live enemy
   formation (interdiction cuts the line, core §10.3). "Friendly-controlled" is
   simplified to "not enemy-occupied and passable"; a fuller ZOC/control model is
   deferred.
8. **SP economy**: a stocked DEPOT/SPACEPORT/FACTORY, or a convoy carrying SP, is a
   supply source. Daily, each formation draws 1 SP (×2 if it fought within the last day,
   core §10.1) from the nearest reachable source; a dry source or a cut line ⇒ out of
   supply ⇒ −1 RDY/day. A convoy can't ration itself from its own delivery cargo.
   `carriedSp` is a new Formation field; convoys are mobile depots.
9. **RESUPPLY** (the convoy pipeline): a convoy co-located with a friendly depot pours
   its `carriedSp` into the farm (SP_CHANGED) and completes — moving SP from rear to
   front is now a real, interdiction-vulnerable operation.
10. **Deferred to a later logistics pass**: cruise-missile fires, ammo depletion from
    sustained fire missions, rearm/repair SP spend (§10.4 beyond M2 salvage), the
    factory +2 SP/day generation, and decoy/net-intrusion (§6.5/§11).

---

## D-014 ✅ Milestone 8 (combined-arms kit) interpretive calls
Roadmap: combat drops, escort/SAR/tanker, transponders & false flags, blockades —
toward the §12.3 Cavanaugh frame. Acceptance: one scripted assault chaining a false-flag
inspection, a blockade, a combat drop that takes a spaceport, and a SAR pickup
(`test/acceptance/m8-combined-arms.test.ts`), byte-exact on replay.

1. **Combat drops are a GM/Campaign action** (`combatDrop`), not a tick order — a drop is
   a discrete, GM-adjudicated commitment like a jump or an evasion. Scatter (core §8.3):
   1d6 hexes in a 1d6 direction, reduced by the carrier pilot's Piloting margin over
   `COMBAT_DROP.PILOTING_TN`, +2 in a storm; an off-map landing clamps back onto the
   target. The dropped force is revealed at LOCK to every enemy ("arrive at LOCK
   visibility to anyone watching the sky"). ECM-hex +2 is deferred (storm covers the
   case). Mounted formations (`Formation.mounted`) are dismounted on drop.
2. **SAR & tanker are Campaign actions** (`recoverDownedCrew`, `transferFuel`) rather than
   air-engine mission automation: both are point events with a clear trigger (recoverer
   at the crew's hex; tanker offload between co-located flights). SAR returns the pilot
   to POOL and clears the marker; tanker delivers 1 ton per 2 offloaded
   (`SKYWATCH.TANKER_DELIVERY_RATIO`). Continuous ESCORT tethering and ORBITAL_STANDBY /
   the orbit-climb gauntlet remain table/GM concerns (noted, not engine-automated).
3. **Transponders / false flags** (DEEP SKY §4.3): a vessel carries an optional `squawk`
   (claimed identity). `inspectTransponder` resolves a close inspection — the lie holds on
   2d6 ≥ `FALSE_FLAG_TN` (9), but a vessel under a 1G+ burn (`space.burnStartTick` set)
   fails automatically ("maneuvers like a warship"). A blown flag drops the squawk and
   reveals the true hull at LOCK. Neutral-traffic generation is a GM/fixture concern
   (the `neutral` flag exists for it).
4. **Blockade & off-world imports** (DEEP SKY §9): a side may declare `importSpPerDay`
   into a `homeDepotId`; the daily scoring pass delivers it unless the side is blockaded.
   Blockaded = every jump-point node (JUMP_ZENITH/NADIR) is enemy-occupied and
   uncontested by a friendly vessel; with no jump points, imports always flow. Contesting
   any door with your own vessel reopens the lane. This ties the convoy/blockade war into
   the M7 SP economy without a full scheduled-convoy-arrival system (deferred).
5. **Still deferred** (table/GM or a later pass): cruise missiles, AA flak ceilings,
   FUMES gliding & dead-stick landings, automatic ace kill-tracking, the capturable ATO
   artifact, sentinel drones, passive arrays, water cracking, scheduled JumpShip convoy
   arrivals, hard-burn medical rolls, orbital fire support, and customs interception as a
   full scenario generator.

## D-015 ✅ GM time-travel (undo / rewind)
The event log is append-only on the normal play path (D-001), but running a real game
night needs an undo. `EventStore.truncate(n)` is the single sanctioned exception: keep the
first `n` events, drop the rest. `Campaign.rewind(n)` truncates then rebuilds truth by
replaying the surviving prefix; `Campaign.rewindOneStep()` rewinds to just before the last
`STEP_BEGAN`, undoing exactly one tick (press repeatedly to walk back through a
`runUntilEvent` jump). Because truth is a pure fold over the log, a rewind followed by
re-stepping reproduces the original forward state byte-for-byte — undo doesn't break
determinism or replay, it just shortens the log. The JSONL store rewrites its file, so the
rewind survives a restart. Undo cannot pass the tick-0 setup (genesis + initial net/scout
events stay). Loading a different campaign at runtime starts a fresh in-memory session and
is therefore *not* persisted unless the server was launched with `--log`.

## D-016 ✅ Operational scale: 18 km hexes, OMP in hexes/hour
Playtest feedback: at the original scale a single 1-hour PULSE step moved a unit OMP×10
hexes (the rulebook's "10 contact-turns per pulse"), so on any normal map units crossed
the whole board in one click — "teleporting." Rescaled the operational hex to **18 km**
(the high-altitude grid) and redefined **OMP as hexes per hour**: mech ≈ 3, vehicle ≈ 4,
hover/VTOL ≈ 8 (≈ 54/72/144 km/h). A PULSE step now covers OMP hexes (× `ROAD_BONUS` 1.5
on roads); a 6-min CONTACT turn covers OMP/10 hex, so units crawl ~3 turns per hex near
combat — fine-grained enough to watch them maneuver and for the route overlay to read.
Sensor / net / supply ranges stay in hex counts (each now 18 km), so those gameplay
relationships are unchanged. Movement also now interpolates between waypoints one hex at a
time (`hexLine`), so sparse authored paths or far-apart clicked waypoints no longer
teleport. The `m1` acceptance scenario keeps its scripted pace by carrying the old ×5
cross-country factor into the battalion's authored OMP (1 → 5); all other balance numbers
move to the new scale.

## D-017 ✅ Embedded card builder: record-sheet stats + in-app battle tracker
The OVERRIDE Card Builder is vendored under `cards/` (source + its bundled MegaMek library)
and integrated two ways; the coupling surface is three small bridge modules, so neither
codebase imports the other's internals beyond a couple of narrow contracts.
1. **Record sheets are the source of truth.** The card core runs unchanged in Node, so the
   campaign parses each unit's real `.mtf`/`.blk` (`src/roster/`: pure `derive.ts`, fs glue
   `library.ts`, policy `apply.ts`) and fills movement / class / BV / EW tags. Enrichment
   runs inside `buildCampaign` **before** `CAMPAIGN_INIT`, so it's replay-safe; it fills only
   unset fields (explicit wins, tags merge) and only writes fields the engines already read,
   so ECM/sensors/speed take effect on the map with no engine change. Equipment-grounded
   tags only — mission/role tags (RECON/DECOY/…) stay hand-authored.
2. **In-app battle tracker at `/battle`.** The campaign emits a compact roster (models +
   pilot skills + fog-of-war setup) that the tracker resolves against the library and loads
   as real Override cards with a briefing panel. The return leg posts a `BattleResult`
   (DESTROYED vs SALVAGE, ejected crews, survivor-inferred victor) to the same-origin ingest
   endpoint; ingest now refuses an already-`RESOLVED` engagement so it can't double-apply.
   `BattleResult.ejections[].pos` is optional — the tracker has no board coordinates, so the
   importer drops the crew at the battle hex.
3. **Setup stays one-command and cross-platform.** `npm run setup` / `update`, a `predev`
   hook that builds the tracker on demand, and a pure-Node zip fallback so the build needs
   only Node (no `unzip`/WSL on Windows). CI builds the tracker from a clean checkout.

*(Originally built on the Milestone-5 branch, then ported onto this M6 base — the additive
core compiled against M6's types unchanged; only the server routes, GM button, campaign-load
hook, and the double-ingest guard were re-wired.)*

## D-018 ✅ Aerospace: flight panel, fuel loop, and carrier ops
The tracker's play mode was ground/'Mech-centric; aerospace is now first-class end to end.
1. **Flight panel in the tracker.** Fighters/aerospace/DropShips get a ✈ panel tracking the
   state a merge actually turns on — fuel points with live joker/bingo (the handoff's
   thresholds ride onto `ForceUnit.entry`), velocity vs safe/max thrust, altitude, thrust
   used. Reuses the existing click→`u.damage`→`saveForce`/`syncTrackedDamage` pattern; heat/
   crits/condition were already handled by the generic handlers. Manual (non-handoff) forces
   seed fuel from the fighter card's own value.
2. **The fuel loop closes.** `battleResultFromForces` reports `fpRemaining` from the panel;
   the campaign's existing `UNIT_STATE_CHANGED` reducer writes it to `unit.fuel.fp` (and
   recomputes tons), so fuel that survives the merge comes home on the record sheet.
3. **Carrier ops (engine deepening).** A flight's home can be a DropShip
   (`Formation.air.homeCarrierId`), not just a fixed base: `homeAirHexOf` returns the
   carrier's current air hex (or the air hex over its theater on the ground), so RTB
   distance and joker/bingo track the carrier as it moves, and fall back when it's killed.
   Bounded on purpose — carrier rearm/turnaround (crews live on facilities) is left for later.

## D-019 ✅ Campaign generator (map + armies from the card library)
Instead of only editing the demo, the GM can generate a campaign in the editor.
1. **Coherent, seeded terrain** (`src/campaign/generate.ts`, pure): terrain is grown as
   blobs (woods/hills/water/rough/swamp/mountain) from random centers via frontier growth,
   plus a town or two joined by a greedy hex-path road — so a map reads like a place, not
   speckle. A local mulberry32 PRNG (seeded from a string hash) keeps it deterministic and
   testable; this is authoring-time randomness, deliberately NOT the campaign's logged RNG.
   `generateCampaign` emits the same JSON the editor/loader already validate.
2. **Armies from the library** (`src/roster/roll.ts`): `rollForce` pre-filters the index by
   category+era (cheap, no parse), seeded-shuffles, then derives candidates to apply exact
   class / weight (tonnage added to derivation) / BV filters. `campaignUnitsFromForce`
   converts a card-builder force export into unit specs, resolving class from the library.
   Both degrade to empty without a built library.
3. **Server + editor.** GM-gated endpoints `/api/gm/generate|roll-force|import-force|start`;
   `start` builds + launches a generated campaign object in memory (no file round-trip). The
   editor gains a Generate bar and an Armies bar (roll/import, placed at per-side spawn
   corners). Objectives/bases stay the GM's to paint — the generator does map + armies only.

## D-020 ✅ Physical DropShips: carry, launch/recover, carrier rearm
D-018.3 made a flight's *home* a carrier; this makes carriers physically haul and service
units, closing the "units in storage" story.
1. **Carriers carry.** `Formation.carrier { bays, crews, avFuelTons, crewBusyUntil }` marks a
   DropShip; an embarked formation keeps its existing `mounted.carrierFormationId`. A new
   `carrierPass` (`src/engine/carrier.ts`) runs in `tick.step` after movement/air/space and
   before the net pass: for each embarked formation it snaps position to the carrier via a new
   **`MOUNT_MOVED`** event (emitted only when the position actually changed — cheap for a
   parked carrier, and deliberately *not* an "interesting" event, so riding along never
   triggers clock compression). `movementPass`/`airPass`/`spaceMovementPass` skip
   `f.mounted`, so an embarked unit never self-moves. A destroyed carrier strands its cargo
   (`MOUNT_CHANGED null`) at its last hex rather than deleting it.
2. **Embark/disembark** (`Campaign.embark`/`disembark`): load a co-located friendly ground
   formation into a free bay; unload it into the carrier's hex or an adjacent one (an air
   release over a hostile hex is the existing `combatDrop`, not a disembark).
3. **Launch/recover** (`launchFromCarrier`/`recoverToCarrier`): launch pays takeoff (+climb
   from a landed carrier) and homes the flight on the carrier (`air.homeCarrierId`, D-018.3);
   recover requires the flight in the carrier's air hex (or over its theater when landed),
   pays the landing burn, and stows it in a bay.
4. **Carrier rearm** (`carrierRearm` + **`CARRIER_TURNAROUND_STARTED`**): the turnaround story
   without a ground facility — draws `avFuelTons` and ties up one of the carrier's `crews`
   (tracked in `crewBusyUntil`, mirroring a facility's `turnaroundCrews.busyUntil`) for
   `SKYWATCH.TURNAROUND_PULSES`, topping the flight's fuel/ammo when the crew finishes.
5. **Surfaces.** GM-gated endpoints `/api/gm/embark|disembark|launch|recover|carrier-rearm`;
   a GM "Carrier ops" panel with a live carrier board (bays, free crews, av fuel, who's
   aboard); authorable via `carrier` / `mountedOn` / `flight.homeCarrierId` in the campaign
   file. All actions go through the log — replay stays byte-exact.

## D-021 ✅ The career loop: pilot XP, the repair economy, salvage → roster
The engine tracked pilots, wounds, and salvage but they were dead ends; this closes them
into a light MekHQ-style persistence layer. All numbers in `rules.ts` CAREER.
1. **Pilot XP on ingest** (`PILOT_XP`): surviving crews in a BattleResult earn
   XP_SURVIVE (+XP_WIN when their side won, +XP_PER_KILL per kill in the optional
   `pilotOutcomes[].kills`); KIA/CAPTURED earn nothing. Every XP_PER_IMPROVEMENT (8) the
   *weaker* skill improves (the numerically higher of gunnery/piloting; gunnery on ties),
   floored at G1/P2 — computed in the reducer from the xp crossing, so replay is exact.
   ACE_KILLS (5) flips the existing `ace` flag.
2. **Wounds heal on the clock**: a WOUNDED outcome schedules `recoverAtTick`
   (WOUND_RECOVERY_DAYS), and the new `careerPass` (in tick, after maintenance) discharges
   the pilot to OK when it arrives.
3. **The repair economy** (`repairUnit` → `REPAIR_STARTED`/`REPAIR_COMPLETED`): a
   DAMAGED/CRIPPLED unit repairs when its formation shares a hex with a friendly
   REPAIR_FACILITY_TAGS facility (SP drawn immediately) or is embarked in a carrier with a
   free turnaround crew (the crew slot is tied up, mirroring carrier rearm). One step to
   OK; cost/time scale by state. Completion is anchored on `repairReadyTick`.
4. **Salvage closes both ways** (extending core §10.4): a UNIT recovery queues a
   `RefitProject` (`s.refits`, optional collection — old logs replay with `??=` guards);
   `startRefit` spends REFIT.SP at a repair-capable friendly facility and picks the
   delivery formation; careerPass completes it (`REFIT_COMPLETED`) — a **new unit id**
   (`unit:refit:*`) cloned from the wreck's stats under the recoverer's flag, crewed by
   the first POOL pilot of that side (deterministic id sort; SAR pickups feed the pool),
   named "<name> (salvage)". A PARTS result finally uses SALVAGE_FAIL_SP: credited to a
   friendly depot in the wreck's hex. The wreck's original unit record is never mutated —
   the enemy's dead stay dead; you field a rebuilt copy.
5. **Surfaces**: `/api/gm/repair`, `/api/gm/refit`; the GM "Company roster" panel (pilot
   careers with ★ aces and recovery timers, the shop with one-click repairs, the refit
   yard). Kills aren't auto-counted by the tracker yet — the result schema carries them
   optionally; the GM can also award via the log. Deliberately deferred: XP spend choices
   (players picking which skill), pilot death permanence options, refit customization.
6. **The hull masks the cargo** (follow-up ruling). An embarked formation is *inside* the
   carrier: it is not an independent sensor return (ground detection, same-hex auto-LOCK,
   satellite passes, air detection all skip `mounted` targets), it contributes no sensor
   picture of its own (skipped as a searcher — the carrier's sensors are the ship's), it
   cannot be air-intercepted in a bay, and it is sustained by the ship's stores (in supply,
   no SP draw, no starvation riding through transit). Launch is also gated on an in-progress
   carrier turnaround, mirroring the facility rule. Ground engagements still include
   co-located cargo in the battle roster on purpose — troops in a grounded DropShip under
   assault are part of that fight; the GM decides whether they sortie.
7. **Editor authoring** (follow-up): a `carrier` checkbox (bays/crews/av fuel) and an
   `embarked in` picker on the formation form — the picker lists only same-side, un-embarked
   carriers, and embarking snaps the formation to the ship's hex. The validator gains carrier
   checks (numeric ranges, unknown/self/cross-side/nested `mountedOn`, and bay overflow —
   counted once per carrier, not per stowed formation).

## D-022 ✅ Player carrier orders: EMBARK / DISEMBARK / LIFT_OFF / LAND
Carrier ops become plotted orders through the double-blind loop (players were GM-fiat-only).
1. **EMBARK** (ground kind, `targetFormationId` = the carrier): movementPass marches the
   formation toward the carrier's *live* position (re-pathed per step, like STRIKE — own
   force, always known) and loads on co-location when the carrier is landed with a free bay.
   A full or airborne carrier makes the column wait at the ramp; a bad target (not a
   carrier / wrong side / dead) fizzles the order cleanly.
2. **DISEMBARK** (`targetHex` optional, adjacent): handled in carrierPass — the only pass
   that runs for mounted formations — the moment the carrier is on the ground.
3. **LIFT_OFF** is a *standing* air order: tryLaunch gets the ship up (alert-board delay),
   then it holds ON_STATION indefinitely (`loiterTicksRemaining −1`), paying loiter on the
   ledger until the next order supersedes it. It never self-completes — "hold at altitude"
   is a state, not a task. The ON_STATION loiter branch now only holds when the ACTIVE
   order is the station-holder (LIFT_OFF or a `station` order), so a superseding order
   falls through to the movement machinery instead of loitering forever.
4. **LAND** (`targetHex`): fly to the theater's air hex, then put down on any *passable*
   hex — no facility required; water/impassable waves off (order completes, ship stays
   aloft). A friendly AIRSTRIP/SPACEPORT in the hex still earns the runway landing rate.
   From the ground, LAND doubles as ship repositioning (lift → fly → land). **LAND outranks
   RTB in destAirHex** — found in testing: a bingo-forced RTB used to swallow the LAND
   order (completing it as a no-op), meaning a fuel-starved ship refused the one order that
   could save it. AIR_LANDED's `facilityId` becomes optional for open-field landings.
5. **Scramble from the bay**: a stowed flight (mounted, isFlight) holding any active air
   mission launches itself off the deck — mount cleared, homed on the carrier
   (`homeCarrierId`), out at the carrier's air position or climbing off its back on the
   ground. Mirrors tryLaunch's gates (turnaround in progress, fatigue-grounded crews,
   blind intercept plots all hold it).
6. **Surfaces**: order kinds in the player screen's order entry (carrier picker for EMBARK,
   last map click as the hex for LAND/DISEMBARK); projection exposes own `carrier` (bays,
   crews, av fuel, who's aboard) and `mountedOn` on OwnFormationView; the side-order API
   forwards `targetFormationId`/`targetHex`; schema ORDER_KINDS extended. Net rules apply
   unchanged — an off-net DropShip can only be reached by standing orders/conditionals.

## D-023 ✅ Closing the sky: DESCEND / ASCEND and carrier auto-recovery
DEEP SKY and SKYWATCH were complete but disconnected — a DropShip at a planet node could
not enter the planet's air layer. Two orders bridge the seam (constants in `rules.ts` ATMO).
1. **DESCEND** (space kind): at a node whose `SysNode.theaterId` embeds a theater (the field
   existed since M4 for exactly this), the re-entry takes DESCENT_TICKS anchored on a new
   `space.atmoEndTick` (step-size-proof) and a modest DESCENT_FP braking burn — the
   atmosphere does the work. Arrival (`ATMO_TRANSIT`, an interesting event) puts the vessel
   in the theater's air hex, HIGH band, phase ENROUTE — a thrusting DropShip, bright on
   every radar screen. A node with no theater fizzles the order. Handled in a `descentPass`
   inside spacePass; mounted cargo rides through via the carry pass unchanged.
2. **ASCEND** (air kind, so tryLaunch lifts a grounded ship first): climbs ASCENT_TICKS and
   pays ASCENT_FP — deliberately the expensive direction. Destination:
   `order.destinationNodeId`, else the node embedding the theater whose air hex the ship
   occupies, else the first theater-bearing node (deterministic sort); no candidate ⇒
   fizzle. Arrival swaps the ship onto the system map (air phase parks at GROUNDED).
3. **Carrier auto-recovery**: an RTB (or orderless) carrier-based flight arriving at its
   home carrier now lands and stows itself — landing burn, phase GROUNDED, mount set,
   position snapped — when a bay is free; bays full ⇒ wave-off, holding over the ship.
   Checked before the home-facility fallback in flyStep's arrival branch. Launch was
   already player-plottable (D-022.5); recovery no longer needs the GM at all.
4. **Deliberately deferred**: the orbit-climb gauntlet (interception during ascent — the
   ascending ship is simply visible in the air layer for the duration), aerobrake piloting
   rolls, and per-node descent restrictions. The acceptance test plays the whole story on
   plotted orders alone: DESCEND → LAND → DISEMBARK → fighter CAP off the deck →
   auto-recover → ASCEND, byte-exact on replay.

## D-024 ✅ Flak: the AA gauntlet at the interface points
The 'AA' unit tag (documented since M1, read by nothing) becomes the counterplay to air
mobility. Design constraint: the air layer is one hex per theater, so ground AA cannot
plausibly engage HIGH-band transit — and shouldn't (that's what makes the band safe).
Instead it bites where aircraft come LOW over a specific ground hex. Constants in FLAK.
1. **The umbrella**: any enemy formation with a live AA-tagged unit within RANGE_HEXES (2)
   of the interface hex fires once — one logged 2d6 per battery, TN 8. Mounted (bay-stowed)
   batteries are silent; friendly ones obviously don't fire.
2. **A hit degrades one damage step** (OK→DAMAGED→CRIPPLED, deterministic first-live-unit
   pick). Flak batters; it never destroys outright — killing a DropShip full of troops with
   one campaign-layer roll would bypass the "battles happen on the table" law.
3. **Shoot and be seen** (the counter-battery bargain, core §9.2): every shot reveals the
   battery at CONTACT (`setLevel`) to the aircraft's side, sourced from the aircrew so
   report delivery follows their net status. An AA umbrella is a sprung trap, not a wall.
4. **Interface points wired**: climb-out (facility launches and deck scrambles off a
   grounded carrier), final approach (LAND on any hex, RTB facility landings, carrier
   recovery when the ship is on the ground), and the combat-drop pass — which also adds
   DROP_SCATTER_EXTRA (+2) hexes of scatter, rolled after the drop dice so the penalty is
   dice-stable. Air-side interfaces (mid-air deck launches/recoveries, DESCEND/ASCEND
   arrivals at HIGH) are deliberately out of reach.
5. Own AA gear shows in the player's gear line ('anti-air (flak umbrella)'); enemy
   umbrellas stay invisible until they fire — double-blind holds.
