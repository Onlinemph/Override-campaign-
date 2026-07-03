# OPERATION DAGGERPOINT — Menghao, 3067

The showcase campaign: a full planetary assault that touches **every mechanic in the
engine** — now at continental scale. The 1st Kittery Borderers (AFFS) jump into a
Capellan border system to take Menghao's spaceport, capital, and factory district from
the Prefectorate Guard before the month is out. The Jiangxi continent is **80×50 hexes
(1,440 × 900 km)**: distance is the terrain now, and the rail line across it is worth
more than any single lance.

```sh
npm run dev -- demo/assault.json --log daggerpoint.jsonl --gm-key YOUR-SECRET
```

Two players (or one per lance if your table is big), one GM. Battles on the physical
table as always — the campaign feeds them and eats their results.

## The map, in one paragraph

Liao's built-up west sits strung along the **trans-Jiangxi mainline**: Port Menghao
spaceport (10,26) → the capital Xin Chengdu (14,26) → the Jiangxi Works factory (18,26),
with Chiang Airfield north at (13,18) and the Prefecture Depot south at (11,30). The
rail runs **52 hexes east to the Hengshan railhead (62,26)** — a battalion rides it at
12 hexes/hour, four times march speed. **Northwatch Station (36,14)** paints the
northern and central skies out to 24 air hexes; the spaceport's own radar covers the
west; **the southern badlands are outside every horizon** — the gap. In the far
northeast a "radar site" (64,12) radiates invitingly (it's inflatable decoys), and
somewhere in the southern woods sits a hidden supply cache.

## The situation

**Davion (attacker)** — a task force at the zenith point, just jumped in: the JumpShip
*Excalibur's Word* (sail deployed, charging), the Overlord *Fortune's Hammer* (command
lance, cavalry lance, artillery, AA — 4 bays), the Union *Halberd* (armor, recon, the
trains, engineers), the Leopard CV *Swift Wing* (two fighter flights in the bays), and —
running dark from the **nadir** under a merchant squawk — the *Kestrel*, with a battle
armor squad aboard. **No resupply is coming: the trains carry 20 SP and after that it's
the spaceport or starvation.**

**Liao (defender)** — the Menghao Prefectorate Guard: a mech company (including a Raven
3L screening the railhead approaches and two stealth Sha Yus lying HIDE near Hengshan),
Po armor, dug-in flak at the spaceport and airfield, a Long Tom by the capital,
minefields on the mainline east of the factory, infantry in the works, a fighter flight
on ALERT-15, a grounded Union with two more fighters stowed, a recon satellite sweeping
the mainline corridor, a picket skimming fuel at the gas giant — and 3 SP/day of
off-world imports, **which stop the moment Davion holds both jump points**.

**Victory**: 170 VP (objectives accrue daily — spaceport 3, capital 3, factory 2,
airfield 1, railhead 1, the hidden cache 2, the gas giant refinery 1: **13/day at full
hold**) or best position at day 30. Left alone the Guard wins around day 13 — **the
attacker is on a clock**, and every objective flipped swings the race by double.

## The first session, beat by beat

1. **The burn (Days 0–3).** The fleet's TRANSIT orders are pre-plotted: 8 AU at 1G.
   Liao's screens light up ~66 minutes after the burn starts — light lag — and the
   drive plumes tell them tonnage and vector. They know you're coming; they don't know
   where you'll land, and the continent is 1,400 km wide. *(DEEP SKY: lanes,
   brachistochrone, light-lag intel. The Kestrel: COLD_COAST + false flag — inspect it
   with the picket and see if the lie holds.)*
2. **Down the well, the spheroid way.** The Overlord is a flying egg — 1 air hex per
   turn in atmosphere, so it does NOT fly across the continent. **DESCEND with a target
   hex** drops it out of orbit *directly over* the cold LZ at (68,30) on the eastern
   plain — dark to Northwatch, six hexes from the railhead — then LAND. The aerodyne
   Leopard CV can actually fly: it can put its deck wherever the fighters need their
   fuel. *(ASCEND/DESCEND-on-target, LAND anywhere, spheroid vs aerodyne, the radar
   gap, RAIN covering the approach.)*
3. **Boots down, and the race for the railhead.** DISEMBARK; scramble a fighter flight
   off the Swift Wing for a RECON pass along the mainline. **Hengshan railhead is the
   whole opening**: take it intact and your battalion rides 52 hexes to the factory
   gates in ~4 hours; lose the race and you walk for two days while the Long Tom
   registers your route. The Raven lance is already screening it, the Sha Yus are HIDE
   somewhere closer than you'd like, and the ambush wood at (65,28) sits right on your
   march route. Watch the "battalion" at the fake radar site — inflatables read one
   size bigger. *(Carrier ops, deck scrambles, rail movement, EMCON, DECOY, satellite
   passes, HIDE, SHADOW tails.)*
4. **The approach.** The mainline into the heartland is mined east of the factory (the
   Pioneers can BREACH), the Long Tom answers anything the Guard's spotters see
   (counter-battery reveals it — then it shoots and scoots), and Northwatch means any
   air support you fly north of the badlands is tracked the whole way in. First contact
   between line formations freezes the campaign: **battle night**. The handoff carries
   entry edges, initiative (Kerr's C3M buys +1), CAS with real arrival turns from real
   distances, artillery in range, dug-in defenders, RDY penalties — print the 🖨 battle
   pack, play it, feed the marked cards back. *(Engagement freeze, handoff, CAS-to-
   table, C3M, fires, engineering, radar-gap routing.)*
5. **The long war.** Damage persists on the sheets — the same left-torso boxes come
   back next battle unless repaired. REPAIR at a captured facility (or in the
   DropShips' bays), REARM from the trains, salvage the field — recovered wrecks refit
   into your roster with POOL pilots, air kills rain down as salvage under the merge,
   the wounded heal (3 days per hit — 1 with the MASH trucks both sides brought). Cut
   the rail behind the Guard's forward deployments and they walk home. Take both jump
   points and their imports stop; take the spaceport and yours start. *(Careers, sheet
   persistence, repair/rearm/refit economy, salvage, blockade, factory output, rail as
   a weapon.)*

## GM crib sheet

- **Autopace + Discord** (see HOSTING.md) make this a slow war between battle nights.
  The big map means long quiet stretches — that's what the compression clock and
  autopace are for.
- The pirate point (2 AU out!) is secret and Liao holds the survey — espionage or a
  captured nav core (`surveyNode`) hands Davion the fast back door.
- The hidden supply cache in the woods at (55,38) is a scoutable prize sitting right
  in the radar gap — the same corridor Davion's air wants to use.
- Undo (`↶`), **⏪ rewind**, noise injection, and the audit viewer all work here.
- Sensible LZ alternatives if your players scout first: the badlands south (dark, but
  rough going for the tanks) or a bold drop near the fake radar site (it's a trap that
  costs them nothing — which tells them something).

## Mechanics checklist (what this campaign exercises)

Event-sourced clock & compression · double-blind detection ladder & reports · command
nets & off-net couriers · ground movement/terrain/roads · **rail movement** ·
HIDE/DIG_IN/patrols · minefields & engineers · artillery + counter-battery · satellites
· ECM/BEAGLE/STEALTH/C3M/DECOY/HQ/AA/MASH derivation from real record sheets ·
engagement freeze → printable battle pack → tracker cards → BattleResult ingest ·
salvage → refit → careers (XP, aces, wounds, MASH) · sheet damage persistence ·
repair/rearm economy, factory output, convoy resupply, supply lines & starvation ·
carriers (bays/crews/av fuel), embark/disembark, deck scrambles, auto-recovery, carrier
rearm · LIFT_OFF/LAND/ASCEND/**DESCEND-on-target**, spheroid vs aerodyne · **the
congruent sky: radar horizons, the picket gap, card-true speeds, track-quality lead
error** · flak umbrellas · CAS on call at real distances · jump board & sail recharge ·
lanes, brachistochrone burns, light lag, cold coast · false flags & inspection ·
gas-giant skimming · pirate points · blockades & imports · VP objectives (real, hidden,
and fake) · endings · autopace + fog-scoped Discord pings · byte-exact replay of the
whole war.
