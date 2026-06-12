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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Campaign } from '../core/truth.js';
import { MemoryEventStore } from '../core/log.js';
import { project } from '../projection/project.js';
import { loadCampaignFixture } from '../demo.js';
import type { GroundPos, Order } from '../core/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = process.argv[2] ?? join(here, '../../demo/campaign.json');
const campaign = Campaign.create(loadCampaignFixture(fixturePath), new MemoryEventStore());
console.log(`Campaign loaded from ${fixturePath} (seed: ${campaign.truth.seed})`);

const wss = new WebSocketServer({ noServer: true });
const sockets = new Set<WebSocket>();
function broadcast() {
  for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.send('update');
}

function gmState() {
  const sides = Object.keys(campaign.truth.sides);
  return {
    truth: campaign.truth,
    views: Object.fromEntries(
      sides.map(s => [s, project(campaign.truth, s, campaign.truth.tick)])),
    eventLog: campaign.store.all().slice(-200),
    eventCount: campaign.store.length(),
  };
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
    // pages
    if (path === '/' || path === '/gm') return page(res, 'gm.html');
    if (path.startsWith('/player/')) return page(res, 'player.html');

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

    // player API
    const sideView = path.match(/^\/api\/side\/([^/]+)\/view$/);
    if (sideView) {
      return json(res, 200, project(campaign.truth, sideView[1], campaign.truth.tick));
    }
    const sideOrder = path.match(/^\/api\/side\/([^/]+)\/order$/);
    if (sideOrder && req.method === 'POST') {
      const b = await readBody(req);
      const sideId = sideOrder[1];
      const f = campaign.truth.formations[b.formationId];
      if (!f || f.sideId !== sideId) return json(res, 400, { ok: false, reason: 'not your formation' });
      const theaterId = f.pos.kind === 'ground' ? f.pos.theaterId : '';
      const order: Order = {
        id: `order:${sideId}:${campaign.truth.tick}:${b.formationId}`,
        sideId, formationId: b.formationId,
        issuedTick: campaign.truth.tick, effectiveTick: campaign.truth.tick + 1,
        kind: b.kind,
        path: (b.path ?? []).map((p: { q: number; r: number }): GroundPos =>
          ({ kind: 'ground', theaterId, q: p.q, r: p.r })),
        conditionals: [],
        ...(b.emconOverride ? { emconOverride: b.emconOverride } : {}),
      };
      const result = campaign.issueOrder(order);
      if (result.ok) broadcast();
      return json(res, result.ok ? 200 : 400, result);
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
  for (const s of sides) console.log(`  player screen: http://localhost:${PORT}/player/${s}`);
});
