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

## D-006 ❓ OPEN — M1 acceptance test TN-12 cannot be assembled from Module 0 tables as written
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
