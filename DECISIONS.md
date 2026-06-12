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
