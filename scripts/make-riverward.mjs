/**
 * scripts/make-riverward.mjs — builds demo/riverward.json: OPERATION RIVERWARD,
 * a 3068 river-line defense on a GENERATED continent (D-041/D-044). Unlike
 * DAGGERPOINT (which bulldozes sites into a small map), this script generates the
 * continent first and then READS it — it finds the capital, the great river, the
 * bridges the road net actually built, the banks they join — and stations both
 * armies at the geography it found. Change the seed and the war moves house.
 * Run with: npx tsx scripts/make-riverward.mjs   (regenerates the committed file)
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { generateContinent } from '../src/campaign/continent.js';
import { validateCampaign } from '../src/campaign/schema.js';
import { ARTILLERY_RANGE_HEXES } from '../src/rules.js';

const T = 'cascara';
const W = 120, H = 80; // 2,160 × 1,440 km — the Verdigris continent
const SEED = 'RIVERWARD-9'; // chosen by scan: 3 crossings, 2 towns across the water

// ── 1. generate, then index the continent ──────────────────────────────────
const overrides = generateContinent({ width: W, height: H, seed: SEED });
const byKey = new Map(overrides.map(o => [`${o.q},${o.r}`, o]));
const terr = (q, r) => byKey.get(`${q},${r}`)?.terrain ?? 'CLEAR';
const infraOf = (q, r) => byKey.get(`${q},${r}`)?.infra ?? [];
const inb = (q, r) => q >= 0 && q < W && r >= 0 && r < H;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
const dist = (a, b) => {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
};

// annotate a found site (never rewrites terrain — the geography is the boss)
function site(q, r, patch) {
  const cur = byKey.get(`${q},${r}`) ?? { q, r };
  const infra = [...new Set([...(cur.infra ?? []), ...(patch.infra ?? [])])];
  byKey.set(`${q},${r}`, { ...cur, ...patch, ...(infra.length ? { infra } : {}), q, r });
}

// ── 2. read the geography ───────────────────────────────────────────────────
let capital = null;
const towns = [];
for (const o of overrides) {
  if (o.infra?.includes('CITY')) capital = { q: o.q, r: o.r };
  if (o.infra?.includes('TOWN')) towns.push({ q: o.q, r: o.r });
}
if (!capital) throw new Error('no capital on this seed');

// banks: flood-fill land from the capital; anything not reached is ACROSS the water
const bank = new Map(); // "q,r" -> true (capital bank)
{
  const stack = [capital];
  bank.set(`${capital.q},${capital.r}`, true);
  while (stack.length) {
    const c = stack.pop();
    for (const [dq, dr] of DIRS) {
      const q = c.q + dq, r = c.r + dr, k = `${q},${r}`;
      if (inb(q, r) && !bank.has(k) && terr(q, r) !== 'WATER') {
        bank.set(k, true);
        stack.push({ q, r });
      }
    }
  }
}
const onCapitalBank = p => bank.has(`${p.q},${p.r}`);

// crossings: cluster the BRIDGE hexes the road net built over the water
const bridgeHexes = overrides.filter(o => o.infra?.includes('BRIDGE') && o.terrain === 'WATER');
const crossings = [];
{
  const seen = new Set();
  for (const b of bridgeHexes) {
    if (seen.has(`${b.q},${b.r}`)) continue;
    const hexes = [];
    const stack = [b];
    seen.add(`${b.q},${b.r}`);
    while (stack.length) {
      const c = stack.pop();
      hexes.push({ q: c.q, r: c.r });
      for (const [dq, dr] of DIRS) {
        const k = `${c.q + dq},${c.r + dr}`;
        const n = byKey.get(k);
        if (n?.infra?.includes('BRIDGE') && n.terrain === 'WATER' && !seen.has(k)) {
          seen.add(k);
          stack.push({ q: n.q, r: n.r });
        }
      }
    }
    crossings.push({ hexes, anchor: hexes[0] });
  }
  crossings.sort((a, b) => a.anchor.q - b.anchor.q); // west → east
}
if (crossings.length < 2) throw new Error(`seed ${SEED} built only ${crossings.length} crossings`);

// BFS for the nearest hex satisfying a predicate (land search, water blocks)
function findNear(from, pred, { maxR = 30, crossWater = false } = {}) {
  const seen = new Set([`${from.q},${from.r}`]);
  let ring = [from];
  for (let d = 0; d <= maxR; d++) {
    for (const p of ring) if (pred(p, d)) return p;
    const next = [];
    for (const p of ring) {
      for (const [dq, dr] of DIRS) {
        const q = p.q + dq, r = p.r + dr, k = `${q},${r}`;
        if (!inb(q, r) || seen.has(k)) continue;
        if (!crossWater && terr(q, r) === 'WATER') continue;
        seen.add(k);
        next.push({ q, r });
      }
    }
    ring = next;
  }
  return null;
}
const flat = p => ['CLEAR', 'URBAN'].includes(terr(p.q, p.r));
const openGround = p => terr(p.q, p.r) === 'CLEAR' && !infraOf(p.q, p.r).length;

// each crossing gets its two road APPROACHES — the land the span actually joins.
// "near" is the approach on the capital's bank (or simply nearer the capital when
// a span crosses a tributary whose banks are both far-side).
for (const c of crossings) {
  const approaches = [];
  for (const hex of c.hexes) {
    for (const [dq, dr] of DIRS) {
      const q = hex.q + dq, r = hex.r + dr;
      if (!inb(q, r) || terr(q, r) === 'WATER') continue;
      if (!infraOf(q, r).includes('ROAD')) continue;
      if (!approaches.some(a => a.q === q && a.r === r)) approaches.push({ q, r });
    }
  }
  // fallback: any adjacent land, if a span somehow lost its road ends
  if (approaches.length < 2) {
    const extra = findNear(c.anchor, p => terr(p.q, p.r) !== 'WATER'
      && !approaches.some(a => a.q === p.q && a.r === p.r), { crossWater: true });
    if (extra) approaches.push(extra);
  }
  approaches.sort((a, b) =>
    (onCapitalBank(b) - onCapitalBank(a)) || (dist(a, capital) - dist(b, capital)));
  c.near = approaches[0];
  c.far = approaches[approaches.length - 1];
}
const spanNames = ['Argent Span', 'Kingsbridge', 'Saltmarsh Crossing', 'Fourth Span'];
crossings.forEach((c, i) => { c.name = spanNames[i] ?? `Span ${i + 1}`; });

// towns by bank
const nearTowns = towns.filter(onCapitalBank);
const farTowns = towns.filter(t => !onCapitalBank(t));
if (!farTowns.length) throw new Error('no towns across the river on this seed');

// the LZ: open ground on the FAR bank, a march (not a stroll) from the nearest
// crossing, well away from every settlement — the radar gap an invasion wants
let lz = null, lzScore = -Infinity;
for (let r = 0; r < H; r++) {
  for (let q = 0; q < W; q++) {
    const p = { q, r };
    if (onCapitalBank(p) || !openGround(p)) continue;
    const dCross = Math.min(...crossings.map(c => dist(p, c.anchor)));
    const dTown = Math.min(...towns.map(t => dist(p, t)), dist(p, capital));
    if (dCross < 8 || dCross > 18 || dTown < 8) continue;
    const openNbrs = DIRS.filter(([dq, dr]) => inb(q + dq, r + dr)
      && openGround({ q: q + dq, r: r + dr })).length;
    if (openNbrs < 4) continue;
    const score = dTown - Math.abs(dCross - 12) * 2;
    if (score > lzScore) { lzScore = score; lz = p; }
  }
}
if (!lz) throw new Error('no LZ found on the far bank');

// red's fixed installations, sited at what the map offers
const middle = crossings[Math.min(1, crossings.length - 1)];
const airbase = findNear(capital, (p, d) => d >= 3 && d <= 7 && openGround(p));
const depot = findNear(capital, (p, d) => d >= 1 && openGround(p));
const spaceport = findNear(capital, (p, d) => d >= 1 && openGround(p)
  && !(p.q === depot.q && p.r === depot.r));
const factory = findNear(capital, p => terr(p.q, p.r) === 'URBAN'
  && !(p.q === capital.q && p.r === capital.r)) ?? capital;
const riverwatch = findNear(middle.near, (p, d) => onCapitalBank(p) && d >= 2 && d <= 14
  && terr(p.q, p.r) === 'HILLS')
  ?? findNear(middle.near, (p, d) => onCapitalBank(p) && d >= 4 && openGround(p));
// artillery behind the middle span, inside Long Tom range of the span itself
const arty = findNear(middle.near, (p, d) => onCapitalBank(p) && flat(p)
  && d >= 3 && dist(p, middle.anchor) <= ARTILLERY_RANGE_HEXES.LONG_TOM - 2);
// armor reserve on the rail trunk, a fast ride from the capital
const railHexes = overrides.filter(o => o.infra?.includes('RAIL'))
  .map(o => ({ q: o.q, r: o.r }));
const reserve = railHexes
  .filter(p => onCapitalBank(p) && terr(p.q, p.r) !== 'WATER')
  .reduce((best, p) => {
    const d = dist(p, capital);
    const score = -Math.abs(d - 8);
    return score > (best?.score ?? -Infinity) ? { ...p, score } : best;
  }, null) ?? capital;
// a hidden red observation post overlooking the invasion's likely staging ground
const op = findNear(lz, (p, d) => d >= 4 && d <= 8
  && ['HILLS', 'WOODS'].includes(terr(p.q, p.r)), { crossWater: true }) ?? null;

// red's forward screen patrols the far-bank approach to the middle span
const screenBase = middle.far;
const screenLoop = [screenBase];
{
  let cur = screenBase;
  for (let step = 0; step < 3; step++) {
    const nxt = findNear(cur, (p, d) => d >= 2 && d <= 3 && !onCapitalBank(p) && flat(p)
      && !screenLoop.some(s => s.q === p.q && s.r === p.r));
    if (!nxt) break;
    screenLoop.push(nxt);
    cur = nxt;
  }
}

// relay masts (D-048): the Guard's command line to its bridgeheads runs along the
// road net — a mast every 20 road-steps from the capital toward each crossing, so
// the chain (capital HQ → mast → mast → the bridgehead's own listening post) keeps
// every guard commandable. Each mast is also a target: drop one and the line dies.
const masts = [];
{
  const roadKeys = new Set(overrides.filter(o => o.infra?.includes('ROAD'))
    .map(o => `${o.q},${o.r}`));
  const roadStart = findNear(capital, p => roadKeys.has(`${p.q},${p.r}`));
  const roadPathTo = (goal) => { // BFS along the road graph
    const seen = new Map([[`${roadStart.q},${roadStart.r}`, null]]);
    let ring = [roadStart];
    while (ring.length) {
      const next = [];
      for (const p of ring) {
        if (p.q === goal.q && p.r === goal.r) {
          const path = [];
          let k = `${p.q},${p.r}`;
          while (k) {
            const [q, r] = k.split(',').map(Number);
            path.unshift({ q, r });
            k = seen.get(k);
          }
          return path;
        }
        for (const [dq, dr] of DIRS) {
          const q = p.q + dq, r = p.r + dr, k = `${q},${r}`;
          if (roadKeys.has(k) && !seen.has(k)) { seen.set(k, `${p.q},${p.r}`); next.push({ q, r }); }
        }
      }
      ring = next;
    }
    return null;
  };
  for (const c of crossings) {
    const path = roadPathTo(c.near);
    if (!path) continue;
    for (let i = 20; i < path.length - 4; i += 20) {
      const p = path[i];
      if (dist(p, capital) <= 12) continue;              // the capital already covers it
      if (masts.some(m => dist(m, p) <= 8)) continue;    // corridors share trunk masts
      if (dist(p, riverwatch) <= 8) continue;            // Riverwatch doubles as a relay
      masts.push(p);
    }
  }
}

// ── 3. objectives on the found geography ────────────────────────────────────
site(capital.q, capital.r, { objective: { vpPerDay: 3, ownerSideId: 'marik' } });
// each crossing's prize is its BRIDGEHEAD — the capital-bank approach. Holding it
// means you crossed the river (or never let anyone else); the span itself is
// water no one needs to stand on.
for (const c of crossings) {
  site(c.near.q, c.near.r, { objective: { vpPerDay: 2, ownerSideId: 'marik' } });
}
for (const t of towns) site(t.q, t.r, { objective: { vpPerDay: 1, ownerSideId: 'marik' } });
site(airbase.q, airbase.r, { infra: ['AIRSTRIP'], objective: { vpPerDay: 1, ownerSideId: 'marik' } });
site(spaceport.q, spaceport.r, { infra: ['SPACEPORT'] });
site(depot.q, depot.r, { infra: ['DEPOT'] });
site(factory.q, factory.r, { infra: ['FACTORY'] });
site(riverwatch.q, riverwatch.r, { infra: ['SENSOR_STATION'] });
if (op) site(op.q, op.r, { objective: { vpPerDay: 1, ownerSideId: 'marik', hidden: true } });

// ── 4. the armies ───────────────────────────────────────────────────────────
const u = (name, model, cls, extra = {}) => ({ name, model, class: cls, ...extra });
const mech = (name, model, extra = {}) => u(name, model, 'MECH', extra);
const veh  = (name, model, extra = {}) => u(name, model, 'VEHICLE', extra);
const asf  = (name, model, fp = 360) => u(name, model, 'ASF', { fuelFp: fp, safeThrust: 6 });
const ds   = (name, model, extra = {}) =>
  u(name, model, 'DROPSHIP', { fuelTons: 120, tonsPerBurnDay: 1.84, maxThrust: 3,
                               fuelFp: 3600, ...extra });

const formations = [
  // ═══ MARIK — Cascara Home Guard (defenders of the Verdigris line) ═══
  { id: 'red-hq', sideId: 'marik', name: 'Guard Command', theaterId: T,
    q: capital.q, r: capital.r, sigBase: 7, posture: 'DUG_IN', _commandNode: true,
    units: [veh('Guard Actual', 'Browning Mobile HQ'), veh('Signals', 'Browning Mobile HQ')] },
  { id: 'red-line-1', sideId: 'marik', name: 'Orion Lance', theaterId: T,
    q: capital.q, r: capital.r, sigBase: 7,
    units: [mech('Force Commander Reyes', 'Orion ON1-K',
              { pilot: { name: 'Force Commander Elena Reyes', gunnery: 3, piloting: 4 } }),
            mech('Guard 2', 'Wolverine WVR-6R'),
            mech('Guard 3', 'Hermes II HER-2S'),
            mech('Guard 4', 'Stinger STG-3R')] },
  { id: 'red-line-2', sideId: 'marik', name: 'Awesome Lance', theaterId: T,
    q: (nearTowns[0] ?? capital).q, r: (nearTowns[0] ?? capital).r, sigBase: 7,
    units: [mech('Anchor 1', 'Awesome AWS-8Q'),
            mech('Anchor 2', 'Wolverine WVR-6R'),
            mech('Anchor 3', 'Hermes II HER-2S'),
            mech('Anchor 4', 'Stinger STG-3R')] },
  { id: 'red-armor', sideId: 'marik', name: 'Po Reserve Company', theaterId: T,
    q: reserve.q, r: reserve.r, sigBase: 6,
    units: [veh('Iron 1', 'Po Heavy Tank'), veh('Iron 2', 'Po Heavy Tank'),
            veh('Iron 3', 'Po Heavy Tank'), veh('Iron 4', 'Vedette Medium Tank')] },
  { id: 'red-screen', sideId: 'marik', name: 'Verdigris Screen', theaterId: T,
    q: screenBase.q, r: screenBase.r, sigBase: 7, emcon: 'PASSIVE',
    // the fallback is a rule, not a conditional: it survives any order change
    rules: [{ when: 'DETECTED_SELF', param: 0,
      then: { kind: 'MOVE', path: [{ q: middle.near.q, r: middle.near.r }] } }],
    units: [veh('Ghost 1', 'Pegasus Scout Hover Tank'),
            veh('Ghost 2', 'Pegasus Scout Hover Tank')] },
  { id: 'red-arty', sideId: 'marik', name: 'Verdigris Fire Support', theaterId: T,
    q: arty.q, r: arty.r, sigBase: 7, posture: 'DUG_IN',
    // registered fires as a standing rule: the moment a battle erupts within
    // reach, the mission opens on the middle span's far approach (D-049)
    rules: [{ when: 'ALLY_ENGAGED', param: 20,
      then: { kind: 'FIRE', targetHex: { q: middle.far.q, r: middle.far.r } } }],
    units: [veh('Thunder', 'Mobile Long Tom Artillery LT-MOB-25F')] },
  { id: 'red-aa', sideId: 'marik', name: 'Capital Flak Battery', theaterId: T,
    q: capital.q, r: capital.r, sigBase: 7, posture: 'DUG_IN',
    units: [veh('Flak 1', 'Partisan AA Vehicle', { tags: ['AA'] }),
            veh('Flak 2', 'Partisan AA Vehicle', { tags: ['AA'] })] },
  { id: 'red-mash', sideId: 'marik', name: 'Field Hospital', theaterId: T,
    q: depot.q, r: depot.r, sigBase: 8, units: [veh('Mercy', 'MASH Truck')] },
  { id: 'red-convoy', sideId: 'marik', name: 'Supply Column', theaterId: T,
    q: depot.q, r: depot.r, sigBase: 6, carriedSp: 12,
    units: [veh('Truck 1', 'J-27 Ordnance Transport'), veh('Truck 2', 'J-27 Ordnance Transport')] },
  { id: 'red-cap', sideId: 'marik', name: 'Halberd Flight', theaterId: T,
    q: airbase.q, r: airbase.r, sigBase: 8, alertState: 'ALERT15',
    flight: { homeFacilityId: 'red-airbase' },
    units: [asf('Halberd 1', 'Transit TR-10'), asf('Halberd 2', 'Transit TR-10')] },
  // bridge guards & the sappers who will blow the spans — one pair per crossing
  ...crossings.flatMap((c, i) => [
    { id: `red-guard-${i}`, sideId: 'marik', name: `${c.name} Guard`, theaterId: T,
      q: c.near.q, r: c.near.r, sigBase: 10, posture: 'DUG_IN',
      units: [u(`${c.name} Watch`, 'INF_PLACEHOLDER', 'INFANTRY'),
              veh(`${c.name} Post`, 'Browning Mobile HQ'), // the eyes that trip the charges
              veh(`${c.name} Flak`, 'Partisan AA Vehicle', { tags: ['AA'] })] },
    { id: `red-sap-${i}`, sideId: 'marik', name: `${c.name} Demo Team`, theaterId: T,
      q: c.near.q, r: c.near.r, sigBase: 9,
      // the charges are a STANDING RULE (D-049): it lives on the formation, fires
      // even off-net, and survives whatever order the demo team is running
      rules: [{ when: 'CONTACT_WITHIN', param: 2,
        then: { kind: 'DEMOLISH', targetHex: { q: c.anchor.q, r: c.anchor.r } } }],
      units: [veh(`Sapper ${i + 1}`, 'Engineering Vehicle', { tags: ['ENGINEER'] })] },
  ]),

  // ═══ LYRAN — 10th Skye Rangers, Task Force RIVERWARD (the far bank is theirs) ═══
  { id: 'blue-flag', sideId: 'skye', name: 'DropShip Höllental', theaterId: T,
    q: lz.q, r: lz.r, sigBase: 8, flight: {}, _commandNode: true,
    carrier: { bays: 4, crews: 2, avFuelTons: 80 },
    units: [ds('Höllental', 'Overlord (2762)', { fuelTons: 200 })] },
  { id: 'blue-union', sideId: 'skye', name: 'DropShip Loch Sloy', theaterId: T,
    q: lz.q, r: lz.r, sigBase: 8, flight: {}, carrier: { bays: 4, crews: 1, avFuelTons: 50 },
    units: [ds('Loch Sloy', 'Union (2708)')] },
  { id: 'blue-cv', sideId: 'skye', name: 'DropShip Skean Dhu', theaterId: T,
    q: lz.q, r: lz.r, sigBase: 8, flight: {}, carrier: { bays: 2, crews: 1, avFuelTons: 40 },
    units: [ds('Skean Dhu', 'Leopard CV (3054)', { fuelTons: 60 })] },
  { id: 'blue-assault', sideId: 'skye', name: 'Rautenberg’s Command Lance', theaterId: T,
    q: lz.q, r: lz.r, sigBase: 7,
    units: [mech('Rautenberg', 'Zeus ZEU-6S',
              { pilot: { name: 'Hauptmann Ilse Rautenberg', gunnery: 2, piloting: 3, ace: true, kills: 5 } }),
            mech('Claymore 2', 'Banshee BNC-3S'),
            mech('Claymore 3', 'Griffin GRF-1N'),
            mech('Claymore 4', 'Commando COM-2D')] },
  { id: 'blue-cav', sideId: 'skye', name: 'Highland Lance', theaterId: T,
    q: lz.q, r: lz.r, sigBase: 7,
    units: [mech('Dirk 1', 'Griffin GRF-1N'), mech('Dirk 2', 'Wolverine WVR-6R'),
            mech('Dirk 3', 'Commando COM-2D'), mech('Dirk 4', 'Stinger STG-3R')] },
  { id: 'blue-hover', sideId: 'skye', name: 'Loch Riders', theaterId: T,
    q: lz.q, r: lz.r, sigBase: 7,
    units: [veh('Kelpie 1', 'Condor Heavy Hover Tank'),
            veh('Kelpie 2', 'Condor Heavy Hover Tank'),
            veh('Kelpie 3', 'Savannah Master Hovercraft'),
            veh('Kelpie 4', 'Savannah Master Hovercraft')] },
  { id: 'blue-armor', sideId: 'skye', name: 'Bulldog Troop', theaterId: T,
    q: lz.q, r: lz.r, sigBase: 7,
    units: [veh('Dog 1', 'Bulldog Medium Tank'), veh('Dog 2', 'Bulldog Medium Tank'),
            veh('Dog 3', 'Vedette Medium Tank'), veh('Dog 4', 'Vedette Medium Tank')] },
  { id: 'blue-eyes', sideId: 'skye', name: 'Falcon Eyes', theaterId: T,
    q: lz.q, r: lz.r, sigBase: 8, emcon: 'PASSIVE',
    units: [u('Merlin 1', 'Ferret Light Scout VTOL', 'VTOL'),
            u('Merlin 2', 'Ferret Light Scout VTOL', 'VTOL'),
            u('Talon', 'Warrior H-7 Attack Helicopter', 'VTOL')] },
  { id: 'blue-eng', sideId: 'skye', name: 'Pioneer Company', theaterId: T,
    q: lz.q, r: lz.r, sigBase: 8,
    units: [veh('Pioneer 1', 'Prometheus Combat Support Bridgelayer', { tags: ['ENGINEER'] }),
            veh('Pioneer 2', 'Engineering Vehicle', { tags: ['ENGINEER'] })] },
  { id: 'blue-arty', sideId: 'skye', name: 'Anvil Battery', theaterId: T,
    q: lz.q, r: lz.r, sigBase: 7,
    units: [veh('Anvil 1', 'Mobile Long Tom Artillery LT-MOB-25F'),
            veh('Anvil 2', 'Mobile Long Tom Artillery LT-MOB-25F')] },
  { id: 'blue-aa', sideId: 'skye', name: 'Umbrella Battery', theaterId: T,
    q: lz.q, r: lz.r, sigBase: 7,
    units: [veh('Umbrella 1', 'Partisan AA Vehicle', { tags: ['AA'] }),
            veh('Umbrella 2', 'Partisan AA Vehicle', { tags: ['AA'] })] },
  { id: 'blue-trains', sideId: 'skye', name: 'Task Force Trains', theaterId: T,
    q: lz.q, r: lz.r, sigBase: 6, carriedSp: 20, _commandNode: true,
    units: [veh('Aid Station', 'MASH Truck'), veh('Net Actual', 'Browning Mobile HQ'),
            veh('Stores 1', 'J-27 Ordnance Transport'), veh('Stores 2', 'J-27 Ordnance Transport')] },
  { id: 'blue-ba', sideId: 'skye', name: 'Gray Death Detachment', theaterId: T,
    q: lz.q, r: lz.r, sigBase: 10,
    units: [u('Grenadiers', 'BA_PLACEHOLDER', 'BA')] },
  { id: 'blue-flight-1', sideId: 'skye', name: 'Corsair Flight', theaterId: T,
    q: lz.q, r: lz.r, sigBase: 9, mountedOn: 'blue-cv',
    units: [asf('Reaper 1', 'Corsair COR-5R'), asf('Reaper 2', 'Corsair COR-5R')] },
  { id: 'blue-flight-2', sideId: 'skye', name: 'Lucifer Flight', theaterId: T,
    q: lz.q, r: lz.r, sigBase: 9, mountedOn: 'blue-cv',
    units: [asf('Hammer 1', 'Lucifer LCF-R15'), asf('Hammer 2', 'Lucifer LCF-R15')] },
];

// library-dependent picks with graceful fallbacks (same dance as DAGGERPOINT)
try {
  const idx = JSON.parse(readFileSync('cards/dist-web/units-index.json', 'utf8'));
  const names = (Array.isArray(idx) ? idx : idx.units).map(x => x.name);
  const pick = (cands, fallback) => cands.find(c => names.includes(c)) ?? fallback;
  const inf = pick(['Foot Platoon (Rifle)', 'Foot Infantry (Laser)'],
    names.find(n => /^Foot /i.test(n)) ?? 'Foot Infantry');
  const ba = pick(['Gray Death Standard Suit (Sqd4)', 'Cavalier Battle Armor'],
    names.find(n => /Battle Armor.*Sqd/i.test(n)) ?? 'Cavalier Battle Armor');
  for (const f of formations) for (const un of f.units) {
    if (un.model === 'INF_PLACEHOLDER') un.model = inf;
    if (un.model === 'BA_PLACEHOLDER') un.model = ba;
  }
} catch { /* library not built: placeholders stay; enrichment simply skips them */ }

// ── 5. the campaign ─────────────────────────────────────────────────────────
const campaign = {
  seed: 'RIVERWARD-3068',
  config: {
    name: 'Operation RIVERWARD — Cascara, 3068',
    dawnTick: 60, duskTick: 180, weather: 'CLEAR',
    airHexByTheater: { [T]: { q: 0, r: 0 } }, // congruent sky: air (q,r) = ground (q,r)
    vpThreshold: 170, endTick: 7200, // 30 days; marik full-hold (~13/day) wins in ~13
  },
  theaters: [{ id: T, name: 'Cascara — Verdigris Continent', width: W, height: H,
               defaultTerrain: 'CLEAR', overrides: [...byKey.values()] }],
  sides: [
    { id: 'skye', name: '10th Skye Rangers (LAAF)', importSpPerDay: 2 },
    { id: 'marik', name: 'Cascara Home Guard (FWLM)',
      importSpPerDay: 2, homeDepotId: 'red-depot' },
  ],
  facilities: [
    { id: 'red-spaceport', sideId: 'marik', name: 'Port Cascara', theaterId: T,
      q: spaceport.q, r: spaceport.r, tags: ['SPACEPORT', 'DEPOT'], supplyPoints: 30,
      fuelFarmTons: 40, turnaroundCrews: 2, isCommandNode: true,
      sensorStation: { passive: 8, active: 12 } },
    { id: 'red-airbase', sideId: 'marik', name: 'Threshold Field', theaterId: T,
      q: airbase.q, r: airbase.r, tags: ['AIRSTRIP'], supplyPoints: 6, fuelFarmTons: 25,
      turnaroundCrews: 2 },
    { id: 'red-depot', sideId: 'marik', name: 'Guard Depot', theaterId: T,
      q: depot.q, r: depot.r, tags: ['DEPOT'], supplyPoints: 24 },
    { id: 'red-factory', sideId: 'marik', name: 'Verdigris Works', theaterId: T,
      q: factory.q, r: factory.r, tags: ['FACTORY'], supplyPoints: 10 },
    { id: 'red-riverwatch', sideId: 'marik', name: 'Riverwatch Station', theaterId: T,
      q: riverwatch.q, r: riverwatch.r, tags: ['SENSOR_STATION', 'COMM_RELAY'],
      sensorStation: { passive: 6, active: 12 }, activeSweep: true },
    // the Verdigris command line (D-048): masts strung down the road net keep the
    // bridgehead guards on the net — and give the invader a line to cut
    ...masts.map((m, i) => ({
      id: `red-mast-${i}`, sideId: 'marik', name: `Relay Mast ${i + 1}`, theaterId: T,
      q: m.q, r: m.r, tags: ['COMM_RELAY'],
    })),
    { id: 'blue-beachhead', sideId: 'skye', name: 'Beachhead Dump', theaterId: T,
      q: lz.q, r: lz.r, tags: ['DEPOT'], supplyPoints: 30, fuelFarmTons: 30,
      turnaroundCrews: 2 },
  ],
  satellites: [
    // the Home Guard watches its river: a recon bird sweeps the whole Verdigris
    // line, first crossing to last. Columns moving on the bridges get sampled
    // every few pulses — which is exactly the warning the demo teams live on.
    { id: 'red-riversat', sideId: 'marik', kind: 'RECON', theaterId: T,
      corridor: [
        { q: crossings[0].anchor.q, r: crossings[0].anchor.r },
        { q: crossings[crossings.length - 1].anchor.q,
          r: crossings[crossings.length - 1].anchor.r },
      ], periodPulses: 4, nextPassTick: 20 },
  ],
  system: {
    nodes: [
      { id: 'zenith', type: 'JUMP_ZENITH', name: 'Zenith Point' },
      { id: 'nadir', type: 'JUMP_NADIR', name: 'Nadir Point' },
      { id: 'cascara', type: 'PLANET', name: 'Cascara', theaterId: T },
    ],
    lanes: [
      { a: 'zenith', b: 'cascara', distanceAU: 8 },
      { a: 'nadir', b: 'cascara', distanceAU: 8 },
    ],
  },
  formations,
  commandNodes: {
    skye: ['blue-flag', 'blue-trains'],
    marik: ['red-hq', 'red-spaceport'],
  },
  orders: [
    // D-049: the demolition charges, the registered fires, and the screen's
    // fallback all live as STANDING RULES on their formations now (see the
    // formation entries) — they persist across any order and fire off-net. The
    // demo teams can therefore genuinely HIDE, and the battery needs no order at
    // all. (Historically these were conditionals on PATROL-in-place hack orders,
    // because conditionals die with their order and HIDE completes instantly.)
    ...crossings.map((c, i) => ({
      id: `o-sap-${i}`, sideId: 'marik', formationId: `red-sap-${i}`, kind: 'HIDE',
      effectiveTick: 0,
    })),
    // the hover screen sweeps the far-bank approach (its been-seen fallback is a rule)
    { id: 'o-screen', sideId: 'marik', formationId: 'red-screen', kind: 'PATROL',
      effectiveTick: 0, path: screenLoop.map(p => ({ q: p.q, r: p.r })) },
  ],
};

const problems = validateCampaign(campaign);
if (problems.length) {
  console.error('validation problems:');
  for (const p of problems) console.error(' •', p);
  process.exit(1);
}
writeFileSync('demo/riverward.json', JSON.stringify(campaign, null, 2) + '\n');
console.log(`demo/riverward.json written: ${formations.length} formations on ${W}×${H} (seed ${SEED})`);
console.log(`  capital ${capital.q},${capital.r} · LZ ${lz.q},${lz.r} (score ${lzScore})`);
for (const c of crossings) {
  console.log(`  ${c.name}: span ${c.hexes.map(x => `${x.q},${x.r}`).join(' ')}` +
    ` · near post ${c.near.q},${c.near.r} · far post ${c.far.q},${c.far.r}`);
}
console.log(`  towns: near ${nearTowns.map(t => `${t.q},${t.r}`).join(' ') || '—'}` +
  ` · far ${farTowns.map(t => `${t.q},${t.r}`).join(' ')}`);
console.log(`  airbase ${airbase.q},${airbase.r} · riverwatch ${riverwatch.q},${riverwatch.r}` +
  ` · arty ${arty.q},${arty.r} · reserve ${reserve.q},${reserve.r}` +
  (op ? ` · hidden OP ${op.q},${op.r}` : ''));
console.log(`  relay masts: ${masts.map(m => `${m.q},${m.r}`).join(' ') || '—'}`);
