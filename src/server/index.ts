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
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Campaign, replay } from '../core/truth.js';
import { JsonlEventStore, MemoryEventStore } from '../core/log.js';
import { project } from '../projection/project.js';
import { loadCampaignFixture, buildFormationEntities } from '../demo.js';
import { buildMul } from '../handoff/mul.js';
import { hashPick } from '../core/rng.js';
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

// CLI: `dev [fixture.json] [--log campaign.jsonl]`
const argv = process.argv.slice(2);
const logIdx = argv.indexOf('--log');
const logPath = logIdx >= 0 ? argv[logIdx + 1] : process.env.OVERRIDE_LOG;
const positional = argv.filter((a, i) => a !== '--log' && argv[i - 1] !== '--log');

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = positional[0] ?? join(here, '../../demo/campaign.json');

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
function broadcast() {
  for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.send('update');
}

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
    campaignName: campaign.truth.config.name,
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
      try { out.push({ path: p, name: loadCampaignFixture(p).config.name }); }
      catch { /* not a valid campaign file — skip */ }
    }
  }
  return out;
}

function json(res: any, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function page(res: any, file: string) {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(readFileSync(join(here, '../ui', file)));
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
    // pages & static assets
    if (path === '/' || path === '/gm') return page(res, 'gm.html');
    if (path === '/audit') return page(res, 'audit.html');
    if (path === '/editor') return page(res, 'editor.html');
    // player page: /player/:sideId/:token (token validated client-side calls below)
    const playerPage = path.match(/^\/player\/([^/]+)(?:\/([^/]+))?$/);
    if (playerPage) {
      const sideId = playerPage[1], token = playerPage[2];
      if (!campaign.truth.sides[sideId]) return json(res, 404, { error: 'no such side' });
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

    // GM API
    if (path === '/api/gm/state') return json(res, 200, gmState());
    if (path === '/api/gm/advance' && req.method === 'POST') {
      const body = await readBody(req);
      const events = body.untilEvent
        ? campaign.runUntilEvent(body.maxTicks ?? 240)
        : campaign.step();
      broadcast();
      return json(res, 200, { tick: campaign.truth.tick, events: events.length });
    }
    if (path === '/api/gm/undo' && req.method === 'POST') {
      const r = campaign.rewindOneStep();
      if (r) broadcast();
      return json(res, 200, r ? { ok: true, tick: r.tick } : { ok: false, reason: 'nothing to undo' });
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

    // player API — gated by the per-side token (?t=<token>)
    const sideView = path.match(/^\/api\/side\/([^/]+)\/view$/);
    if (sideView) {
      const sideId = sideView[1];
      if (!campaign.truth.sides[sideId]) return json(res, 404, { error: 'no such side' });
      if (url.searchParams.get('t') !== tokenFor(sideId)) return json(res, 403, { error: 'bad token' });
      return json(res, 200, project(campaign.truth, sideId, campaign.truth.tick));
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
      // optional single conditional: { when, param, kind, path }
      const conditionals = b.conditional ? [{
        trigger: { when: b.conditional.when, param: b.conditional.param },
        thenOrder: {
          id: 'ph', sideId, formationId: b.formationId, issuedTick: 0, effectiveTick: 0,
          kind: b.conditional.kind,
          ...(b.conditional.path ? { path: toPath(b.conditional.path) } : {}),
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
        path: toPath(b.path),
        conditionals,
        ...(b.targetContactId ? { targetContactId: b.targetContactId } : {}),
        ...(b.emconOverride ? { emconOverride: b.emconOverride } : {}),
        ...(airStation ? { station: airStation } : {}),
        ...(b.airSpeed ? { airSpeed: b.airSpeed } : {}),
        ...(b.loiterTicks !== undefined ? { loiterTicks: Number(b.loiterTicks) } : {}),
      };
      const result = campaign.issueOrder(order);
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
    ws.on('close', () => sockets.delete(ws));
  });
});

const PORT = Number(process.env.PORT ?? 8420);
server.listen(PORT, () => {
  const sides = Object.keys(campaign.truth.sides);
  console.log(`OVERRIDE GM Tool — http://localhost:${PORT}/gm`);
  for (const s of sides) {
    console.log(`  ${campaign.truth.sides[s].name}: http://localhost:${PORT}/player/${s}/${tokenFor(s)}`);
  }
});
