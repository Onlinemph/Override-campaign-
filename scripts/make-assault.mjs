/**
 * scripts/make-assault.mjs — builds demo/assault.json: OPERATION DAGGERPOINT,
 * a 3067 planetary assault that exercises every mechanic in the engine — at
 * continental scale (D-037/D-038: the congruent sky, real radar geography,
 * card-true air speeds, and a rail spine worth fighting over).
 * Run with: npx tsx scripts/make-assault.mjs   (regenerates the committed file)
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { generateOverrides } from '../src/campaign/generate.js';
import { validateCampaign } from '../src/campaign/schema.js';

const T = 'menghao';
const W = 80, H = 50; // 1,440 × 900 km — the Jiangxi continent

// ── terrain: a coherent generated continent, then bulldoze the sites we need ──
const overrides = generateOverrides({ width: W, height: H, seed: 'DAGGERPOINT' });
const byKey = new Map(overrides.map(o => [`${o.q},${o.r}`, o]));
function site(q, r, patch) {
  const cur = byKey.get(`${q},${r}`) ?? { q, r };
  const next = { ...cur, terrain: 'CLEAR', ...patch, q, r };
  byKey.set(`${q},${r}`, next);
}

// The trans-Jiangxi mainline: rail from Port Menghao east to the Hengshan railhead.
// Whoever holds the line moves battalions at 12 hexes/hour; everyone else walks.
for (let q = 10; q <= 62; q++) site(q, 26, { infra: ['RAIL'] });

// Liao's built-up west, strung along the mainline
site(10, 26, { infra: ['SPACEPORT', 'RAIL', 'ROAD'], objective: { vpPerDay: 3, ownerSideId: 'liao' } });
site(14, 26, { infra: ['CITY', 'RAIL', 'ROAD'],      objective: { vpPerDay: 3, ownerSideId: 'liao' } });
site(18, 26, { infra: ['FACTORY', 'RAIL', 'ROAD'],   objective: { vpPerDay: 2, ownerSideId: 'liao' } });
site(13, 18, { infra: ['AIRSTRIP', 'ROAD'],          objective: { vpPerDay: 1, ownerSideId: 'liao' } });
site(11, 30, { infra: ['DEPOT', 'ROAD'] });
// road links: airbase spur north, depot spur south
for (const [q, r] of [[12, 24], [12, 22], [13, 20], [13, 19], [11, 27], [11, 28], [11, 29]]) {
  site(q, r, { infra: ['ROAD'] });
}
// the eastern railhead: a town the invader wants intact — take it and ride the line west
site(62, 26, { infra: ['TOWN', 'RAIL', 'ROAD'], objective: { vpPerDay: 1, ownerSideId: 'liao' } });

// the radar picture: Northwatch covers the northern & central approaches (24 air-hex
// horizon); the southern badlands are OFF THE SCOPE — the gap a raid can thread
site(36, 14, { infra: ['SENSOR_STATION', 'ROAD'] });

// a fake radar site in the far northeast (inflatable decoys, radiating merrily),
// and a hidden supply cache in the southern woods
site(64, 12, { objective: { vpPerDay: 2, ownerSideId: 'liao', fake: true } });
site(55, 38, { terrain: 'WOODS', objective: { vpPerDay: 2, ownerSideId: 'liao', hidden: true } });

// blue's cold LZ on the eastern plain: 6 hexes from the railhead, dark to Northwatch
site(68, 30, {});
site(69, 30, {});
// an ambush wood on the obvious march route LZ → railhead
site(65, 28, { terrain: 'WOODS' });

// ── pilots: a few names that matter (the career loop makes them matter more) ──
const ace = { name: 'Hauptmann Adele Kerr', gunnery: 2, piloting: 3, ace: true, kills: 6 };

const u = (name, model, cls, extra = {}) => ({ name, model, class: cls, ...extra });
const mech = (name, model, extra = {}) => u(name, model, 'MECH', extra);
const veh  = (name, model, extra = {}) => u(name, model, 'VEHICLE', extra);
const asf  = (name, model, fp = 400) => u(name, model, 'ASF', { fuelFp: fp, safeThrust: 6 });
const ds   = (name, model, extra = {}) =>
  u(name, model, 'DROPSHIP', { fuelTons: 120, tonsPerBurnDay: 1.84, maxThrust: 3,
                               fuelFp: 3600, ...extra });

const formations = [
  // ═══ LIAO — Menghao Prefectorate Guard (defenders) ═══
  { id: 'red-hq', sideId: 'liao', name: 'Prefecture Command', theaterId: T, q: 10, r: 26,
    sigBase: 7, posture: 'DUG_IN', _commandNode: true,
    units: [veh('Guard Actual', 'Browning Mobile HQ'),
            veh('Signals', 'Browning Mobile HQ')] },
  { id: 'red-line-1', sideId: 'liao', name: 'Ti Ts’ang Lance', theaterId: T, q: 14, r: 26,
    sigBase: 7,
    conditionals: undefined,
    units: [mech('Shiao-zhang Liu', 'Ti Ts_ang TSG-10L', { pilot: { name: 'Shiao-zhang Wen Liu', gunnery: 3, piloting: 4 } }),
            mech('Guard 2', 'Vindicator VND-1R'),
            mech('Guard 3', 'Vindicator VND-1R'),
            mech('Guard 4', 'Cataphract CTF-2X')] },
  { id: 'red-recon', sideId: 'liao', name: 'Raven Scout Lance', theaterId: T, q: 42, r: 24,
    sigBase: 7, emcon: 'PASSIVE',
    units: [mech('Whisper', 'Raven RVN-3L', { pilot: 'Sao-wei Mei Chen' }),
            veh('Ghost 1', 'Pegasus Scout Hover Tank'),
            veh('Ghost 2', 'Pegasus Scout Hover Tank')] },
  { id: 'red-stealth', sideId: 'liao', name: 'Shadow Lance', theaterId: T, q: 58, r: 27,
    sigBase: 7, posture: 'HIDE', emcon: 'DARK',
    units: [mech('Silent One', 'Sha Yu SYU-2B'),
            mech('Silent Two', 'Sha Yu SYU-2B')] },
  { id: 'red-armor', sideId: 'liao', name: 'Po Company', theaterId: T, q: 16, r: 26,
    sigBase: 6,
    units: [veh('Iron 1', 'Po Heavy Tank'), veh('Iron 2', 'Po Heavy Tank'),
            veh('Iron 3', 'Po Heavy Tank'), veh('Iron 4', 'Vedette Medium Tank')] },
  { id: 'red-aa-port', sideId: 'liao', name: 'Spaceport Flak Battery', theaterId: T, q: 10, r: 26,
    sigBase: 7, posture: 'DUG_IN',
    units: [veh('Flak 1', 'Partisan AA Vehicle', { tags: ['AA'] }), veh('Flak 2', 'Partisan AA Vehicle', { tags: ['AA'] })] },
  { id: 'red-aa-air', sideId: 'liao', name: 'Airbase Flak Battery', theaterId: T, q: 13, r: 18,
    sigBase: 7, posture: 'DUG_IN',
    units: [veh('Flak 3', 'Partisan AA Vehicle', { tags: ['AA'] }), veh('Flak 4', 'Partisan AA Vehicle', { tags: ['AA'] })] },
  { id: 'red-inf', sideId: 'liao', name: 'Home Guard Infantry', theaterId: T, q: 18, r: 26,
    sigBase: 10, posture: 'DUG_IN',
    units: [u('Home Guard', 'INF_PLACEHOLDER', 'INFANTRY'),
            u('Militia', 'INF_PLACEHOLDER', 'INFANTRY')] },
  { id: 'red-arty', sideId: 'liao', name: 'Menghao Fire Support', theaterId: T, q: 13, r: 25,
    sigBase: 7, posture: 'DUG_IN',
    units: [veh('Thunder', 'Mobile Long Tom Artillery LT-MOB-25F')] },
  { id: 'red-mash', sideId: 'liao', name: 'Field Hospital', theaterId: T, q: 11, r: 30,
    sigBase: 8,
    units: [veh('Mercy', 'MASH Truck')] },
  { id: 'red-eng', sideId: 'liao', name: '48th Combat Engineers', theaterId: T, q: 14, r: 27,
    sigBase: 8,
    units: [veh('Sapper 1', 'J-27 Ordnance Transport', { tags: ['ENGINEER'] })] },
  { id: 'red-convoy', sideId: 'liao', name: 'Supply Column', theaterId: T, q: 11, r: 30,
    sigBase: 6, carriedSp: 12,
    units: [veh('Truck 1', 'J-27 Ordnance Transport'), veh('Truck 2', 'J-27 Ordnance Transport')] },
  { id: 'red-decoy', sideId: 'liao', name: 'Radar Site Garrison', theaterId: T, q: 64, r: 12,
    sigBase: 6, emcon: 'ACTIVE',
    units: [u('Inflatables', 'DECOY_PLACEHOLDER', 'SUPPORT', { tags: ['DECOY'] })] },
  { id: 'red-cap', sideId: 'liao', name: 'Dianwei Flight', theaterId: T, q: 13, r: 18,
    sigBase: 8, alertState: 'ALERT15', flight: { homeFacilityId: 'red-airbase' },
    units: [asf('Dianwei 1', 'Transit TR-10', 360), asf('Dianwei 2', 'Transit TR-10', 360)] },
  { id: 'red-carrier', sideId: 'liao', name: 'DropShip Zhanshi', theaterId: T, q: 10, r: 26,
    sigBase: 8, flight: {}, carrier: { bays: 2, crews: 1, avFuelTons: 40 },
    units: [ds('Zhanshi', 'Union (2708)')] },
  { id: 'red-stowed', sideId: 'liao', name: 'Sting Flight', theaterId: T, q: 10, r: 26,
    sigBase: 9, mountedOn: 'red-carrier',
    units: [asf('Sting 1', 'Transit TR-10', 360), asf('Sting 2', 'Transit TR-10', 360)] },
  { id: 'red-picket', sideId: 'liao', name: 'Gas Giant Picket', nodeId: 'tianzhu',
    sigBase: 8, emcon: 'ACTIVE',
    units: [ds('Yao Guai', 'Leopard (3056)', { fuelTons: 40 })] },

  // ═══ DAVION — 1st Kittery Borderers, Task Force DAGGERPOINT (attackers) ═══
  { id: 'blue-jumpship', sideId: 'davion', name: 'JS Excalibur’s Word', nodeId: 'zenith',
    sigBase: 8, emcon: 'PASSIVE',
    units: [u('Excalibur’s Word', 'Invader JumpShip', 'JUMPSHIP',
              { drive: { chargePct: 0, sail: 'DEPLOYED' } })] },
  { id: 'blue-flag', sideId: 'davion', name: 'DropShip Fortune’s Hammer', nodeId: 'zenith',
    sigBase: 8, flight: {}, _commandNode: true,
    carrier: { bays: 4, crews: 2, avFuelTons: 80 },
    units: [ds('Fortune’s Hammer', 'Overlord (2762)', { fuelTons: 200 })] },
  { id: 'blue-union', sideId: 'davion', name: 'DropShip Halberd', nodeId: 'zenith',
    sigBase: 8, flight: {}, carrier: { bays: 4, crews: 1, avFuelTons: 50 },
    units: [ds('Halberd', 'Union (2708)')] },
  { id: 'blue-cv', sideId: 'davion', name: 'DropShip Swift Wing', nodeId: 'zenith',
    sigBase: 8, flight: {}, carrier: { bays: 2, crews: 1, avFuelTons: 40 },
    units: [ds('Swift Wing', 'Leopard CV (3054)', { fuelTons: 60 })] },
  { id: 'blue-qship', sideId: 'davion', name: 'FT Kestrel', nodeId: 'nadir',
    sigBase: 8, emcon: 'DARK', squawk: 'Free Trader Kestrel (merchant)',
    carrier: { bays: 1, crews: 0, avFuelTons: 5 }, flight: {},
    units: [ds('Kestrel', 'Leopard (3056)', { fuelTons: 40 })] },
  // aboard Fortune's Hammer
  { id: 'blue-assault', sideId: 'davion', name: 'Kerr’s Command Lance', theaterId: T,
    q: 68, r: 30, sigBase: 7, mountedOn: 'blue-flag',
    units: [mech('Kerr', 'Atlas AS7-CM', { pilot: ace }),
            mech('Sword 2', 'Enforcer ENF-4R'),
            mech('Sword 3', 'Centurion CN9-A'),
            mech('Sword 4', 'Valkyrie VLK-QA')] },
  { id: 'blue-cav', sideId: 'davion', name: 'Cavalry Lance', theaterId: T, q: 68, r: 30,
    sigBase: 7, mountedOn: 'blue-flag',
    units: [mech('Lance 1', 'Enforcer ENF-4R'), mech('Lance 2', 'Centurion CN9-A'),
            mech('Lance 3', 'Wasp WSP-1A'), mech('Lance 4', 'Valkyrie VLK-QA')] },
  { id: 'blue-arty', sideId: 'davion', name: 'Thumper Battery', theaterId: T, q: 68, r: 30,
    sigBase: 7, mountedOn: 'blue-flag',
    units: [veh('Anvil 1', 'Mobile Long Tom Artillery LT-MOB-25F'),
            veh('Anvil 2', 'Mobile Long Tom Artillery LT-MOB-25F')] },
  { id: 'blue-aa', sideId: 'davion', name: 'Umbrella Battery', theaterId: T, q: 68, r: 30,
    sigBase: 7, mountedOn: 'blue-flag',
    units: [veh('Umbrella 1', 'Partisan AA Vehicle', { tags: ['AA'] }), veh('Umbrella 2', 'Partisan AA Vehicle', { tags: ['AA'] })] },
  // aboard Halberd
  { id: 'blue-armor', sideId: 'davion', name: 'Bulldog Troop', theaterId: T, q: 68, r: 30,
    sigBase: 7, mountedOn: 'blue-union',
    units: [veh('Dog 1', 'Bulldog Medium Tank'), veh('Dog 2', 'Bulldog Medium Tank'),
            veh('Dog 3', 'Vedette Medium Tank'), veh('Dog 4', 'Vedette Medium Tank')] },
  { id: 'blue-recon', sideId: 'davion', name: 'Savannah Screen', theaterId: T, q: 68, r: 30,
    sigBase: 7, mountedOn: 'blue-union',
    units: [veh('Flea 1', 'Savannah Master Hovercraft'),
            veh('Flea 2', 'Savannah Master Hovercraft'),
            veh('Eyes', 'Pegasus Scout Hover Tank')] },
  { id: 'blue-trains', sideId: 'davion', name: 'Task Force Trains', theaterId: T, q: 68, r: 30,
    sigBase: 6, mountedOn: 'blue-union', carriedSp: 20, _commandNode: true,
    units: [veh('Aid Station', 'MASH Truck'),
            veh('Net Actual', 'Browning Mobile HQ'),
            veh('Stores 1', 'J-27 Ordnance Transport'),
            veh('Stores 2', 'J-27 Ordnance Transport')] },
  { id: 'blue-eng', sideId: 'davion', name: 'Pioneer Platoon', theaterId: T, q: 68, r: 30,
    sigBase: 8, mountedOn: 'blue-union',
    units: [veh('Pioneer 1', 'J-27 Ordnance Transport', { tags: ['ENGINEER'] })] },
  // aboard Swift Wing
  { id: 'blue-flight-1', sideId: 'davion', name: 'Corsair Flight', theaterId: T, q: 68, r: 30,
    sigBase: 9, mountedOn: 'blue-cv',
    units: [asf('Reaper 1', 'Corsair COR-5R'), asf('Reaper 2', 'Corsair COR-5R')] },
  { id: 'blue-flight-2', sideId: 'davion', name: 'Stuka Flight', theaterId: T, q: 68, r: 30,
    sigBase: 9, mountedOn: 'blue-cv',
    units: [asf('Hammer 1', 'Stuka STU-K10'), asf('Hammer 2', 'Stuka STU-K10')] },
  // aboard the Kestrel
  { id: 'blue-ba', sideId: 'davion', name: 'Cavalier Squad', theaterId: T, q: 68, r: 30,
    sigBase: 10, mountedOn: 'blue-qship',
    units: [u('Cavaliers', 'BA_PLACEHOLDER', 'BA')] },
];

// library-dependent picks with graceful fallbacks
try {
  const idx = JSON.parse(readFileSync('cards/dist-web/units-index.json', 'utf8'));
  const names = (Array.isArray(idx) ? idx : idx.units).map(x => x.name);
  const pick = (cands, fallback) => cands.find(c => names.includes(c)) ?? fallback;
  const inf = pick(['Foot Platoon (Rifle)', 'Foot Infantry (Laser)'],
    names.find(n => /^Foot /i.test(n)) ?? 'Foot Infantry');
  const ba = pick(['Cavalier Battle Armor', 'Infiltrator Mk. I Battle Armor (Sqd4)'],
    names.find(n => /Cavalier/i.test(n)) ?? names.find(n => /Battle Armor.*Sqd/i.test(n)) ?? 'Cavalier Battle Armor');
  for (const f of formations) for (const un of f.units) {
    if (un.model === 'INF_PLACEHOLDER') un.model = inf;
    if (un.model === 'BA_PLACEHOLDER') un.model = ba;
    if (un.model === 'DECOY_PLACEHOLDER') un.model = inf; // any body; the DECOY tag is the point
  }
} catch { /* library not built: placeholders stay; enrichment simply skips them */ }

const campaign = {
  seed: 'DAGGERPOINT-3067',
  config: {
    name: 'Operation DAGGERPOINT — Menghao, 3067',
    dawnTick: 60, duskTick: 180, weather: 'RAIN',
    airHexByTheater: { [T]: { q: 0, r: 0 } }, // congruent sky: air (q,r) = ground (q,r)
    vpThreshold: 170, endTick: 7200, // 30 days; liao full-hold (13/day) wins in ~13
  },
  theaters: [{ id: T, name: 'Menghao — Jiangxi Continent', width: W, height: H,
               defaultTerrain: 'CLEAR', overrides: [...byKey.values()] }],
  sides: [
    { id: 'davion', name: '1st Kittery Borderers (AFFS)' },
    { id: 'liao', name: 'Menghao Prefectorate Guard (CCAF)',
      importSpPerDay: 3, homeDepotId: 'red-depot' },
  ],
  facilities: [
    { id: 'red-spaceport', sideId: 'liao', name: 'Port Menghao', theaterId: T, q: 10, r: 26,
      tags: ['SPACEPORT', 'DEPOT'], supplyPoints: 30, fuelFarmTons: 40, turnaroundCrews: 2,
      isCommandNode: true, sensorStation: { passive: 8, active: 12 },
      // D-050: the capital-missile battery that makes the eastern LZ the ONLY sane
      // landing — nothing capital-hulled lives within 16 air hexes of the port
      capitalBattery: { weapon: 'WHITE_SHARK', shots: 8 } },
    { id: 'red-airbase', sideId: 'liao', name: 'Chiang Airfield', theaterId: T, q: 13, r: 18,
      tags: ['AIRSTRIP'], supplyPoints: 6, fuelFarmTons: 25, turnaroundCrews: 2 },
    { id: 'red-depot', sideId: 'liao', name: 'Prefecture Depot', theaterId: T, q: 11, r: 30,
      tags: ['DEPOT'], supplyPoints: 24 },
    { id: 'red-factory', sideId: 'liao', name: 'Jiangxi Works', theaterId: T, q: 18, r: 26,
      tags: ['FACTORY'], supplyPoints: 10 },
    // the picket line: Northwatch covers the north & center; the southern badlands
    // (r ≥ 39-ish) are outside every radar horizon — the gap
    { id: 'red-northwatch', sideId: 'liao', name: 'Northwatch Station', theaterId: T, q: 36, r: 14,
      tags: ['SENSOR_STATION'], sensorStation: { passive: 6, active: 12 }, activeSweep: true },
  ],
  satellites: [
    { id: 'red-sat', sideId: 'liao', kind: 'RECON', theaterId: T,
      corridor: [{ q: 0, r: 26 }, { q: 79, r: 26 }], periodPulses: 4, nextPassTick: 20 },
  ],
  markers: [
    // the mainline approach to the heartland is mined east of the factory
    { id: 'mine-1', kind: 'MINEFIELD', theaterId: T, q: 22, r: 26, sideId: 'liao' },
    { id: 'mine-2', kind: 'MINEFIELD', theaterId: T, q: 23, r: 25, sideId: 'liao' },
  ],
  system: {
    nodes: [
      { id: 'zenith', type: 'JUMP_ZENITH', name: 'Zenith Point' },
      { id: 'nadir', type: 'JUMP_NADIR', name: 'Nadir Point' },
      { id: 'menghao', type: 'PLANET', name: 'Menghao', theaterId: T },
      { id: 'tianzhu', type: 'GAS_GIANT', name: 'Tianzhu',
        objective: { vpPerDay: 1, ownerSideId: 'liao' } },
      { id: 'shadow-point', type: 'PIRATE_POINT', name: 'Uncharted Lagrange', secret: true },
    ],
    lanes: [
      { a: 'zenith', b: 'menghao', distanceAU: 8 },
      { a: 'nadir', b: 'menghao', distanceAU: 8 },
      { a: 'tianzhu', b: 'menghao', distanceAU: 5 },
      { a: 'shadow-point', b: 'menghao', distanceAU: 2 },
    ],
  },
  formations,
  commandNodes: {
    davion: ['blue-flag', 'blue-trains'],
    liao: ['red-hq', 'red-spaceport'],
  },
  orders: [
    // the fleet burns in from the zenith at 1G — ~2.8 burn-days of light-lagged warning
    { id: 'o-flag', sideId: 'davion', formationId: 'blue-flag', kind: 'TRANSIT',
      effectiveTick: 0, laneId: 'zenith--menghao', destinationNodeId: 'menghao',
      burnProfile: { g: 1 } },
    { id: 'o-union', sideId: 'davion', formationId: 'blue-union', kind: 'TRANSIT',
      effectiveTick: 0, laneId: 'zenith--menghao', destinationNodeId: 'menghao',
      burnProfile: { g: 1 } },
    { id: 'o-cv', sideId: 'davion', formationId: 'blue-cv', kind: 'TRANSIT',
      effectiveTick: 0, laneId: 'zenith--menghao', destinationNodeId: 'menghao',
      burnProfile: { g: 1 } },
    // the Kestrel coasts in cold from the nadir under a merchant squawk
    { id: 'o-qship', sideId: 'davion', formationId: 'blue-qship', kind: 'COLD_COAST',
      effectiveTick: 0, laneId: 'nadir--menghao', destinationNodeId: 'menghao',
      burnProfile: { g: 1, coastFromAU: 1 } },
    // the garrison watches: the Raven lance loops the eastern approaches ahead of the
    // railhead, and falls back down the mainline the moment it knows it's been seen
    { id: 'o-recon', sideId: 'liao', formationId: 'red-recon', kind: 'PATROL',
      effectiveTick: 0, path: [{ q: 48, r: 20 }, { q: 54, r: 28 }, { q: 44, r: 32 }, { q: 42, r: 24 }],
      conditionals: [{ trigger: { when: 'DETECTED_SELF', param: 0 },
        then: { kind: 'MOVE', path: [{ q: 24, r: 26 }] } }] },
    // the picket skims fuel at the gas giant until something jumps in
    { id: 'o-picket', sideId: 'liao', formationId: 'red-picket', kind: 'SKIM_FUEL',
      effectiveTick: 0 },
  ],
};

const problems = validateCampaign(campaign);
if (problems.length) {
  console.error('validation problems:');
  for (const p of problems) console.error(' •', p);
  process.exit(1);
}
writeFileSync('demo/assault.json', JSON.stringify(campaign, null, 2) + '\n');
console.log(`demo/assault.json written: ${formations.length} formations, ` +
  `${campaign.theaters[0].overrides.length} hex overrides on ${W}×${H}, valid ✓`);
