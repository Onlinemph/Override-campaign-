# OVERRIDE GM Tool

A double-blind campaign manager for tabletop BattleTech, run by a human GameMaster.
Implements the **OVERRIDE** campaign rules (Module 0), with **SKYWATCH** (Module 1) and
**DEEP SKY** (Module 2) to follow. The four documents in `docs/` are the complete
requirements; `DECISIONS.md` logs every judgment call.

## Architecture (spec §0)

Event-sourced fog-of-war engine:

- **One Truth State**, mutated only by an append-only **event log**
  (`src/core/events.ts`, JSONL store in `src/core/log.ts`).
- **Seeded, logged RNG**: every die is a pure function of `(campaignSeed, seedCursor)`;
  every roll is logged with its cursor and is independently re-derivable (`src/core/rng.ts`).
- **Player views are pure projections** — `project(truth, sideId, now)` in
  `src/projection/project.ts`; never persisted, structurally unable to leak unearned info.
- **Every game constant** lives in `src/rules.ts`, organized to mirror the rulebooks'
  quick-reference appendices. House-rule numbers there; the engine has no magic numbers.
- **Battles are never simulated**: the engine exports a HandoffPackage and ingests a
  BattleResult (forms land in Milestone 2).

## Run it

```sh
npm install
npm run dev      # loads demo/campaign.json
```

Then open:
- `http://localhost:8420/gm` — GM screen: truth, all side views, event log,
  step / run-until-event, report (noise) injection.
- `http://localhost:8420/player/blue` and `/player/red` — player screens: own forces,
  contacts with staleness timestamps, report inbox, order entry.

The demo theater ships with a satellite (watch its scheduled passes catch GHOST returns),
an airbase, a supply convoy, a hidden objective, and a red probe force already moving.
Click **Run until event** a few times.

## Test

```sh
npm test         # 115 tests incl. the Milestone 1 acceptance scenario
npm run typecheck
```

The Milestone 1 acceptance test (`test/acceptance/m1-hidden-battalion.test.ts`) plays
the spec's scripted scenario: a battalion (EMCON DARK, woods, night, cautious movement)
crosses a sensor line at TN 12 — effectively invisible, every silent roll logged — and
the defender's off-net scout's contact report delivers only when the scout physically
returns to the command net, original timestamp preserved.

## Milestones

- [x] **M1 — Kernel**: entities, event log, seeded RNG, tick loop with clock compression,
      Module-0 ground movement + detection + contact ladder + per-side views.
- [x] **M2 — Orders & engagement**: conditional triggers, STRIKE/SCREEN, evasion,
      engagement freeze, HandoffPackage export / BattleResult import round-trip, salvage,
      rout, RDY/Dig-In/supply upkeep. GM resolves battles from the GM screen; the demo
      drives itself to an engagement on *Run until event*.
- [x] **M3 — SKYWATCH**: flight ledger engine, alert board (launch delays, idle burn,
      crew fatigue), plotted air missions with conditional scrambles, predictive chase
      mode in contact turns, live joker/bingo with auto-RTB at bingo, the merge export
      (map by band, entry velocity, Energy State, surprise, per-fighter FP/joker/bingo),
      turnaround & fuel farms. *Acceptance passed: the §12 Shilone day tick-for-tick —
      400→240→179→159 FP, the 0901 scramble, the farm down to 11 tons, Fatigue 3.*
- [ ] **M4 — DEEP SKY**: system graph, brachistochrone solver, burn-day ledgers,
      light-lag staleness, encounter classifier, jump board.
      *Acceptance: Operation SKEAN incl. 83-min light lag and MATCHED intercept.*
- [ ] **M5 — Polish**: map UIs, noise-injection editor, MegaMek export, audit viewer.

*Fan project; BattleTech © The Topps Company, Inc., published by Catalyst Game Labs.*
