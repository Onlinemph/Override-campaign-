# OVERRIDE — A Tutorial for the Complete Newcomer

This guide assumes you know **nothing** — not BattleTech, not "double-blind," not the
tool. By the end you'll understand what this is, the handful of ideas it runs on, and
how to actually play a session. Read it start to finish; it's written to be read in order.

---

## 1. What is this, in one breath?

BattleTech is a tabletop game where players fight battles with giant stomping war-machines
(**'Mechs**) using miniatures, maps, and dice. A single battle is one afternoon. A **campaign**
is many battles strung together into a war — with territory, supply lines, scouting, and
consequences that carry from one fight to the next.

**OVERRIDE is the campaign layer**, run by one person called the **GameMaster (GM)**. It is
played *double-blind*: each side only sees what its own scouts and sensors have actually
discovered. You don't get a god's-eye view of the map. You get an *intelligence picture* —
often incomplete, sometimes hours out of date, occasionally wrong. Deciding **which battles
happen, where, and with what surprise** is the whole game. When two forces finally collide,
OVERRIDE hands you a setup and you go fight that battle on a real tabletop.

This software is the GM's tool for running all of that: it keeps the true map, rolls the
hidden dice, decides who sees whom, and shows each player only their slice of reality.

> **The single most important rule:** the tool **never simulates a battle**. When forces
> meet, it tells you *how* to set the fight up on the table; you play it out with real rules
> and dice; then you type the outcome back in. The tool runs the *war between the battles*.

---

## 2. The five ideas everything is built on

You only need these five to follow along.

**1. There is one Truth, and nobody but the GM sees it.** The GM's screen shows the real
map: every unit, real positions, real plans. Each *player* sees a separate, filtered view —
only their own forces plus whatever they've detected of the enemy.

**2. The clock skips boredom.** Time advances in **ticks** (6 minutes each), but the tool
fast-forwards through quiet stretches and only stops when *something happens to someone* —
a new sighting, a report arriving, two forces meeting. You'll experience it as "0600… 1100,
**new contact report**," exactly like a real command staff. There are three speeds it shifts
between automatically: **Watch** (6 hours, for quiet system travel), **Pulse** (1 hour, for
ground operations), and **Contact Turn** (6 minutes, when enemies are close).

**3. Detecting the enemy is a ladder, not a switch.** What you know about an enemy force
climbs through four rungs as your sensors work on it:

| Rung | Name | What you see on your map |
|---|---|---|
| 1 | **GHOST** | "Something is here" — a fuzzy blip, ±1 hex, no details |
| 2 | **SHADOW** | Its size and which way it's heading |
| 3 | **CONTACT** | What it's made of ("4 heavy 'Mechs, ~6 vehicles") |
| 4 | **LOCK** | Everything: full roster, damage, posture — and you can target it cleanly |

Stop watching a contact and it **fades** back down the ladder, aging into a stale "last seen
here" ghost. A blip on your map might be four hours old.

**4. Information travels at the speed of your couriers.** A scout that spots the enemy while
out of radio range (off the **command net**) can't tell you until it gets back. Kill that
scout first and the report dies with it. In space, even light is slow — a jump flash 10 AU
away is seen **83 minutes later**, so the deep-space map shows you light-cones, not truths.

**5. Everything is logged and replayable.** Every die roll is recorded with the seed that
produced it. After the campaign, the GM can replay the entire war with the fog lifted and
see exactly how every surprise was earned. No fudging — that's the deal that makes
double-blind trust work.

---

## 3. The pieces on the board

A quick vocabulary of what you'll be moving around:

- **Side** — a player (or team). The demo has *blue* (defenders) and *red* (attackers).
- **Formation** — your basic counter: a lance/company of 'Mechs, an armor platoon, a flight
  of fighters, a DropShip. You push *formations*, not individual 'Mechs, around the map.
  Each has a **signature** (how hard it is to detect), **sensors**, and a **readiness (RDY)**
  gauge (0–10) that drops when it fights, force-marches, or runs out of supply.
- **Facility** — an airbase, depot, sensor station, or spaceport sitting on the map.
- **The command net** — your radio web. A formation near a friendly command node is
  *on-net*: orders reach it instantly and its reports come back live. Out of net, it runs on
  its last orders and goes quiet.
- **Supply (SP)** — formations eat Supply Points daily, drawn from depots along a **supply
  line** (a path of friendly hexes). Cut the line and the cut-off force starves: its RDY
  bleeds away. Trucking SP forward and raiding the enemy's lines is a whole front of the war.
- **Victory Points (VP)** — you win by holding **objectives** (a spaceport, a city, a jump
  point) that pay VP each day, racing to a threshold or being ahead when time runs out.
- **EMCON** — your emissions posture: **DARK** (silent, hard to find, but off-net),
  **PASSIVE** (normal), or **ACTIVE** (radar blazing — you see far, and everyone sees *you*).

If a term ever stops you, jump to the **Glossary** at the end.

---

## 4. Getting it running

You need [Node.js](https://nodejs.org) (version 18+). In a terminal, from the project folder:

```sh
npm install      # one time: fetch dependencies
npm run dev      # start the tool with the built-in demo campaign
```

You'll see it print a GM link and one **player link per side**, like:

```
OVERRIDE GM Tool — http://localhost:8420/gm
  Cavanaugh Defense Force: http://localhost:8420/player/blue/yahv34xqjpiz1cart1cr
  3rd Sword of Light (elements): http://localhost:8420/player/red/las9vehpl9g5hzmt37nb
```

- Open the **/gm** link yourself — that's the GameMaster's console (it shows the truth).
- **Hand each player their own link.** The long code is a token so one player can't peek at
  the other's screen. (Same network / same room is the assumption — this isn't built for the
  public internet.)

For a real campaign you'd run `npm run dev -- demo/campaign.json --log mywar.jsonl` so the
game is saved to a file and survives closing the program. Everything below works either way.

---

## 5. The three screens

**The GM screen (`/gm`)** — your reality. The big map shows *both* sides' real positions.
Up top: the clock, each side's VP, and two buttons — **Step** (advance the minimum) and
**Run until event** (fast-forward until something interesting happens). You also get the
**event log** (every roll and report), tools to inject false reports, a panel of special
actions (combat drops, rescues), and — when a battle is about to happen — the engagement
controls. There's a "belief overlay" dropdown that superimposes *what a chosen side has been
told* onto the truth, so you can see the gap you're running.

**A player screen (`/player/<side>/<token>`)** — that side's fog-of-war view. Their own
forces (with fuel, readiness, supply), their **contacts** (those G/S/C/L blips with how stale
each one is), a **report inbox** of incoming intel, and an **order-entry** form. On the map,
players **click hexes to plot a movement path**, then issue the order.

**The audit viewer (`/audit`)** — for *after* the campaign: a scrub bar that replays the whole
war with all fog lifted. The victory lap.

(There's also `/editor` for *building* your own campaign — covered in section 9.)

---

## 6. Your first session, step by step

Play this solo first: open `/gm` in one browser tab and the two player links in two more.
Watch how the same moment looks different in each.

**Step 1 — Look at the asymmetry.** On `/gm` you can see blue and red both. Switch to the
*red* player tab: red sees its own forces and maybe a vague GHOST or two — not blue's army.
That gap is the entire point.

**Step 2 — Advance time.** On `/gm`, click **Run until event** a few times. The clock jumps
forward and stops when something happens. Watch the event log fill in. Soon a satellite pass
or a sensor station will catch one of red's moving formations, and a **report** will appear
in blue's inbox: *"GHOST, hex 21,8."* Blue now knows *something* is out there — not what.

**Step 3 — Give an order.** As the blue player: pick a formation in the order panel, choose
a **kind** (start with `MOVE`), then **click hexes on the map** to draw its route — you'll
see the path highlighted. Click **Issue order**. Back on `/gm`, **Run until event** again and
watch that formation travel its plotted path. (Try a scout on `PATROL` or `MOVE_CAUTIOUS` —
cautious movement stays hidden but moves at half speed.)

**Step 4 — Climb the ladder.** Keep advancing. As blue's scouts work on that red contact, it
climbs GHOST → SHADOW → CONTACT, and the map blip sharpens from a fuzzy diamond to a labeled
one. If blue loses track, watch it fade and go stale.

**Step 5 — The battle.** Eventually two opposing formations end up in the same hex (or a scout
springs an ambush). The campaign **freezes** and a red **"Pending engagement"** banner appears
on `/gm`. This is the handoff. You have choices:

  1. **Evade** — the defender can try to slip away (click *Resolve evasion*; the tool rolls).
  2. **Fight** — click **Export handoff**. The tool produces a setup sheet: which map, which
     edges each side enters from, who deploys first, who has the initiative edge, each unit's
     condition and ammo. Download the `.mul` files if you use MegaMek.
  3. **Now go play that battle** on an actual BattleTech (or Alpha Strike, or quick-roll)
     table, with the setup the tool gave you.
  4. **Enter the result.** The handoff gave you a `BattleResult` template (a bit of JSON) in
     the banner. Fill in who won, each unit's final damage, any ejected pilots, who withdrew
     which way — and click **Ingest BattleResult**. The campaign unfreezes: damage is applied,
     salvage and downed-crew markers appear, the loser may rout, and both sides now hold a
     **LOCK** on each other (they just met). Pursuit can begin.

**Step 6 — Win.** Holding objectives scores VP each day. When a side reaches the campaign's
VP threshold (25 in the demo), the tool declares the winner and freezes — and you can open
`/audit` to replay the whole thing with nothing hidden.

That loop — *advance → reports arrive → issue orders → forces meet → hand off the battle →
ingest the result → advance* — **is the game.**

---

## 7. The GM's job (and why the tool helps)

The GM is the fog itself: running both sides' orders simultaneously, rolling detection in
secret, narrating contact reports in-character, and adjudicating the odd edge case. The tool
carries the bookkeeping so you can focus on the drama. A few GM powers worth knowing:

- **Noise injection.** You can hand-edit a report before it's delivered (storm static
  garbling a count) or conjure a phantom contact (migrating fauna, a feint). Use it sparingly
  and cruelly — uncertainty is the GM's only weapon, and it must stay *fair* (every nasty
  surprise should have been earned).
- **Special actions** (the combined-arms panel): order a **combat drop** (DropShip releases
  troops onto a hex, with scatter), a **SAR** pickup of a downed crew, a **tanker** fuel
  transfer, or a customs **inspection** of a suspicious "merchant."
- **Air & space**: set fighter **alert states** and run **turnarounds** at airbases; the
  deep-space layer tracks fuel-by-the-day, jump-drive charging, and blockades.

You don't have to use any of the advanced systems. A pure ground campaign with scouts,
ambushes, and supply lines is a complete game on its own.

---

## 8. Cheat-sheet: the turn rhythm

```
GM:      Run until event  ───────────────►  the clock stops on something
                                            (a report, an arrival, a meeting)
Players: read the inbox, eyeball the map, plot orders ──► Issue order
GM:      Run until event again
   …repeat until two forces meet…
GM:      Pending engagement → (Evade?) → Export handoff
HUMANS:  fight that battle on a real tabletop
GM:      Ingest BattleResult → the war continues
   …until someone hits the VP threshold or time runs out…
GM:      open /audit and replay the whole war, fog lifted
```

---

## 9. Going further: build your own campaign

When you want your own war, you have two paths:

- **Visual editor (`/editor`)** — paint terrain on a hex map, drop in forces and bases, place
  objectives, set the victory conditions, and (in the *System* view) draw the jump-point
  network for a space campaign. It checks your work as you go and lets you download a
  ready-to-play file.
- **By hand** — a campaign is one JSON text file; copy `demo/campaign.json` and edit it. Every
  field is documented in **[CAMPAIGN_FORMAT.md](CAMPAIGN_FORMAT.md)**. The tool validates it on
  load and explains any mistake in plain words.

Run yours with `npm run dev -- yourfile.json --log yourwar.jsonl`.

---

## 10. Glossary

- **'Mech / BattleMech** — a giant humanoid war machine; the star of BattleTech.
- **Tick / Pulse / Watch / Contact Turn** — units of game time (6 min / 1 hr / 6 hr; Contact
  Turn = the 6-min tick used when enemies are near).
- **Formation** — a counter you move: a group of units acting as one (lance, company, flight…).
- **Side** — a player or team (blue, red…).
- **Contact** — your knowledge of an enemy force, rated GHOST → SHADOW → CONTACT → LOCK.
- **Fade / staleness** — a contact decaying when you stop watching it; how old your info is.
- **Command net / on-net / off-net** — your radio web; on-net units get live orders & reports.
- **EMCON: DARK / PASSIVE / ACTIVE** — emissions posture (silent / normal / radar-blazing).
- **RDY (Readiness)** — a formation's fight-fitness, 0–10; falls from battle, marching, hunger.
- **SP (Supply Points) / supply line / depot / convoy** — the logistics that keep units fed.
- **Objective / VP (Victory Points)** — map prizes that score points; how you win.
- **Handoff / BattleResult** — the export that sets up a tabletop fight, and the form you enter
  its outcome back through.
- **Engagement** — the moment forces meet and the campaign pauses for a tabletop battle.
- **Evasion** — a defender's attempt to slip away before a battle starts.
- **DropShip / JumpShip / WarShip** — spacecraft; JumpShips make the interstellar jumps,
  DropShips carry troops down to planets, WarShips are the heavy navy.
- **Jump point / pirate point** — where ships arrive in a star system (pirate points are
  secret, risky shortcuts).
- **AU / light lag** — astronomical unit (Sun–Earth distance); in space, what you see is
  delayed by distance (≈8.3 minutes per AU).
- **The Merge** — BattleTech slang for the moment fighters meet and the dogfight begins.

---

*Welcome to operational command. The map is not the territory — the territory is what your
sensors say it is, until a PPC says otherwise.*
