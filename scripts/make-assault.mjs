/**
 * scripts/make-assault.mjs — builds demo/assault.json: OPERATION DAGGERPOINT,
 * a 3067 planetary assault that exercises every mechanic in the engine.
 * Run with: npx tsx scripts/make-assault.mjs   (regenerates the committed file)
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { generateOverrides } from '../src/campaign/generate.js';
import { validateCampaign } from '../src/campaign/schema.js';

const T = 'menghao';
const W = 26, H = 18;

// ── terrain: a coherent generated map, then bulldoze the sites we need ──
const overrides = generateOverrides({ width: W, height: H, seed: 'DAGGERPOINT' });
const byKey = new Map(overrides.map(o => [`${o.q},${o.r}`, o]));
function site(q, r, patch) {
  const cur = byKey.get(`${q},${r}`) ?? { q, r };
  const next = { ...cur, terrain: 'CLEAR', ...patch, q, r };
  byKey.set(`${q},${r}`, next);
}
// red's built-up west: spaceport, airbase, depot, factory — flattened and roaded
site(6, 9,  { infra: ['SPACEPORT', 'ROAD'], objective: { vpPerDay: 3, ownerSideId: 'liao' } });
site(9, 6,  { infra: ['AIRSTRIP', 'ROAD'] , objective: { vpPerDay: 1, ownerSideId: 'liao' } });
site(5, 12, { infra: ['DEPOT', 'ROAD'] });
site(8, 12, { infra: ['FACTORY', 'ROAD'], objective: { vpPerDay: 2, ownerSideId: 'liao' } });
for (const [q, r] of [[7, 9], [8, 8], [8, 7], [7, 12], [6, 10], [6, 11]]) {
  site(q, r, { infra: ['ROAD'] });
}
// a fake radar site (the DECOY battalion "garrisons" it) and a hidden supply cache
site(18, 4,  { objective: { vpPerDay: 2, ownerSideId: 'liao', fake: true } });
site(20, 12, { terrain: 'WOODS', objective: { vpPerDay: 2, ownerSideId: 'liao', hidden: true } });
// blue's likely LZ plain in the east, and an ambush wood on the approach
site(21, 9, {});
site(14, 11, { terrain: 'WOODS' });

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
  { id: 'red-hq', sideId: 'liao', name: 'Prefecture Command', theaterId: T, q: 6, r: 9,
    sigBase: 7, posture: 'DUG_IN', _commandNode: true,
    units: [veh('Guard Actual', 'Browning Mobile HQ'),
            veh('Signals', 'Browning Mobile HQ')] },
  { id: 'red-line-1', sideId: 'liao', name: 'Ti Ts’ang Lance', theaterId: T, q: 7, r: 9,
    sigBase: 7,
    conditionals: undefined,
    units: [mech('Shiao-zhang Liu', 'Ti Ts_ang TSG-10L', { pilot: { name: 'Shiao-zhang Wen Liu', gunnery: 3, piloting: 4 } }),
            mech('Guard 2', 'Vindicator VND-1R'),
            mech('Guard 3', 'Vindicator VND-1R'),
            mech('Guard 4', 'Cataphract CTF-2X')] },
  { id: 'red-recon', sideId: 'liao', name: 'Raven Scout Lance', theaterId: T, q: 14, r: 8,
    sigBase: 7, emcon: 'PASSIVE',
    units: [mech('Whisper', 'Raven RVN-3L', { pilot: 'Sao-wei Mei Chen' }),
            veh('Ghost 1', 'Pegasus Scout Hover Tank'),
            veh('Ghost 2', 'Pegasus Scout Hover Tank')] },
  { id: 'red-stealth', sideId: 'liao', name: 'Shadow Lance', theaterId: T, q: 14, r: 11,
    sigBase: 7, posture: 'HIDE', emcon: 'DARK',
    units: [mech('Silent One', 'Sha Yu SYU-2B'),
            mech('Silent Two', 'Sha Yu SYU-2B')] },
  { id: 'red-armor', sideId: 'liao', name: 'Po Company', theaterId: T, q: 8, r: 10,
    sigBase: 6,
    units: [veh('Iron 1', 'Po Heavy Tank'), veh('Iron 2', 'Po Heavy Tank'),
            veh('Iron 3', 'Po Heavy Tank'), veh('Iron 4', 'Vedette Medium Tank')] },
  { id: 'red-aa-port', sideId: 'liao', name: 'Spaceport Flak Battery', theaterId: T, q: 6, r: 9,
    sigBase: 7, posture: 'DUG_IN',
    units: [veh('Flak 1', 'Partisan AA Vehicle', { tags: ['AA'] }), veh('Flak 2', 'Partisan AA Vehicle', { tags: ['AA'] })] },
  { id: 'red-aa-air', sideId: 'liao', name: 'Airbase Flak Battery', theaterId: T, q: 9, r: 6,
    sigBase: 7, posture: 'DUG_IN',
    units: [veh('Flak 3', 'Partisan AA Vehicle', { tags: ['AA'] }), veh('Flak 4', 'Partisan AA Vehicle', { tags: ['AA'] })] },
  { id: 'red-inf', sideId: 'liao', name: 'Home Guard Infantry', theaterId: T, q: 8, r: 12,
    sigBase: 10, posture: 'DUG_IN',
    units: [u('Home Guard', 'INF_PLACEHOLDER', 'INFANTRY'),
            u('Militia', 'INF_PLACEHOLDER', 'INFANTRY')] },
  { id: 'red-arty', sideId: 'liao', name: 'Menghao Fire Support', theaterId: T, q: 5, r: 10,
    sigBase: 7, posture: 'DUG_IN',
    units: [veh('Thunder', 'Mobile Long Tom Artillery LT-MOB-25F')] },
  { id: 'red-mash', sideId: 'liao', name: 'Field Hospital', theaterId: T, q: 5, r: 12,
    sigBase: 8,
    units: [veh('Mercy', 'MASH Truck')] },
  { id: 'red-eng', sideId: 'liao', name: '48th Combat Engineers', theaterId: T, q: 7, r: 11,
    sigBase: 8,
    units: [veh('Sapper 1', 'J-27 Ordnance Transport', { tags: ['ENGINEER'] })] },
  { id: 'red-convoy', sideId: 'liao', name: 'Supply Column', theaterId: T, q: 5, r: 12,
    sigBase: 6, carriedSp: 12,
    units: [veh('Truck 1', 'J-27 Ordnance Transport'), veh('Truck 2', 'J-27 Ordnance Transport')] },
  { id: 'red-decoy', sideId: 'liao', name: 'Radar Site Garrison', theaterId: T, q: 18, r: 4,
    sigBase: 6, emcon: 'ACTIVE',
    units: [u('Inflatables', 'DECOY_PLACEHOLDER', 'SUPPORT', { tags: ['DECOY'] })] },
  { id: 'red-cap', sideId: 'liao', name: 'Dianwei Flight', theaterId: T, q: 9, r: 6,
    sigBase: 8, alertState: 'ALERT15', flight: { homeFacilityId: 'red-airbase' },
    units: [asf('Dianwei 1', 'Transit TR-10', 360), asf('Dianwei 2', 'Transit TR-10', 360)] },
  { id: 'red-carrier', sideId: 'liao', name: 'DropShip Zhanshi', theaterId: T, q: 6, r: 9,
    sigBase: 8, flight: {}, carrier: { bays: 2, crews: 1, avFuelTons: 40 },
    units: [ds('Zhanshi', 'Union (2708)')] },
  { id: 'red-stowed', sideId: 'liao', name: 'Sting Flight', theaterId: T, q: 6, r: 9,
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
    q: 21, r: 9, sigBase: 7, mountedOn: 'blue-flag',
    units: [mech('Kerr', 'Atlas AS7-CM', { pilot: ace }),
            mech('Sword 2', 'Enforcer ENF-4R'),
            mech('Sword 3', 'Centurion CN9-A'),
            mech('Sword 4', 'Valkyrie VLK-QA')] },
  { id: 'blue-cav', sideId: 'davion', name: 'Cavalry Lance', theaterId: T, q: 21, r: 9,
    sigBase: 7, mountedOn: 'blue-flag',
    units: [mech('Lance 1', 'Enforcer ENF-4R'), mech('Lance 2', 'Centurion CN9-A'),
            mech('Lance 3', 'Wasp WSP-1A'), mech('Lance 4', 'Valkyrie VLK-QA')] },
  { id: 'blue-arty', sideId: 'davion', name: 'Thumper Battery', theaterId: T, q: 21, r: 9,
    sigBase: 7, mountedOn: 'blue-flag',
    units: [veh('Anvil 1', 'Mobile Long Tom Artillery LT-MOB-25F'),
            veh('Anvil 2', 'Mobile Long Tom Artillery LT-MOB-25F')] },
  { id: 'blue-aa', sideId: 'davion', name: 'Umbrella Battery', theaterId: T, q: 21, r: 9,
    sigBase: 7, mountedOn: 'blue-flag',
    units: [veh('Umbrella 1', 'Partisan AA Vehicle', { tags: ['AA'] }), veh('Umbrella 2', 'Partisan AA Vehicle', { tags: ['AA'] })] },
  // aboard Halberd
  { id: 'blue-armor', sideId: 'davion', name: 'Bulldog Troop', theaterId: T, q: 21, r: 9,
    sigBase: 7, mountedOn: 'blue-union',
    units: [veh('Dog 1', 'Bulldog Medium Tank'), veh('Dog 2', 'Bulldog Medium Tank'),
            veh('Dog 3', 'Vedette Medium Tank'), veh('Dog 4', 'Vedette Medium Tank')] },
  { id: 'blue-recon', sideId: 'davion', name: 'Savannah Screen', theaterId: T, q: 21, r: 9,
    sigBase: 7, mountedOn: 'blue-union',
    units: [veh('Flea 1', 'Savannah Master Hovercraft'),
            veh('Flea 2', 'Savannah Master Hovercraft'),
            veh('Eyes', 'Pegasus Scout Hover Tank')] },
  { id: 'blue-trains', sideId: 'davion', name: 'Task Force Trains', theaterId: T, q: 21, r: 9,
    sigBase: 6, mountedOn: 'blue-union', carriedSp: 20, _commandNode: true,
    units: [veh('Aid Station', 'MASH Truck'),
            veh('Net Actual', 'Browning Mobile HQ'),
            veh('Stores 1', 'J-27 Ordnance Transport'),
            veh('Stores 2', 'J-27 Ordnance Transport')] },
  { id: 'blue-eng', sideId: 'davion', name: 'Pioneer Platoon', theaterId: T, q: 21, r: 9,
    sigBase: 8, mountedOn: 'blue-union',
    units: [veh('Pioneer 1', 'J-27 Ordnance Transport', { tags: ['ENGINEER'] })] },
  // aboard Swift Wing
  { id: 'blue-flight-1', sideId: 'davion', name: 'Corsair Flight', theaterId: T, q: 21, r: 9,
    sigBase: 9, mountedOn: 'blue-cv',
    units: [asf('Reaper 1', 'Corsair COR-5R'), asf('Reaper 2', 'Corsair COR-5R')] },
  { id: 'blue-flight-2', sideId: 'davion', name: 'Stuka Flight', theaterId: T, q: 21, r: 9,
    sigBase: 9, mountedOn: 'blue-cv',
    units: [asf('Hammer 1', 'Stuka STU-K10'), asf('Hammer 2', 'Stuka STU-K10')] },
  // aboard the Kestrel
  { id: 'blue-ba', sideId: 'davion', name: 'Cavalier Squad', theaterId: T, q: 21, r: 9,
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
    airHexByTheater: { [T]: { q: 12, r: 9 } },
    vpThreshold: 100, endTick: 7200, // 30 days; liao full-hold wins in ~14
  },
  theaters: [{ id: T, name: 'Menghao — Jiangxi Lowlands', width: W, height: H,
               defaultTerrain: 'CLEAR', overrides: [...byKey.values()] }],
  sides: [
    { id: 'davion', name: '1st Kittery Borderers (AFFS)' },
    { id: 'liao', name: 'Menghao Prefectorate Guard (CCAF)',
      importSpPerDay: 3, homeDepotId: 'red-depot' },
  ],
  facilities: [
    { id: 'red-spaceport', sideId: 'liao', name: 'Port Menghao', theaterId: T, q: 6, r: 9,
      tags: ['SPACEPORT', 'DEPOT'], supplyPoints: 30, fuelFarmTons: 40, turnaroundCrews: 2,
      isCommandNode: true, sensorStation: { passive: 8, active: 12 } },
    { id: 'red-airbase', sideId: 'liao', name: 'Chiang Airfield', theaterId: T, q: 9, r: 6,
      tags: ['AIRSTRIP'], supplyPoints: 6, fuelFarmTons: 25, turnaroundCrews: 2 },
    { id: 'red-depot', sideId: 'liao', name: 'Prefecture Depot', theaterId: T, q: 5, r: 12,
      tags: ['DEPOT'], supplyPoints: 24 },
    { id: 'red-factory', sideId: 'liao', name: 'Jiangxi Works', theaterId: T, q: 8, r: 12,
      tags: ['FACTORY'], supplyPoints: 10 },
  ],
  satellites: [
    { id: 'red-sat', sideId: 'liao', kind: 'RECON', theaterId: T,
      corridor: [{ q: 0, r: 9 }, { q: 25, r: 9 }], periodPulses: 4, nextPassTick: 20 },
  ],
  markers: [
    { id: 'mine-1', kind: 'MINEFIELD', theaterId: T, q: 11, r: 9, sideId: 'liao' },
    { id: 'mine-2', kind: 'MINEFIELD', theaterId: T, q: 12, r: 8, sideId: 'liao' },
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
    // the garrison watches: a scout loop on the eastern approaches
    { id: 'o-recon', sideId: 'liao', formationId: 'red-recon', kind: 'PATROL',
      effectiveTick: 0, path: [{ q: 17, r: 7 }, { q: 19, r: 10 }, { q: 15, r: 12 }, { q: 14, r: 8 }],
      conditionals: [{ trigger: { when: 'DETECTED_SELF', param: 0 },
        then: { kind: 'MOVE', path: [{ q: 10, r: 9 }] } }] },
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
  `${campaign.theaters[0].overrides.length} hex overrides, valid ✓`);
