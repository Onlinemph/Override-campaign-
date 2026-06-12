# Milestone 1 Proposal — Repo Structure & Test List
*For GM approval before implementation code is written.*

## 1. Proposed repository structure

```
.
├── docs/                                # the four requirement documents (committed, authoritative)
│   ├── BattleTech_OVERRIDE_Campaign_Rules.md      (Module 0 — core)
│   ├── OVERRIDE_Module1_SKYWATCH_Aerospace.md     (Module 1)
│   ├── OVERRIDE_Module2_DEEPSKY_System_War.md     (Module 2)
│   └── OVERRIDE_GM_Tool_Spec.md                   (schema & architecture)
├── DECISIONS.md                         # judgment calls / ambiguities / deviations
├── package.json · tsconfig.json · vitest.config.ts
│
├── src/
│   ├── rules.ts                         # EVERY game constant, three sections mirroring the
│   │                                    #   three rulebooks' quick-reference appendices.
│   │                                    #   No formulas with magic numbers anywhere else.
│   ├── core/                            # ——— event-sourced kernel (spec §0–§2) ———
│   │   ├── types.ts                     #   spec §1–2 schemas, transcribed verbatim
│   │   ├── rng.ts                       #   (campaignSeed, eventIndex) → roll; DieRoll log
│   │   ├── events.ts                    #   GameEvent discriminated union + applyEvent reducer
│   │   ├── log.ts                       #   append-only store (JSONL; interface allows SQLite)
│   │   └── truth.ts                     #   TruthState = fold(events); replay
│   ├── hex/
│   │   └── axial.ts                     # distance, neighbors, lines, LOS blocking, ranges
│   ├── engine/                          # ——— the tick engine (spec §3) ———
│   │   ├── clock.ts                     #   tick math, chooseClockMode, compression
│   │   ├── tick.ts                      #   §3.1 loop — pure: (truth, orders, rng) → events
│   │   ├── movement.ts                  #   M1: ground contact/pulse movement
│   │   ├── detection.ts                 #   §3.2: TN assembly, ladder, fade, reciprocity, ECM haze
│   │   └── net.ts                       #   §3.3: on-net predicate, report queue, delayed delivery
│   ├── projection/
│   │   ├── viewTypes.ts                 #   ViewState — player-safe shapes only
│   │   └── project.ts                   #   pure project(truth, sideId, now); spec §4 table exactly
│   ├── server/                          # node:http + ws; GM endpoint + per-side endpoints
│   └── ui/                              # static, plain. M1: GM truth+views+log, player JSON views
│
├── demo/
│   └── campaign.json                    # seeded demo fixture (grows each milestone:
│                                        #   two sides, satellite, airbase, convoy, hidden objective)
└── test/
    ├── rules/module0-tables.test.ts     # Appendix A of core rules vs rules.ts, row by row
    ├── core/rng.test.ts · log.test.ts · truth.test.ts
    ├── hex/axial.test.ts
    ├── engine/clock.test.ts · movement.test.ts · detection.test.ts · net.test.ts
    ├── projection/project.test.ts       # incl. leak tests
    └── acceptance/m1-hidden-battalion.test.ts
```

Growth path (no restructuring needed later):
- **M2** adds `engine/orders.ts`, `engine/engagement.ts`, `src/handoff/{export,import}.ts`, `test/rules/` rows for evasion/RDY.
- **M3** adds `engine/fuel.ts`, `engine/ato.ts`, `engine/chase.ts`, `test/rules/module1-tables.test.ts`, `acceptance/m3-shilone-day.test.ts`.
- **M4** adds `engine/space/{graph,brachistochrone,classifier,jump}.ts`, `test/rules/module2-tables.test.ts`, `acceptance/m4-operation-skean.test.ts`.
- **M5** adds map UIs (hex canvas + system graph), noise-injection editor, MegaMek export, audit viewer.

**Dependencies (deliberately minimal):** `typescript`, `vitest`, `ws`. Everything else is
node built-ins. Persistence = JSONL (DECISIONS.md D-001), hex math hand-rolled (D-003).

**Architecture invariants** (enforced by tests, not convention):
1. Truth mutates only via `applyEvent`; the tick engine *emits events*, never touches state.
2. Every die roll goes through the logged RNG; `seedCursor` stored; full-log replay
   reproduces identical truth byte-for-byte.
3. `project()` is pure, never persisted, and is the *only* code path player data leaves through.
4. Every number from the quick-reference appendices lives in `rules.ts` and nowhere else.

## 2. Milestone 1 test list

### Group A — rules.ts vs Module 0 quick-reference (table tests)
| # | Test | Source |
|---|---|---|
| A1 | Clock constants: contact turn 6 min, pulse = 10 ticks, watch = 60, day = 240 | spec §1.1 / core §2 |
| A2 | Base SIG by size: Bn/DropShip 5 · Co 6 · Lance 7 · single 9 · squad 10 | core 3.1 |
| A3 | Target SIG mods: moving −1 · forced-march/sprint −2 · jump −2 · fired −3 · Hide +2 · dug-in +1 · night +2 (visual) · Guardian +1 / Angel +2 · stealth +2 · rain +1 · DARK +2 · ACTIVE −2 · woods/swamp +1 · urban +2 (inf +3) · road −1 | core 6.1/6.3, 5.2 |
| A4 | Searcher mods: ACTIVE +2 · Patrol +1 | core 6.3 |
| A5 | Sensor ranges, all rows passive/active ('Mech 2/4 … Sensor Station 6/12, recon corridor 5-wide, satellite track 10-wide, eyeball 3/1-at-night) | core 6.2 |
| A6 | Terrain: OMP costs (clear 1, woods 2, … mountain 3 'Mech/inf-only, road ½ min 1), wheeled ×2 off-road, hover free water/swamp & no mountains, detection effects per terrain | core 5.2, 5.1 |
| A7 | Movement: OMP = slowest walk/cruise · pulse ×10 road / ×5 cross-country · forced march ×1.5 with RDY −1 · sprint 1 turn in 3 at SIG −2 · VTOL ×2 · towed/support OMP 2 | core 2.3, 3.3, 5.1 |
| A8 | Contact ladder: +1 level per success (cap 4 = LOCK) · −1 per pulse without redetect · same-hex / post-battle auto-LOCK | core 6.4 |
| A9 | Net: radius 12 ground node / 24 DropShip-base / theater-wide with comm sat · re-net 1 pulse · DARK ⇒ off-net · ECM bubble cuts net | core 4.2 |
| A10 | Remaining Appendix-A rows parked in rules.ts now and asserted now (used by later milestones): artillery ranges 8/18/21/30 & cruise 50–120 · RDY bands (7–5:+1, 4–2:+2 & 8+ to attack, 1–0 rout) · SP & supply-line constants · VP values | core App. A |

### Group B — kernel unit tests
| # | Test |
|---|---|
| B1 | **RNG:** same (seed, cursor) ⇒ same roll, always · 2d6 ∈ [2,12] with sane distribution · every roll appended to log with purpose + seedCursor · cursor strictly monotonic |
| B2 | **Event log:** append-only (no update/delete API) · JSONL round-trip · `truth = fold(events)` · full replay of a recorded session reproduces identical truth (deep-equal) |
| B3 | **Hex:** axial distance/neighbors/lines · range queries · ground LOS blocked by hills/mountain/urban |
| B4 | **Clock mode:** CONTACT iff a cross-side pair ≤ 5 op-hexes apart *and* ≥1 side holds ladder ≥1 on the other · PULSE if active ground ops · else WATCH · compression: no-event ticks emit nothing and produce no per-side diff |
| B5 | **Movement:** per-terrain OMP spend hex-by-hex in contact time · pulse-scale road/cross-country rates · formation moves at slowest element · path following with illegal-hex rejection (water vs ground, mountain vs wheeled) |
| B6 | **Detection TN assembly:** parameterized matrix of (size × posture × terrain × EMCON × weather × motion) ⇒ expected TN, every case cross-checked by hand against core 6.3 · range gating per sensor row · ACTIVE reciprocity (searcher SIG −2 that tick) · ECM haze pseudo-contact for ACTIVE searchers · fired-this-turn −3 · artillery fire ⇒ auto-CONTACT of firing hex |
| B7 | **Contact lifecycle:** ladder climbs on success, fades per pulse · GHOST position error ±1 hex (seeded, deterministic) · per-level fields populated exactly per spec §4 (SHADOW adds vector+size; CONTACT adds composition; LOCK adds TO&E/damage/EMCON) |
| B8 | **Net & reports:** on-net contact ⇒ report delivered next tick · off-net ⇒ `deliveredTick = null`, held · re-enter net ⇒ delivered, `generatedTick` preserved (staleness visible) · scout destroyed before return ⇒ report never delivers (counter-intel) · command node destroyed ⇒ dependents off-net, re-net 1 pulse each |
| B9 | **Projection (leak tests):** spec §4 table field-exact per level · GHOST never reveals true position beyond ±1 · enemy formations absent below GHOST · hidden & fake objectives invisible until discovered · undelivered reports invisible · RNG/seed never present in any ViewState · own side always fully visible · `project()` mutates nothing and is never written to the log |

### Group C — the M1 acceptance scenario (`acceptance/m1-hidden-battalion.test.ts`)
Scripted, seeded, deterministic, two sides on one theater:
1. **The crossing:** attacker battalion, concealed + EMCON DARK, moves through woods at
   night across the defender's fixed-sensor line. Assert the engine-computed TN = **12**
   (exact modifier decomposition pending **D-006** — see open questions) and that across
   the full crossing, with the campaign seed's logged rolls, **zero** contacts are created.
   The "effectively invisible" criterion: P(2d6 ≥ 12) ≈ 2.8%/roll.
2. **Negative control:** same battalion re-run PASSIVE, daylight, clear terrain ⇒ detected
   within a few pulses (proves the engine detects when it should).
3. **The scout:** a defender recon element closes to visual range, earns GHOST→SHADOW on
   the battalion, but is beyond net radius. Assert: report generated, `deliveredTick`
   null; defender ViewState shows **nothing**.
4. **Return to net:** scout re-enters the 12-hex command radius ⇒ report delivers; defender
   view now shows a SHADOW contact whose `staleAsOfTick`/`generatedTick` is the original
   detection time, not delivery time.
5. **Counter-intel branch (same fixture, alternate timeline):** the scout is destroyed
   before returning ⇒ the report never delivers and the defender view stays empty.
6. **Audit:** replaying the event log from the seed reproduces the entire scenario
   identically, including every DieRoll's seedCursor.

### Open questions blocking only the exact assertions of C1 (see DECISIONS.md D-006)
The spec's TN 12 = "5+2+1+2+2" cannot be assembled from the Module 0 tables as written:
the named conditions (battalion 5, DARK +2, woods +1, night +2) sum to 10; Hide (+2) is
defined as stationary-only; night is "+2 *vs visual only*" and a sensor station isn't
visual; and moving −1 is unapplied (as it also is in the core book's own §6.5 worked
example). Recommended resolution **(a)**: a cautious-movement posture grants the Hide +2
(at half pulse speed, suppressing moving −1), and night +2 applies to all passive
sensors. All five numbers remain independent rules.ts constants either way.
