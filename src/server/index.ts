/**
 * server/index.ts — minimal web app for Milestone 1 (clarity over beauty).
 *
 *   GM screen      /gm        truth + all side views side-by-side + event log + controls
 *   Player screens /player/:sideId   own forces, contacts w/ staleness, inbox, order entry
 *
 * Views are computed per request via project() and pushed over websockets on every
 * state change. Nothing player-facing is ever persisted (spec §4).
 */
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Campaign, replay } from '../core/truth.js';
import { JsonlEventStore, MemoryEventStore } from '../core/log.js';
import { project } from '../projection/project.js';
import { netNodesOf } from '../engine/net.js';
import { supplyEnvelope } from '../engine/logistics.js';
import { loadCampaignFixture, buildFormationEntities, buildCampaign } from '../demo.js';
import { generateCampaign } from '../campaign/generate.js';
import { rollForce, campaignUnitsFromForce } from '../roster/roll.js';
import { buildMul } from '../handoff/mul.js';
import { buildBattleRoster } from '../handoff/battle.js';
import { buildBattlePack } from './print.js';
import { findRoute } from '../engine/route.js';
import { AIR_MISSIONS, airHexOver } from '../engine/air.js';
import { collectNotifications, postWebhooks, webhookConfigFromEnv } from './notify.js';
import { buildDiary } from './diary.js';
import { enrichUnit } from '../roster/apply.js';
import { searchLibrary } from '../roster/library.js';
import { hashPick } from '../core/rng.js';
import { checkLatestRelease, type AppUpdate } from './update.js';
import {
  ARTILLERY_RANGE_HEXES, ATMO, CAPITAL_TN_BY_BAND, CAPITAL_WEAPONS, CAREER, CLOCK,
  COMBAT_DROP, FIRES, FLAK, LADDER, NET, RDY, RECON_TRICKS, SENSOR_RANGES, SKYWATCH, SUPPLY,
} from '../rules.js';
import {
  validateCampaign, TERRAINS, INFRA, NODE_TYPES, UNIT_CLASSES, EMCONS, POSTURES,
  ALERTS, DAMAGE_STATES, AMMO_STATES, WEATHERS, MARKER_KINDS, GROUND_ORDERS,
  AIR_ORDERS, SPACE_ORDERS, TRIGGER_WHENS,
} from '../campaign/schema.js';
import type { Contact, ContactReport, GroundPos, Order } from '../core/types.js';

/**
 * Per-side access token (M6): unguessable without the campaign seed (which only the GM
 * sees), stable across restarts so player links keep working — stops accidental peeking
 * at the other side's view without standing up real auth.
 */
function tokenFor(sideId: string): string {
  let out = '';
  for (let i = 0; i < 5; i++) {
    out += hashPick(campaign.truth.seed, ['access-v1', sideId, i], 36 ** 4)
      .toString(36).padStart(4, '0');
  }
  return out;
}

// CLI: `dev [fixture.json] [--log campaign.jsonl] [--gm-key passphrase]`
const argv = process.argv.slice(2);
const FLAGS = new Set(['--log', '--gm-key']);
const flagVal = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const logPath = flagVal('--log') ?? process.env.OVERRIDE_LOG;
// GM passphrase: when set, /gm /audit /editor and /api/gm/* require it (player links stay
// token-only). Unset ⇒ open, as before — fine for local play, risky when tunnelled.
const gmKey = flagVal('--gm-key') ?? process.env.OVERRIDE_GM_KEY;
const positional = argv.filter((a, i) => !FLAGS.has(a) && !FLAGS.has(argv[i - 1]));

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = positional[0] ?? process.env.OVERRIDE_CAMPAIGN
  ?? join(here, '../../demo/campaign.json');

const store = logPath ? new JsonlEventStore(logPath) : new MemoryEventStore();
// `campaign`/`activeLogPath` are reassigned when the GM loads another campaign at runtime
const boot = Campaign.resumeOrCreate(store, () => loadCampaignFixture(fixturePath));
let campaign = boot.campaign;
const resumed = boot.resumed;
let activeLogPath: string | undefined = logPath;
if (logPath) {
  console.log(resumed
    ? `Resumed campaign from ${logPath} (${store.length()} events, tick ${campaign.truth.tick})`
    : `New campaign in ${logPath} from ${fixturePath} (seed: ${campaign.truth.seed})`);
} else {
  console.log(`Campaign loaded from ${fixturePath} (in-memory; pass --log <file> to persist)`);
}

const wss = new WebSocketServer({ noServer: true });
const sockets = new Set<WebSocket>();

// ── the slow war (ext): Discord pings + a clock that runs itself ──
const webhookCfg = webhookConfigFromEnv(process.env, Object.keys(campaign.truth.sides));
let notifiedThrough = campaign.store.length(); // don't replay history into Discord on boot
function drainNotifications() {
  const all = campaign.store.all();
  if (all.length <= notifiedThrough) { notifiedThrough = all.length; return; }
  const fresh = all.slice(notifiedThrough);
  notifiedThrough = all.length;
  if (!webhookCfg.gm && Object.keys(webhookCfg.sides).length === 0) return;
  postWebhooks(webhookCfg, collectNotifications(campaign.truth, fresh));
}

// Autopace: every N real minutes the clock takes one step on its own, pausing while an
// engagement is frozen (battle night) or the campaign has ended. Players plot orders
// whenever they like; the war moves without the GM at the keyboard.
let autopaceMinutes = Number(process.env.OVERRIDE_AUTOPACE ?? 0) || 0;
let autopaceTimer: NodeJS.Timeout | null = null;
function setAutopace(minutes: number): void {
  autopaceMinutes = Math.max(0, minutes);
  if (autopaceTimer) { clearInterval(autopaceTimer); autopaceTimer = null; }
  if (autopaceMinutes > 0) {
    autopaceTimer = setInterval(() => {
      if (campaign.truth.pendingEngagementId || campaign.truth.ended) return;
      campaign.step();
      broadcast();
    }, autopaceMinutes * 60_000);
    autopaceTimer.unref?.();
  }
}
if (autopaceMinutes > 0) setAutopace(autopaceMinutes);

function broadcast() {
  for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.send('update');
  drainNotifications();
}

// ── D-054.1: the update beacon — packaged builds know their version (esbuild
// bakes __OVERRIDE_VERSION__ in at dist time); dev checkouts skip the check.
declare const __OVERRIDE_VERSION__: string | undefined;
const APP_VERSION = typeof __OVERRIDE_VERSION__ !== 'undefined' ? __OVERRIDE_VERSION__ : null;
const UPDATE_REPO = process.env.OVERRIDE_UPDATE_REPO ?? 'onlinemph/Override-campaign-';
let appUpdate: AppUpdate | null = null;
async function updateBeacon() {
  if (!APP_VERSION || process.env.OVERRIDE_NO_UPDATE_CHECK) return;
  const found = await checkLatestRelease(
    UPDATE_REPO, APP_VERSION, process.env.OVERRIDE_UPDATE_TOKEN);
  if (found && found.latest !== appUpdate?.latest) {
    appUpdate = found;
    console.log(`  ⬆ Update available: v${found.latest} (running v${found.current}).`);
    console.log('    Close the server and run the updater (Update OVERRIDE.bat / ./update.sh),');
    console.log(`    or download it yourself: ${found.url}`);
    broadcast();
  }
}
void updateBeacon();
setInterval(() => void updateBeacon(), 24 * 3600_000).unref?.();

function gmState() {
  const sides = Object.keys(campaign.truth.sides);
  const eng = campaign.pendingEngagement;
  return {
    truth: campaign.truth,
    views: Object.fromEntries(
      sides.map(s => [s, project(campaign.truth, s, campaign.truth.tick)])),
    eventLog: campaign.store.all().slice(-200),
    eventCount: campaign.store.length(),
    pendingEngagement: eng,
    salvage: Object.values(campaign.truth.salvage),
    persist: activeLogPath ? { path: activeLogPath, events: campaign.store.length() } : null,
    autopaceMinutes,
    webhooks: { gm: !!webhookCfg.gm, sides: Object.keys(webhookCfg.sides) },
    campaignName: campaign.truth.config.name,
    appVersion: APP_VERSION,
    appUpdate,
    netNodesBySide: Object.fromEntries(sides.map(s => [s,
      netNodesOf(campaign.truth, s).filter(n => !n.theaterWide)
        .map(n => ({ q: n.pos.q, r: n.pos.r, theaterId: n.pos.theaterId, radius: n.radius }))])),
    supplyHexesBySide: Object.fromEntries(sides.map(s => [s,
      Object.keys(campaign.truth.theaters).flatMap(th => supplyEnvelope(campaign.truth, s, th)
        .map(k => { const [q, r] = k.split(',').map(Number); return { q, r, theaterId: th }; }))])),
  };
}

/** Campaign files the GM can switch to: validated *.json in the fixture & demo dirs. */
function listCampaigns(): Array<{ path: string; name: string }> {
  const dirs = [dirname(fixturePath), join(here, '../../demo')];
  const out: Array<{ path: string; name: string }> = [];
  const seen = new Set<string>();
  for (const d of dirs) {
    let files: string[];
    try { files = readdirSync(d).filter(f => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      const p = resolve(d, f);
      if (seen.has(p)) continue;
      seen.add(p);
      try { out.push({ path: p, name: loadCampaignFixture(p, false).config.name }); }
      catch { /* not a valid campaign file — skip */ }
    }
  }
  return out;
}

function json(res: any, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ── GM access gate (only active when a gmKey is configured) ──────────────────
function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function gmAuthed(req: any): boolean {
  if (!gmKey) return true; // gate disabled
  const cookie = parseCookies(req.headers.cookie)['gmkey'];
  if (cookie && safeEq(cookie, gmKey)) return true;
  const hdr = req.headers['x-gm-key'];
  return typeof hdr === 'string' && safeEq(hdr, gmKey);
}
const GM_PAGES = new Set(['/', '/gm', '/audit', '/editor']);
const isGmRoute = (path: string) =>
  GM_PAGES.has(path) || path.startsWith('/api/gm/') || path.startsWith('/print/');
const LOGIN_HTML = `<!doctype html><meta charset="utf-8"><title>OVERRIDE — GM access</title>
<link rel="stylesheet" href="/ui/style.css"><body style="padding:48px;max-width:420px">
<h1>OVERRIDE — GM access</h1>
<form method="GET"><p class="kv">This screen is private. Enter the GM passphrase.</p>
<input name="key" type="password" autofocus style="padding:6px;min-width:240px">
<button>Enter</button></form>
<p class="kv" style="margin-top:14px">Players don't need this — they use their own tokenized link.</p>
</body>`;

function page(res: any, file: string) {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(readFileSync(join(here, '../ui', file)));
}

// ── The vendored card builder, served as the in-app battle tracker ──
// `npm run build:battle` compiles cards/ into cards/dist-web/ (the app + the
// bundled MegaMek unit library). We serve that tree verbatim under /battle/.
const BATTLE_ROOT = join(here, '../../cards/dist-web');
const BATTLE_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.zip': 'application/zip', '.mtf': 'text/plain; charset=utf-8',
  '.blk': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

function serveBattle(res: any, rel: string): void {
  const full = join(BATTLE_ROOT, rel);
  if (full !== BATTLE_ROOT && !full.startsWith(BATTLE_ROOT + sep)) {
    return json(res, 403, { error: 'forbidden' });
  }
  if (!existsSync(full) || statSync(full).isDirectory()) {
    if (rel === 'index.html') {
      res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(
        '<!doctype html><meta charset="utf-8"><title>Battle tracker not built</title>' +
        '<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.5">' +
        '<h1>Battle tracker not built yet</h1><p>Run <code>npm run build:battle</code> ' +
        'in the project root, then reload this page.</p></body>');
    }
    return json(res, 404, { error: 'not found' });
  }
  res.writeHead(200, { 'content-type': BATTLE_MIME[extname(full).toLowerCase()] ?? 'application/octet-stream' });
  res.end(readFileSync(full));
}

async function readBody(req: any): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  try {
    // GM access gate: protect truth surfaces; player links & assets stay open
    if (gmKey && isGmRoute(path) && !gmAuthed(req)) {
      const provided = url.searchParams.get('key');
      if (provided && safeEq(provided, gmKey)) {
        res.writeHead(302, {
          'set-cookie': `gmkey=${encodeURIComponent(gmKey)}; HttpOnly; Path=/; SameSite=Lax`,
          location: path,
        });
        return res.end();
      }
      if (path.startsWith('/api/gm/')) return json(res, 401, { error: 'GM passphrase required' });
      res.writeHead(401, { 'content-type': 'text/html' });
      return res.end(LOGIN_HTML);
    }

    // pages & static assets
    if (path === '/' || path === '/gm') return page(res, 'gm.html');
    if (path === '/manual') return page(res, 'manual.html'); // the field manual: public
    if (path === '/api/rules') {
      // read-only game constants for the manual (numbers stay true to rules.ts)
      return json(res, 200, {
        CLOCK, LADDER, RDY, SUPPLY, CAREER, FLAK, ATMO, RECON_TRICKS, COMBAT_DROP, NET,
        CAPITAL_WEAPONS, CAPITAL_TN_BY_BAND, SENSOR_RANGES, ARTILLERY_RANGE_HEXES, FIRES,
        SKYWATCH: { TURNAROUND_PULSES: SKYWATCH.TURNAROUND_PULSES,
                    HOT_PIT_PULSES: SKYWATCH.HOT_PIT_PULSES,
                    SPHEROID_ATMO_HEX_PER_TICK: SKYWATCH.SPHEROID_ATMO_HEX_PER_TICK,
                    CAS_ON_CALL: SKYWATCH.CAS_ON_CALL,
                    RADAR_HORIZON: SKYWATCH.RADAR_HORIZON,
                    FATIGUE_GROUNDED_AT: SKYWATCH.FATIGUE_GROUNDED_AT },
      });
    }
    if (path === '/audit') return page(res, 'audit.html');
    if (path === '/editor') return page(res, 'editor.html');
    // player page: /player/:sideId/:token (token validated client-side calls below)
    const playerPage = path.match(/^\/player\/([^/]+)(?:\/([^/]+))?$/);
    if (playerPage) {
      const sideId = playerPage[1], token = playerPage[2];
      if (!campaign.truth.sides[sideId]) {
        // D-054.2: links die when the GM switches scenarios (each campaign has its
        // own sides AND tokens) — say so instead of a bare JSON shrug
        const safe = sideId.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        return res.end('<body style="font:14px monospace;background:#0b0e13;color:#c8d0da;padding:40px">' +
          `<h2>No side “${safe}” in the current campaign</h2>` +
          `<p>The GM is running <b>${campaign.truth.config.name.replace(/[&<>]/g, '')}</b>, ` +
          'which has different sides. Links change whenever the campaign changes — ' +
          'ask the GM for your new link (their screen lists them under <b>Player links</b>).</p></body>');
      }
      if (token !== tokenFor(sideId)) {
        res.writeHead(403, { 'content-type': 'text/html' });
        return res.end('<body style="font:14px monospace;background:#0b0e13;color:#c8d0da;padding:40px">' +
          '<h2>Access token required</h2><p>Ask the GM for your side\'s link — ' +
          'it looks like <code>/player/' + sideId + '/&lt;token&gt;</code>.</p></body>');
      }
      return page(res, 'player.html');
    }
    const asset = path.match(/^\/ui\/([\w.-]+\.(js|css))$/);
    if (asset) {
      res.writeHead(200, { 'content-type': asset[2] === 'css' ? 'text/css' : 'text/javascript' });
      return res.end(readFileSync(join(here, '../ui', asset[1])));
    }
    // The card builder battle tracker (vendored under cards/, built to dist-web/).
    // Trailing slash matters: the app uses relative asset URLs (./units/…).
    if (path === '/battle') { res.writeHead(302, { location: '/battle/' }); return res.end(); }
    if (path === '/battle/') return serveBattle(res, 'index.html');
    if (path.startsWith('/battle/')) return serveBattle(res, decodeURIComponent(path.slice('/battle/'.length)));

    // GM API
    if (path === '/api/gm/state') return json(res, 200, gmState());
    if (path === '/api/gm/advance' && req.method === 'POST') {
      const body = await readBody(req);
      const events = body.untilEvent
        ? campaign.runUntilEvent(body.maxTicks ?? 240)
        : campaign.step(body.fine ? 'CONTACT' : undefined);
      broadcast();
      return json(res, 200, { tick: campaign.truth.tick, events: events.length });
    }
    if (path === '/api/gm/autopace' && req.method === 'POST') {
      const b = await readBody(req);
      setAutopace(Number(b.minutes) || 0);
      broadcast();
      return json(res, 200, { ok: true, autopaceMinutes });
    }
    if (path === '/api/gm/recall' && req.method === 'POST') {
      // GM courier: order a stranded formation back to its nearest command node, bypassing
      // the on-net gate (this is the "send a runner" rescue for an out-of-range unit)
      const b = await readBody(req);
      const t = campaign.truth;
      const f = t.formations[b.formationId];
      if (!f || f.destroyed || f.pos.kind !== 'ground') return json(res, 200, { ok: false, reason: 'no such ground formation' });
      const here = f.pos as GroundPos;
      const nodes = netNodesOf(t, f.sideId)
        .filter(n => !n.theaterWide && n.pos.theaterId === here.theaterId && n.id !== f.id);
      if (!nodes.length) return json(res, 200, { ok: false, reason: 'no command node to recall toward' });
      const hd = (a: GroundPos, c: GroundPos) => { const dq = a.q - c.q, dr = a.r - c.r; return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2; };
      let best = nodes[0];
      for (const n of nodes) if (hd(here, n.pos) < hd(here, best.pos)) best = n;
      // D-043: the courier ROUTES home — around the range, over the bridge — instead of
      // marching a straight line into whatever terrain is in the way
      const route = findRoute(campaign.truth, f, { q: best.pos.q, r: best.pos.r });
      if (!route) return json(res, 200, { ok: false, reason: 'no route back to the net for this formation' });
      const order: Order = {
        id: `recall:${b.formationId}:${t.tick}`, sideId: f.sideId, formationId: b.formationId,
        kind: 'MOVE', path: route.path,
        emconOverride: 'PASSIVE', conditionals: [], issuedTick: t.tick, effectiveTick: t.tick + 1,
      };
      campaign.inject({ type: 'ORDER_ISSUED', order });
      broadcast();
      return json(res, 200, { ok: true, toward: `${best.pos.q},${best.pos.r}` });
    }
    if (path === '/api/gm/undo' && req.method === 'POST') {
      const r = campaign.rewindOneStep();
      if (r) broadcast();
      return json(res, 200, r ? { ok: true, tick: r.tick } : { ok: false, reason: 'nothing to undo' });
    }
    // Rewind (D-035): the aimed undo. Preview first, then truncate-and-replay.
    if (path === '/api/gm/rewind-preview') {
      const tick = Number(url.searchParams.get('tick'));
      if (!Number.isFinite(tick)) return json(res, 400, { error: 'tick required' });
      return json(res, 200, campaign.previewRewind(tick) ?? { dropped: 0, notable: [] });
    }
    if (path === '/api/gm/rewind' && req.method === 'POST') {
      const b = await readBody(req);
      const tick = Number(b.tick);
      if (!Number.isFinite(tick)) return json(res, 400, { ok: false, reason: 'tick required' });
      const r = campaign.rewindToTick(tick);
      if (r) broadcast();
      return json(res, 200, r ? { ok: true, ...r }
        : { ok: false, reason: 'the clock never passed that tick — nothing to rewind' });
    }
    if (path === '/api/gm/campaigns' && req.method === 'GET') {
      return json(res, 200, { campaigns: listCampaigns(), current: fixturePath });
    }
    if (path === '/api/gm/spawn' && req.method === 'POST') {
      // GM reinforcement: drop a new formation into the running campaign (logged, replay-safe)
      const b = await readBody(req);
      try {
        const t = campaign.truth;
        const id = String(b.id || `reinf:${t.tick}:${Date.now().toString(36)}`);
        if (t.formations[id]) throw new Error(`formation id "${id}" already exists`);
        if (!t.sides[b.sideId]) throw new Error(`unknown side "${b.sideId}"`);
        const theater = t.theaters[b.theaterId];
        if (!theater) throw new Error(`unknown theater "${b.theaterId}"`);
        const q = Number(b.q), r = Number(b.r);
        if (!theater.hexes[`${q},${r}`]) throw new Error(`hex ${q},${r} is outside theater "${b.theaterId}"`);
        const units = Array.isArray(b.units) ? b.units : [];
        if (!units.length) throw new Error('needs at least one unit');
        for (const u of units) {
          if (!u.name) throw new Error('every unit needs a name');
          if (!UNIT_CLASSES.includes(u.class)) throw new Error(`bad unit class "${u.class}" (one of ${UNIT_CLASSES.join(', ')})`);
        }
        const spec = { id, sideId: b.sideId, name: b.name || 'Reinforcement',
          theaterId: b.theaterId, q, r,
          sigBase: Number(b.sigBase ?? 7), omp: Number(b.omp ?? 4),
          emcon: EMCONS.includes(b.emcon) ? b.emcon : 'PASSIVE', units };
        const { formation, units: built, pilots, jumpDrives } = buildFormationEntities(spec);
        // Fill movement / class / EW gear from each unit's model before the spawn is
        // logged, so reinforcements get the same record-sheet treatment as the initial
        // force (explicit spec values still win).
        for (const u of built) enrichUnit(u);
        campaign.spawnFormation(formation, built, pilots, jumpDrives);
        broadcast();
        return json(res, 200, { ok: true, id, name: spec.name, units: built.length });
      } catch (e: any) {
        return json(res, 200, { ok: false, reason: String(e?.message ?? e).slice(0, 300) });
      }
    }
    if (path === '/api/gm/load' && req.method === 'POST') {
      const b = await readBody(req);
      try {
        const truth = loadCampaignFixture(String(b.path));
        campaign = Campaign.create(truth);          // fresh in-memory session
        activeLogPath = undefined;                  // not persisted unless restarted with --log
        broadcast();
        // D-054.2: sides AND tokens just changed — hand the GM the new links
        console.log(`\nCampaign switched to "${truth.config.name}" — the player links have CHANGED:`);
        printLinks();
        return json(res, 200, { ok: true, name: truth.config.name });
      } catch (e: any) {
        return json(res, 200, { ok: false, reason: String(e?.message ?? e).slice(0, 400) });
      }
    }
    // ── Campaign generator ──
    if (path === '/api/gm/generate' && req.method === 'POST') {
      const b = await readBody(req);
      const camp = generateCampaign({
        name: b.name, seed: b.seed,
        // continental maps (D-037/D-040): the canvas renderer carries up to 300×300
        width: Math.max(4, Math.min(300, Number(b.width) || 20)),
        height: Math.max(4, Math.min(300, Number(b.height) || 14)),
        sides: Array.isArray(b.sides) ? b.sides : undefined,
      });
      return json(res, 200, { campaign: camp });
    }
    if (path === '/api/gm/roll-force' && req.method === 'POST') {
      const b = await readBody(req);
      const units = rollForce({
        count: Math.max(1, Math.min(24, Number(b.count) || 4)),
        seed: b.seed, classes: b.classes, era: b.era, weight: b.weight,
        minBv: b.minBv, maxBv: b.maxBv,
      });
      return json(res, 200, { units });
    }
    if (path === '/api/gm/import-force' && req.method === 'POST') {
      const b = await readBody(req);
      return json(res, 200, { units: campaignUnitsFromForce(b.force) });
    }
    if (path === '/api/gm/start' && req.method === 'POST') {
      const b = await readBody(req);
      try {
        const truth = buildCampaign(b.campaign, 'generated campaign'); // validates + enriches
        campaign = Campaign.create(truth);
        activeLogPath = undefined;
        broadcast();
        return json(res, 200, { ok: true, name: truth.config.name });
      } catch (e: any) {
        return json(res, 200, { ok: false, reason: String(e?.message ?? e).slice(0, 400) });
      }
    }
    if (path === '/api/gm/inject-report' && req.method === 'POST') {
      // GM noise injection: a hand-written report straight into a side's inbox
      const b = await readBody(req);
      const id = `gm-report:${campaign.truth.tick}:${Date.now()}`;
      campaign.inject({ type: 'REPORT_QUEUED', report: {
        id, sideId: b.sideId, generatedTick: b.generatedTick ?? campaign.truth.tick,
        deliveredTick: null, sourceFormationId: b.sourceFormationId ?? 'gm',
        contactId: b.contactId ?? '', text: b.text,
        snapshot: { level: 1, estPos: b.estPos ?? { kind: 'ground', theaterId: '', q: 0, r: 0 },
                    posErrorHexes: 1, asOfTick: b.generatedTick ?? campaign.truth.tick },
      } });
      campaign.inject({ type: 'REPORT_DELIVERED', reportId: id, tick: campaign.truth.tick });
      broadcast();
      return json(res, 200, { ok: true });
    }
    if (path === '/api/gm/destroy' && req.method === 'POST') {
      const b = await readBody(req);
      campaign.destroyFormation(b.formationId, b.reason ?? 'GM ruling');
      broadcast();
      return json(res, 200, { ok: true });
    }

    // ── M2: engagement resolution ──
    if (path === '/api/gm/evade' && req.method === 'POST') {
      const b = await readBody(req);
      const slipTo = b.slipTo
        ? { kind: 'ground' as const, theaterId: campaign.pendingEngagement?.hex?.theaterId ?? '',
            q: b.slipTo.q, r: b.slipTo.r }
        : undefined;
      const result = campaign.resolveEvasion(slipTo);
      broadcast();
      return json(res, 200, result);
    }
    if (path === '/api/gm/export-handoff' && req.method === 'POST') {
      const pkg = campaign.exportHandoff();
      broadcast();
      return pkg ? json(res, 200, pkg) : json(res, 400, { error: 'no pending engagement' });
    }
    if (path === '/api/gm/battle-result' && req.method === 'POST') {
      const result = await readBody(req);
      const r = campaign.ingestBattleResult(result);
      broadcast();
      return json(res, r.ok ? 200 : 400, r);
    }
    if (path === '/api/gm/salvage' && req.method === 'POST') {
      const b = await readBody(req);
      const r = campaign.resolveSalvage(b.tokenId);
      broadcast();
      return json(res, 'error' in r ? 400 : 200, r);
    }

    // ── M5: noise editor, phantom contacts, the audit viewer, MegaMek export ──
    if (path === '/api/gm/report-edit' && req.method === 'POST') {
      const b = await readBody(req);
      const r = campaign.truth.reports[b.reportId];
      if (!r) return json(res, 400, { ok: false, reason: 'no such report' });
      if (r.deliveredTick !== null) return json(res, 400, { ok: false, reason: 'already delivered' });
      campaign.inject({ type: 'REPORT_EDITED', reportId: b.reportId, text: String(b.text ?? '') });
      broadcast();
      return json(res, 200, { ok: true });
    }
    if (path === '/api/gm/inject-contact' && req.method === 'POST') {
      // a phantom on the player map: false positive, migrating fauna, chaff (core §6.6)
      const b = await readBody(req);
      const theaterId = Object.keys(campaign.truth.theaters)[0];
      const id = `phantom:${b.sideId}:${campaign.truth.tick}:${b.q},${b.r}`;
      const level = Math.max(1, Math.min(3, Number(b.level) || 1)) as 1 | 2 | 3;
      const estPos: GroundPos = { kind: 'ground', theaterId, q: Number(b.q), r: Number(b.r) };
      const snapshot = {
        level, estPos, posErrorHexes: level === 1 ? 1 : 0,
        ...(level >= 2 ? { estSizeClass: b.sizeClass || 'unknown' } : {}),
        ...(level >= 3 && b.composition ? { estComposition: b.composition } : {}),
        asOfTick: campaign.truth.tick,
      };
      const contact: Contact = {
        id, observerSideId: b.sideId, targetFormationId: id, kind: 'STANDARD',
        level, lastConfirmedTick: campaign.truth.tick, lastFadeTick: campaign.truth.tick,
        estPos, posErrorHexes: snapshot.posErrorHexes, staleAsOfTick: campaign.truth.tick,
        delivered: snapshot,
      };
      const report: ContactReport = {
        id: `report:${id}`, sideId: b.sideId, generatedTick: campaign.truth.tick,
        deliveredTick: null, sourceFormationId: 'gm', contactId: id,
        text: b.text || `T+${campaign.truth.tick} — sensor anomaly, ` +
          `${b.sizeClass ? b.sizeClass + '-strength ' : ''}return at hex ${b.q},${b.r}`,
        snapshot,
      };
      campaign.inject({ type: 'CONTACT_UPGRADED', contact, tick: campaign.truth.tick });
      campaign.inject({ type: 'REPORT_QUEUED', report });
      campaign.inject({ type: 'REPORT_DELIVERED', reportId: report.id, tick: campaign.truth.tick });
      broadcast();
      return json(res, 200, { ok: true, contactId: id });
    }
    if (path === '/api/gm/audit') {
      // the victory lap: truth as of event N, replayed from the log
      const all = campaign.store.all();
      const n = Math.max(0, Math.min(all.length - 1, Number(url.searchParams.get('index') ?? all.length - 1)));
      const truthAt = replay(all.slice(0, n + 1));
      const lo = Math.max(0, n - 14);
      return json(res, 200, {
        eventCount: all.length, index: n, truth: truthAt,
        window: all.slice(lo, Math.min(all.length, n + 6)),
      });
    }
    const mul = path.match(/^\/api\/gm\/handoff\/([^/]+)\/mul\/([^/]+)$/);
    if (mul) {
      const pkg = campaign.truth.handoffs[decodeURIComponent(mul[1])];
      if (!pkg) return json(res, 404, { error: 'no such handoff' });
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(buildMul(campaign.truth, pkg, mul[2]));
    }
    // Editor unit picker: search the bundled library by name (derived class + BV).
    if (path === '/api/gm/units/search') {
      return json(res, 200, { units: searchLibrary(url.searchParams.get('q') ?? '') });
    }
    // Battle roster for the card builder: model names + pilot skills + setup per side.
    const battleApi = path.match(/^\/api\/gm\/handoff\/([^/]+)\/battle$/);
    if (battleApi) {
      const pkg = campaign.truth.handoffs[decodeURIComponent(battleApi[1])];
      if (!pkg) return json(res, 404, { error: 'no such handoff' });
      return json(res, 200, buildBattleRoster(campaign.truth, pkg));
    }
    // The paper bridge (D-034): the same roster as a printable battle pack + result form.
    const printPack = path.match(/^\/print\/handoff\/([^/]+)$/);
    if (printPack) {
      const pkg = campaign.truth.handoffs[decodeURIComponent(printPack[1])];
      if (!pkg) return json(res, 404, { error: 'no such handoff' });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(buildBattlePack(buildBattleRoster(campaign.truth, pkg),
                                     campaign.truth.config.name));
    }

    // ── M3: the air board ──
    if (path === '/api/gm/alert' && req.method === 'POST') {
      const b = await readBody(req);
      const r = campaign.setAlertState(b.formationId, b.state);
      broadcast();
      return json(res, r.ok ? 200 : 400, r);
    }
    if (path === '/api/gm/turnaround' && req.method === 'POST') {
      const b = await readBody(req);
      const r = campaign.turnaround(b.formationId, b.mode ?? 'STANDARD');
      broadcast();
      return json(res, r.ok ? 200 : 400, r);
    }
    if (path === '/api/gm/reposition-air' && req.method === 'POST') {
      const b = await readBody(req);
      const r = campaign.repositionAir(b.formationId, b.q, b.r, b.vectorDeg ?? 0);
      broadcast();
      return json(res, r.ok ? 200 : 400, r);
    }

    // ── M8: combined-arms actions ──
    if (path === '/api/gm/drop' && req.method === 'POST') {
      const b = await readBody(req);
      const theaterId = b.theaterId ?? Object.keys(campaign.truth.theaters)[0];
      const r = campaign.combatDrop(b.carrierId, b.payloadId,
        { kind: 'ground', theaterId, q: Number(b.q), r: Number(b.r) });
      broadcast();
      return json(res, r.ok ? 200 : 400, r);
    }
    if (path === '/api/gm/inspect' && req.method === 'POST') {
      const b = await readBody(req);
      const r = campaign.inspectTransponder(b.targetId, b.bySideId);
      broadcast();
      return json(res, r.ok ? 200 : 400, r);
    }
    if (path === '/api/gm/sar' && req.method === 'POST') {
      const b = await readBody(req);
      const r = campaign.recoverDownedCrew(b.recovererId, b.markerId);
      broadcast();
      return json(res, r.ok ? 200 : 400, r);
    }
    if (path === '/api/gm/tanker' && req.method === 'POST') {
      const b = await readBody(req);
      const r = campaign.transferFuel(b.tankerId, b.receiverId, Number(b.tons));
      broadcast();
      return json(res, r.ok ? 200 : 400, r);
    }

    // ── carrier ops: embark / disembark / launch / recover / rearm (ext) ──
    if (path === '/api/gm/embark' && req.method === 'POST') {
      const b = await readBody(req);
      const r = campaign.embark(b.carrierId, b.payloadId);
      broadcast();
      return json(res, r.ok ? 200 : 400, r);
    }
    if (path === '/api/gm/disembark' && req.method === 'POST') {
      const b = await readBody(req);
      const target = (b.q != null && b.r != null)
        ? { kind: 'ground' as const, theaterId: b.theaterId ??
              (campaign.truth.formations[b.payloadId]?.pos.kind === 'ground'
                ? (campaign.truth.formations[b.payloadId]!.pos as GroundPos).theaterId
                : Object.keys(campaign.truth.theaters)[0]),
            q: Number(b.q), r: Number(b.r) }
        : undefined;
      const r = campaign.disembark(b.payloadId, target);
      broadcast();
      return json(res, r.ok ? 200 : 400, r);
    }
    if (path === '/api/gm/launch' && req.method === 'POST') {
      const b = await readBody(req);
      const r = campaign.launchFromCarrier(b.carrierId, b.flightId);
      broadcast();
      return json(res, r.ok ? 200 : 400, r);
    }
    if (path === '/api/gm/recover' && req.method === 'POST') {
      const b = await readBody(req);
      const r = campaign.recoverToCarrier(b.carrierId, b.flightId);
      broadcast();
      return json(res, r.ok ? 200 : 400, r);
    }
    if (path === '/api/gm/carrier-rearm' && req.method === 'POST') {
      const b = await readBody(req);
      const r = campaign.carrierRearm(b.carrierId, b.flightId);
      broadcast();
      return json(res, r.ok ? 200 : 400, r);
    }

    // ── the career loop: repairs & refits (ext) ──
    if (path === '/api/gm/repair' && req.method === 'POST') {
      const b = await readBody(req);
      const r = campaign.repairUnit(b.unitId);
      broadcast();
      return json(res, r.ok ? 200 : 400, r);
    }
    if (path === '/api/gm/refit' && req.method === 'POST') {
      const b = await readBody(req);
      const r = campaign.startRefit(b.refitId, b.facilityId, b.formationId);
      broadcast();
      return json(res, r.ok ? 200 : 400, r);
    }

    // player API — gated by the per-side token (?t=<token>)
    const sideView = path.match(/^\/api\/side\/([^/]+)\/view$/);
    if (sideView) {
      const sideId = sideView[1];
      if (!campaign.truth.sides[sideId]) return json(res, 404, { error: 'no such side' });
      if (url.searchParams.get('t') !== tokenFor(sideId)) return json(res, 403, { error: 'bad token' });
      return json(res, 200, project(campaign.truth, sideId, campaign.truth.tick));
    }
    // Auto-route (D-041): best-known route + ETA for one of the side's formations.
    // Fog-safe: the router only trusts hexes this side has scouted.
    const sideRoute = path.match(/^\/api\/side\/([^/]+)\/route$/);
    if (sideRoute) {
      const sideId = sideRoute[1];
      if (!campaign.truth.sides[sideId]) return json(res, 404, { error: 'no such side' });
      if (url.searchParams.get('t') !== tokenFor(sideId)) return json(res, 403, { error: 'bad token' });
      const f = campaign.truth.formations[String(url.searchParams.get('formationId'))];
      if (!f || f.sideId !== sideId) return json(res, 400, { error: 'not your formation' });
      // D-049: fromQ/fromR route a plan's later step from the previous step's end
      const fromQ = url.searchParams.get('fromQ'), fromR = url.searchParams.get('fromR');
      const route = findRoute(campaign.truth, f,
        { q: Number(url.searchParams.get('q')), r: Number(url.searchParams.get('r')) }, sideId,
        fromQ !== null && fromR !== null ? { q: Number(fromQ), r: Number(fromR) } : undefined);
      if (!route) return json(res, 200, { path: [], etaTicks: 0 });
      return json(res, 200, { path: route.path.map(p => ({ q: p.q, r: p.r })),
                              etaTicks: route.etaTicks });
    }
    const sideDiary = path.match(/^\/api\/side\/([^/]+)\/diary$/);
    if (sideDiary) {
      const sideId = sideDiary[1];
      if (!campaign.truth.sides[sideId]) return json(res, 404, { error: 'no such side' });
      if (url.searchParams.get('t') !== tokenFor(sideId)) return json(res, 403, { error: 'bad token' });
      return json(res, 200, { entries: buildDiary(campaign.truth, campaign.store.all(), sideId) });
    }
    const sideOrder = path.match(/^\/api\/side\/([^/]+)\/order$/);
    if (sideOrder && req.method === 'POST') {
      const b = await readBody(req);
      const sideId = sideOrder[1];
      if (url.searchParams.get('t') !== tokenFor(sideId)) return json(res, 403, { ok: false, reason: 'bad token' });
      const f = campaign.truth.formations[b.formationId];
      if (!f || f.sideId !== sideId) return json(res, 400, { ok: false, reason: 'not your formation' });
      const theaterId = f.pos.kind === 'ground' ? f.pos.theaterId : '';
      const toPath = (pts: { q: number; r: number }[] = []): GroundPos[] =>
        pts.map(p => ({ kind: 'ground', theaterId, q: p.q, r: p.r }));
      // D-056: map clicks are GROUND hexes, but the air engine only follows AIR
      // waypoints — an air mission's route must be lifted onto the air grid, or
      // the flight sees an empty path, completes instantly, and turns home
      // (this is why player-issued RECON/FERRY routes never flew).
      const airTheater = theaterId || Object.keys(campaign.truth.theaters)[0];
      const toAirPath = (pts: { q: number; r: number }[] = []) =>
        pts.map(p => {
          const over = airHexOver(campaign.truth,
            { theaterId: airTheater, q: Number(p.q), r: Number(p.r) });
          return { kind: 'air' as const, gridQ: over.q, gridR: over.r,
                   band: 'HIGH' as const, altLevel: 6, velocity: 0, vectorDeg: 0 };
        });
      // optional single conditional: { when, param, kind, path }
      const conditionals = b.conditional ? [{
        trigger: { when: b.conditional.when, param: b.conditional.param },
        thenOrder: {
          id: 'ph', sideId, formationId: b.formationId, issuedTick: 0, effectiveTick: 0,
          kind: b.conditional.kind,
          ...(b.conditional.path ? { path: toPath(b.conditional.path) } : {}),
          ...(b.conditional.targetHex ? { targetHex: { kind: 'ground' as const,
            theaterId: b.conditional.targetHex.theaterId || theaterId,
            q: Number(b.conditional.targetHex.q), r: Number(b.conditional.targetHex.r) } } : {}),
          ...(b.conditional.targetContactId ? { targetContactId: b.conditional.targetContactId } : {}),
          ...(b.conditional.emconOverride ? { emconOverride: b.conditional.emconOverride } : {}),
        } as Order,
      }] : [];
      // M3: air-mission extras — a station on the high-altitude grid, speed, loiter
      const airStation = b.station
        ? { kind: 'air' as const, gridQ: b.station.q, gridR: b.station.r,
            band: (b.station.band ?? 'HIGH') as 'HIGH', altLevel: 6, velocity: 0, vectorDeg: 0 }
        : undefined;
      const order: Order = {
        id: `order:${sideId}:${campaign.truth.tick}:${b.formationId}`,
        sideId, formationId: b.formationId,
        issuedTick: campaign.truth.tick, effectiveTick: campaign.truth.tick + 1,
        kind: b.kind,
        path: AIR_MISSIONS.has(b.kind) ? toAirPath(b.path) : toPath(b.path),
        conditionals,
        ...(b.targetContactId ? { targetContactId: b.targetContactId } : {}),
        ...(b.emconOverride ? { emconOverride: b.emconOverride } : {}),
        ...(airStation ? { station: airStation } : {}),
        ...(b.airSpeed ? { airSpeed: b.airSpeed } : {}),
        ...(b.loiterTicks !== undefined ? { loiterTicks: Number(b.loiterTicks) } : {}),
        // ext: carrier ops — EMBARK's carrier, LAND/DISEMBARK's hex
        ...(b.targetFormationId ? { targetFormationId: b.targetFormationId } : {}),
        ...(b.targetHex ? { targetHex: {
          kind: 'ground' as const,
          theaterId: b.targetHex.theaterId || theaterId || Object.keys(campaign.truth.theaters)[0],
          q: Number(b.targetHex.q), r: Number(b.targetHex.r) } } : {}),
      };
      const result = campaign.issueOrder(order);
      if (result.ok) broadcast();
      return json(res, result.ok ? 200 : 400, result);
    }

    // ── D-049: a PLAN — a queue of steps executed in sequence ──
    const sidePlan = path.match(/^\/api\/side\/([^/]+)\/plan$/);
    if (sidePlan && req.method === 'POST') {
      const b = await readBody(req);
      const sideId = sidePlan[1];
      if (url.searchParams.get('t') !== tokenFor(sideId)) return json(res, 403, { ok: false, reason: 'bad token' });
      const f = campaign.truth.formations[b.formationId];
      if (!f || f.sideId !== sideId) return json(res, 400, { ok: false, reason: 'not your formation' });
      if (!Array.isArray(b.steps) || !b.steps.length) return json(res, 400, { ok: false, reason: 'empty plan' });
      const theaterId = f.pos.kind === 'ground' ? f.pos.theaterId : '';
      const toPath = (pts: { q: number; r: number }[] = []): GroundPos[] =>
        pts.map(p => ({ kind: 'ground', theaterId, q: p.q, r: p.r }));
      const tick = campaign.truth.tick;
      const orders: Order[] = b.steps.map((st: any, i: number) => ({
        id: `plan:${sideId}:${tick}:${b.formationId}:${i}`,
        sideId, formationId: b.formationId, issuedTick: tick, effectiveTick: tick + 1,
        kind: st.kind,
        path: toPath(st.path),
        conditionals: [],
        ...(st.targetContactId ? { targetContactId: st.targetContactId } : {}),
        ...(st.targetFormationId ? { targetFormationId: st.targetFormationId } : {}),
        ...(st.emconOverride ? { emconOverride: st.emconOverride } : {}),
        ...(st.airSpeed ? { airSpeed: st.airSpeed } : {}),
        ...(st.loiterTicks !== undefined ? { loiterTicks: Number(st.loiterTicks) } : {}),
        ...(st.targetHex ? { targetHex: { kind: 'ground' as const,
          theaterId: st.targetHex.theaterId || theaterId || Object.keys(campaign.truth.theaters)[0],
          q: Number(st.targetHex.q), r: Number(st.targetHex.r) } } : {}),
      }));
      const result = campaign.issuePlan(orders);
      if (result.ok) broadcast();
      return json(res, result.ok ? 200 : 400, result);
    }

    // ── D-049: standing rules — replace the formation's if-then reflexes ──
    const sideRules = path.match(/^\/api\/side\/([^/]+)\/rules$/);
    if (sideRules && req.method === 'POST') {
      const b = await readBody(req);
      const sideId = sideRules[1];
      if (url.searchParams.get('t') !== tokenFor(sideId)) return json(res, 403, { ok: false, reason: 'bad token' });
      const f = campaign.truth.formations[b.formationId];
      if (!f || f.sideId !== sideId) return json(res, 400, { ok: false, reason: 'not your formation' });
      if (!Array.isArray(b.rules)) return json(res, 400, { ok: false, reason: 'rules must be an array' });
      const theaterId = f.pos.kind === 'ground' ? f.pos.theaterId : '';
      const rules = b.rules.map((r: any) => ({
        trigger: { when: r.when, param: r.param },
        thenOrder: {
          id: 'ph', sideId, formationId: b.formationId, issuedTick: 0, effectiveTick: 0,
          kind: r.then.kind,
          ...(r.then.path ? { path: r.then.path.map((p: any) =>
            ({ kind: 'ground' as const, theaterId, q: p.q, r: p.r })) } : {}),
          ...(r.then.targetHex ? { targetHex: { kind: 'ground' as const,
            theaterId: r.then.targetHex.theaterId || theaterId,
            q: Number(r.then.targetHex.q), r: Number(r.then.targetHex.r) } } : {}),
          ...(r.then.targetContactId ? { targetContactId: r.then.targetContactId } : {}),
          ...(r.then.emconOverride ? { emconOverride: r.then.emconOverride } : {}),
        } as Order,
        ...(r.repeat ? { repeat: true } : {}),
      }));
      const result = campaign.setRules(b.formationId, rules);
      if (result.ok) broadcast();
      return json(res, result.ok ? 200 : 400, result);
    }

    // ── campaign editor: shared vocab, live validation, a starting template ──
    if (path === '/api/schema') {
      return json(res, 200, {
        terrains: TERRAINS, infra: INFRA, nodeTypes: NODE_TYPES, unitClasses: UNIT_CLASSES,
        emcons: EMCONS, postures: POSTURES, alerts: ALERTS, damage: DAMAGE_STATES,
        ammo: AMMO_STATES, weathers: WEATHERS, markerKinds: MARKER_KINDS,
        groundOrders: GROUND_ORDERS, airOrders: AIR_ORDERS, spaceOrders: SPACE_ORDERS,
        triggerWhens: TRIGGER_WHENS,
      });
    }
    if (path === '/api/validate' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, { problems: validateCampaign(body) });
    }
    if (path === '/api/editor/template') {
      // the shipped demo, as a starting point to remix
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(readFileSync(join(here, '../../demo/campaign.json')));
    }

    // GM: the shareable per-side player links (token included)
    if (path === '/api/gm/links') {
      return json(res, 200, Object.keys(campaign.truth.sides).map(s =>
        ({ sideId: s, name: campaign.truth.sides[s].name,
           url: `/player/${s}/${tokenFor(s)}` })));
    }

    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, 500, { error: String(err) });
  }
});

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => {
    sockets.add(ws);
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    ws.on('pong', () => { (ws as WebSocket & { isAlive?: boolean }).isAlive = true; });
    ws.on('close', () => sockets.delete(ws));
  });
});

// D-058: heartbeat — home routers silently drop idle NAT entries, leaving sockets
// half-open: the client thinks it's connected but hears nothing, so live updates
// stop until F5. Protocol pings keep the path warm; a peer that misses a pong is
// terminated, which fires 'close' on the browser and its reconnect logic takes over.
setInterval(() => {
  for (const ws of sockets) {
    const w = ws as WebSocket & { isAlive?: boolean };
    if (w.isAlive === false) { w.terminate(); sockets.delete(ws); continue; }
    w.isAlive = false;
    try { w.ping(); } catch { /* mid-close race — the close handler cleans up */ }
  }
}, 30_000).unref?.();

const PORT = Number(process.env.PORT ?? 8420);
function printLinks() {
  // D-054: the shareable-links banner — hosting for friends means handing out URLs
  // that work from THEIR machines, so lead with the LAN address, not localhost.
  const lanIps = Object.values(networkInterfaces()).flat()
    .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
  const host = lanIps[0] ?? 'localhost';
  const sides = Object.keys(campaign.truth.sides);
  console.log('');
  console.log('  ┌─ OVERRIDE GM Tool ──────────────────────────────────────────');
  console.log(`  │ GM screen   http://${host}:${PORT}/gm`);
  for (const s of sides) {
    console.log(`  │ ${(campaign.truth.sides[s].name + ' '.repeat(11)).slice(0, 11)} http://${host}:${PORT}/player/${s}/${tokenFor(s)}`);
  }
  console.log('  │');
  console.log(`  │ ${gmKey
    ? 'GM screen is passphrase-protected (--gm-key set) ✓'
    : '⚠ GM screen is OPEN — fine on your own wifi; set a --gm-key'}`);
  if (!gmKey) console.log('  │   (or OVERRIDE_GM_KEY) before exposing it to the internet.');
  console.log(`  │ Player links carry their own access tokens — share each side's`);
  console.log(`  │ link with that side ONLY. See HOSTING.md for playing over the`);
  console.log(`  │ internet (Tailscale / tunnels / port forwarding).`);
  if (lanIps.length > 1) {
    console.log(`  │ Other addresses on this machine: ${lanIps.slice(1).join(', ')}`);
  }
  console.log('  └─────────────────────────────────────────────────────────────');
}
server.listen(PORT, printLinks);
