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
