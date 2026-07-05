/**
 * mapmodel.js — turn ViewStates (player) or raw truth (GM / audit) into the models
 * hexmap.js and sysmap.js render. Shared by all screens so the fog rules live in
 * exactly one place per audience.
 */
(function () {
  const LV = ['', 'G', 'S', 'C', 'L'];

  // ── hex-line math (mirrors src/hex/axial.ts) so routes follow the hexes ──────
  function hexDistance(a, b) {
    const dq = a.q - b.q, dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  }
  function cubeRound(qf, rf) {
    const sf = -qf - rf;
    let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
    return { q, r };
  }
  function hexLine(a, b) {
    const n = hexDistance(a, b);
    if (n === 0) return [{ q: a.q, r: a.r }];
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      out.push(cubeRound(a.q + (b.q - a.q) * t + 1e-6, a.r + (b.r - a.r) * t + 1e-6));
    }
    return out;
  }
  /** Contiguous hex-by-hex polyline from `start` through each waypoint. */
  function routeThrough(start, waypoints) {
    const pts = [{ q: start.q, r: start.r }];
    let cur = { q: start.q, r: start.r };
    for (const wp of waypoints || []) {
      const seg = hexLine(cur, wp);
      for (let i = 1; i < seg.length; i++) pts.push(seg[i]);
      cur = wp;
    }
    return pts;
  }
  window.routeThrough = routeThrough;

  // a command-net coverage zone = the 6-corner hexagon of hexes within `radius`
  const DIRS = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
                { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];
  function netZones(nodes, theaterId, color) {
    return (nodes || [])
      .filter(n => !n.theaterId || n.theaterId === theaterId)
      .map(n => ({ corners: DIRS.map(d => ({ q: n.q + d.q * n.radius, r: n.r + d.r * n.radius })),
                   color }));
  }

  function classLetter(units) {
    const c = (units && units[0] && (units[0].class || units[0])) || '';
    if (c === 'MECH' || c === 'PROTO') return 'M';
    if (c === 'VEHICLE' || c === 'NAVAL') return 'V';
    if (c === 'INFANTRY' || c === 'BA') return 'I';
    if (c === 'VTOL') return 'R';
    if (c === 'ASF' || c === 'CONV_FIGHTER') return 'A';
    if (c === 'DROPSHIP' || c === 'JUMPSHIP' || c === 'WARSHIP') return 'D';
    if (c === 'SUPPORT') return 'S';
    return '●';
  }

  // ── PLAYER: a ViewState is already fogged; just shape it ──────────────────
  window.buildPlayerHexModel = function (v, theaterId) {
    const th = (v.theaters || []).find(t => t.id === theaterId) || v.theaters[0];
    if (!th) return null;
    const hexes = (v.scoutedTerrain || [])
      .filter(hx => hx.theaterId === th.id)
      .map(hx => ({ q: hx.q, r: hx.r, terrain: hx.terrain, infra: hx.infra,
                    objective: hx.objective ? { vp: hx.objective.vpPerDay } : undefined }));
    const markers = [];
    (v.ownFormations || []).forEach(f => {
      // congruent sky (D-037): an airborne flight draws on the hex it is directly over
      if (f.flight && f.flight.airPos && f.flight.overhead) {
        if (f.flight.overhead.theaterId !== th.id) return;
        markers.push({ q: f.flight.overhead.q, r: f.flight.overhead.r, kind: 'formation',
          side: v.sideId, label: '✈', sub: f.name, id: f.id,
          title: `${f.name} · ${f.flight.phase} ${f.flight.speed} @ ${f.flight.airPos.band}` +
                 ` · ${f.flight.fpMin} FP (joker ${f.flight.jokerFp} / bingo ${f.flight.bingoFp})` });
        return;
      }
      if (!f.pos) return;
      const gear = [...new Set((f.units || []).flatMap(u => (u.tags || [])
        .filter(t => ['ECM', 'ANGEL_ECM', 'BEAGLE', 'STEALTH', 'C3M', 'HQ', 'RECON'].includes(t))))];
      markers.push({ q: f.pos.q, r: f.pos.r, kind: 'formation', side: v.sideId,
        label: classLetter(f.units), sub: f.name, dark: f.emcon === 'DARK', id: f.id,
        title: `${f.name} · RDY ${f.rdy} · ${f.emcon}/${f.posture} · ${f.onNet ? 'ON-NET' : 'OFF-NET'}` +
               (f.sensor ? ` · sensors ${f.sensor.passive}/${f.sensor.active}` : '') +
               (gear.length ? ` · ${gear.join(',')}` : '') });
    });
    (v.ownFacilities || []).forEach(fc => {
      markers.push({ q: fc.pos.q, r: fc.pos.r, kind: 'facility', side: v.sideId,
        label: fc.capitalBattery ? '☄'
             : fc.tags.includes('AIRSTRIP') ? 'A' : fc.tags.includes('SPACEPORT') ? 'P'
             : fc.tags.includes('SENSOR_STATION') ? '⌖'
             : fc.tags.includes('COMM_RELAY') ? '📡' : 'F',
        title: `${fc.name}${fc.fuelFarmTons ? ' · farm ' + fc.fuelFarmTons.toFixed(1) + 't' : ''}` +
               `${fc.supplyPoints ? ' · ' + fc.supplyPoints + ' SP' : ''}` });
    });
    (v.contacts || []).forEach(c => {
      // air contacts draw on the hex their estimate sits over (D-037 congruent sky)
      if (c.estPos.kind === 'air' && c.overhead && c.overhead.theaterId === th.id) {
        markers.push({ q: c.overhead.q, r: c.overhead.r, kind: 'contact',
          label: '✈' + LV[c.level], error: c.posErrorHexes > 0, stale: c.ageTicks,
          sub: c.estSizeClass || '', title: `${c.levelName} (air)` +
            (c.estComposition ? ` · ${c.estComposition}` : '') +
            ` · as of t${c.staleAsOfTick} (${c.ageTicks} stale)` });
        return;
      }
      if (c.estPos.kind !== 'ground' || c.estPos.theaterId !== th.id) return;
      markers.push({ q: c.estPos.q, r: c.estPos.r, kind: c.kind === 'ECM_HAZE' ? 'haze' : 'contact',
        label: LV[c.level], error: c.posErrorHexes > 0, stale: c.ageTicks,
        sub: c.estSizeClass || '', title: `${c.levelName}` +
          (c.estComposition ? ` · ${c.estComposition}` : '') +
          ` · as of t${c.staleAsOfTick} (${c.ageTicks} stale)` });
    });
    const corridors = (v.ownSatellites || [])
      .filter(s => s.theaterId === th.id && s.alive)
      .map(s => ({ points: s.corridor, color: '#7ad0d8',
                   label: `${s.id} next pass t${s.nextPassTick}` }));
    // committed movement routes: hex-by-hex from each own formation through its
    // remaining order waypoints (so the line starts at the unit and follows the terrain)
    const paths = [];
    (v.ownFormations || []).forEach(f => {
      const wp = (f.currentOrder && f.currentOrder.path) || [];
      if (!f.pos || wp.length === 0) return;
      paths.push({ points: routeThrough(f.pos, wp), color: '#7ad07a' });
    });
    const zones = [];
    // supply envelope (a filled region) drawn first, under the outline zones
    const supply = (v.supplyHexes || []).filter(h => h.theaterId === th.id).map(h => ({ q: h.q, r: h.r }));
    if (supply.length) zones.push({ kind: 'supply', hexes: supply, color: '#caa14a', fillOpacity: 0.08 });
    zones.push(...netZones(v.netNodes, th.id, '#5aa9ff')); // own command-net coverage
    // sensor-station detection coverage (fixed early-warning radar)
    const sensorNodes = (v.ownFacilities || [])
      .filter(fc => fc.sensor && fc.pos && fc.pos.theaterId === th.id)
      .map(fc => ({ q: fc.pos.q, r: fc.pos.r, theaterId: th.id, radius: fc.sensor.passive }));
    zones.push(...netZones(sensorNodes, th.id, '#4fd0b8'));
    return { cols: th.cols, rows: th.rows, hexes, markers, corridors, paths, zones };
  };

  window.buildPlayerSysModel = function (v) {
    if (!v.system || !v.system.nodes.length) return null;
    const vessels = [];
    (v.ownFormations || []).forEach(f => {
      if (!f.vessel || !f.vessel.spacePos) return;
      const p = f.vessel.spacePos;
      vessels.push({ id: f.id, side: v.sideId, label: f.name,
        nodeId: p.kind === 'node' ? p.nodeId : undefined,
        laneId: p.kind === 'lane' ? p.laneId : undefined,
        progressAU: p.kind === 'lane' ? p.progressAU : undefined,
        velocityKps: p.kind === 'lane' ? p.velocityKps : 0,
        title: `${f.name} · ${f.vessel.fuelTons}t (${f.vessel.burnDaysRemaining} burn-days)` });
    });
    const contacts = [];
    (v.contacts || []).forEach(c => {
      const p = c.estPos;
      if (p.kind !== 'node' && p.kind !== 'lane') return;
      contacts.push({ label: LV[c.level], stale: c.ageTicks, sub: c.estSizeClass || '',
        nodeId: p.kind === 'node' ? p.nodeId : undefined,
        laneId: p.kind === 'lane' ? p.laneId : undefined,
        progressAU: p.kind === 'lane' ? p.progressAU : undefined });
    });
    return { nodes: v.system.nodes, lanes: v.system.lanes, vessels, contacts, flashes: [] };
  };

  // ── GM / AUDIT: the truth, fog lifted, with per-side belief overlays ──────
  window.buildTruthHexModel = function (t, theaterId, opts) {
    opts = opts || {};
    const th = t.theaters[theaterId] || Object.values(t.theaters)[0];
    if (!th) return null;
    const hexes = Object.values(th.hexes).map(hx => ({
      q: hx.q, r: hx.r, terrain: hx.terrain, infra: hx.infra,
      objective: hx.objective ? { vp: hx.objective.vpPerDay, hidden: hx.objective.hidden,
                                  fake: hx.objective.fake } : undefined,
    }));
    let cols = 0, rows = 0;
    hexes.forEach(hx => { cols = Math.max(cols, hx.q + 1); rows = Math.max(rows, hx.r + 1); });

    const markers = [];
    Object.values(t.formations).forEach(f => {
      if (f.pos.kind !== 'ground' || f.pos.theaterId !== th.id) return;
      const units = f.unitIds.map(id => t.units[id]).filter(Boolean);
      markers.push({ q: f.pos.q, r: f.pos.r, kind: 'formation', side: f.sideId,
        label: classLetter(units), sub: f.name, dead: f.destroyed, dark: f.emcon === 'DARK',
        title: `${f.name} [${f.sideId}] · RDY ${f.rdy} · ${f.emcon}/${f.posture}` });
    });
    Object.values(t.facilities).forEach(fc => {
      if (fc.pos.kind !== 'ground' || fc.pos.theaterId !== th.id) return;
      markers.push({ q: fc.pos.q, r: fc.pos.r, kind: 'facility', side: fc.sideId,
        label: fc.capitalBattery ? '☄'
             : fc.tags.includes('AIRSTRIP') ? 'A' : fc.tags.includes('SPACEPORT') ? 'P'
             : fc.tags.includes('SENSOR_STATION') ? '⌖'
             : fc.tags.includes('COMM_RELAY') ? '📡' : 'F',
        title: `${fc.name} [${fc.sideId}]` });
    });
    Object.values(t.markers || {}).forEach(m => {
      if (m.pos.kind !== 'ground' || m.pos.theaterId !== th.id) return;
      markers.push({ q: m.pos.q, r: m.pos.r,
        kind: m.kind === 'DOWNED_CREW' ? 'crew' : 'salvage', title: m.kind });
    });
    Object.values(t.salvage || {}).forEach(sv => {
      if (sv.hex.theaterId !== th.id) return;
      markers.push({ q: sv.hex.q, r: sv.hex.r, kind: 'salvage',
        title: `salvage ${sv.sourceUnitId} (held ${sv.heldBy || '—'})` });
    });
    // belief overlay: what a chosen side thinks is out there (delivered picture)
    if (opts.beliefSide) {
      Object.values(t.contacts).forEach(c => {
        const d = c.delivered;
        if (c.observerSideId !== opts.beliefSide || !d) return;
        if (d.estPos.kind !== 'ground' || d.estPos.theaterId !== th.id) return;
        markers.push({ q: d.estPos.q, r: d.estPos.r, kind: 'contact', label: LV[d.level],
          error: d.posErrorHexes > 0, stale: (t.tick - d.asOfTick),
          title: `${opts.beliefSide} believes: L${d.level} as of t${d.asOfTick}` });
      });
    }
    const corridors = Object.values(t.satellites || {})
      .filter(s => s.theaterId === th.id && s.alive)
      .map(s => ({ points: s.corridor, color: s.sideId === 'blue' ? '#7ad0d8' : '#d88a7a' }));
    // committed movement routes for every formation, coloured by side (GM sees all):
    // hex-by-hex from the unit through its remaining waypoints
    const paths = [];
    Object.values(t.formations).forEach(f => {
      if (f.destroyed || f.pos.kind !== 'ground' || f.pos.theaterId !== th.id) return;
      const order = f.currentOrderId && t.orders[f.currentOrderId];
      if (!order || order.completed || !order.path) return;
      const wp = order.path.slice(f.pathIndex || 0)
        .filter(p => p.kind === 'ground').map(p => ({ q: p.q, r: p.r }));
      if (!wp.length) return;
      paths.push({ points: routeThrough(f.pos, wp),
                   color: f.sideId === 'blue' ? '#7ad0d8' : '#d88a7a' });
    });
    // coverage per side (GM sees all): supply fills first, then net outlines
    const zones = [];
    const supplyBy = (opts.supplyHexesBySide) || {};
    for (const sid of Object.keys(supplyBy)) {
      const hx = supplyBy[sid].filter(h => h.theaterId === th.id).map(h => ({ q: h.q, r: h.r }));
      if (hx.length) zones.push({ kind: 'supply', hexes: hx, color: sid === 'blue' ? '#5a8fd0' : '#d09a5a', fillOpacity: 0.05 });
    }
    const byside = (opts.netNodesBySide) || {};
    for (const sid of Object.keys(byside)) {
      zones.push(...netZones(byside[sid], th.id, sid === 'blue' ? '#5aa9ff' : '#ff8a6b'));
    }
    // sensor-station detection coverage (all sides; GM sees everything)
    const sensorNodes = Object.values(t.facilities)
      .filter(fc => fc.sensorStation && fc.pos.kind === 'ground' && fc.pos.theaterId === th.id)
      .map(fc => ({ q: fc.pos.q, r: fc.pos.r, theaterId: th.id, radius: fc.sensorStation.passive }));
    zones.push(...netZones(sensorNodes, th.id, '#4fd0b8'));
    return { cols, rows, hexes, markers, corridors, paths, zones };
  };

  // ── EDITOR: an authoring campaign object → the hex renderer model ──────────
  window.buildEditorHexModel = function (camp, theaterId, sideColors) {
    const t = (camp.theaters || []).find(x => x.id === theaterId) || (camp.theaters || [])[0];
    if (!t) return { cols: 1, rows: 1, hexes: [], markers: [] };
    const ov = {};
    (t.overrides || []).forEach(o => { ov[o.q + ',' + o.r] = o; });
    const hexes = [];
    for (let r = 0; r < t.height; r++) {
      for (let q = 0; q < t.width; q++) {
        const o = ov[q + ',' + r];
        hexes.push({ q, r, terrain: (o && o.terrain) || t.defaultTerrain || 'CLEAR',
          infra: (o && o.infra) || [],
          objective: o && o.objective ? { vp: o.objective.vpPerDay,
            hidden: o.objective.hidden, fake: o.objective.fake } : undefined });
      }
    }
    const markers = [];
    const sideOf = id => (sideColors && sideColors[id]) || id;
    (camp.formations || []).forEach(f => {
      if (f.theaterId !== t.id || f.q === undefined) return;
      const cls = (f.units && f.units[0] && f.units[0].class) || '';
      const L = cls === 'MECH' ? 'M' : cls === 'VEHICLE' ? 'V' : cls === 'INFANTRY' ? 'I'
        : cls === 'VTOL' ? 'R' : (cls === 'ASF' || cls === 'CONV_FIGHTER') ? 'A'
        : cls.startsWith('DROP') || cls.endsWith('SHIP') ? 'D' : '●';
      markers.push({ q: f.q, r: f.r, kind: 'formation', side: sideOf(f.sideId),
        label: L, sub: f.name, dark: f.emcon === 'DARK', title: `${f.name} [${f.sideId}]` });
    });
    (camp.facilities || []).forEach(fc => {
      if (fc.theaterId !== t.id || fc.q === undefined) return;
      const tags = fc.tags || [];
      markers.push({ q: fc.q, r: fc.r, kind: 'facility', side: sideOf(fc.sideId),
        label: tags.includes('AIRSTRIP') ? 'A' : tags.includes('SPACEPORT') ? 'P'
          : tags.includes('SENSOR_STATION') ? '⌖'
          : tags.includes('COMM_RELAY') ? '📡' : 'F', title: `${fc.name} [${fc.sideId}]` });
    });
    return { cols: t.width, rows: t.height, hexes, markers };
  };

  // ── EDITOR: the authoring system graph → the sysmap renderer model ────────
  window.buildEditorSysModel = function (camp) {
    const sys = camp.system || { nodes: [], lanes: [] };
    const sc = {}; (camp.sides || []).forEach((s, i) => { sc[s.id] = i === 0 ? 'blue' : i === 1 ? 'red' : s.id; });
    const vessels = (camp.formations || [])
      .filter(f => f.nodeId)
      .map(f => ({ id: f.id, side: sc[f.sideId] || f.sideId, label: f.name, nodeId: f.nodeId,
        title: `${f.name} [${f.sideId}]` }));
    return {
      nodes: (sys.nodes || []).map(n => ({ id: n.id, type: n.type, name: n.name,
        secret: n.secret, objective: n.objective })),
      lanes: (sys.lanes || []).map(l => ({ id: l.id || (l.a + '--' + l.b),
        a: l.a, b: l.b, distanceAU: l.distanceAU })),
      vessels, contacts: [], flashes: [],
    };
  };

  window.buildTruthSysModel = function (t) {
    const nodes = Object.values(t.system.nodes);
    if (!nodes.length) return null;
    const lanes = Object.values(t.system.lanes);
    const vessels = [];
    Object.values(t.formations).forEach(f => {
      if (f.pos.kind !== 'node' && f.pos.kind !== 'lane') return;
      vessels.push({ id: f.id, side: f.sideId, label: f.name, dead: f.destroyed,
        nodeId: f.pos.kind === 'node' ? f.pos.nodeId : undefined,
        laneId: f.pos.kind === 'lane' ? f.pos.laneId : undefined,
        progressAU: f.pos.kind === 'lane' ? f.pos.progressAU : undefined,
        velocityKps: f.pos.kind === 'lane' ? f.pos.velocityKps : 0 });
    });
    const flashes = Object.values(t.emissions || {})
      .filter(e => e.kind === 'JUMP_FLASH' && e.pos.kind === 'node')
      .map(e => ({ nodeId: e.pos.nodeId, ageTicks: t.tick - e.tick }));
    return {
      nodes: nodes.map(n => ({ id: n.id, type: n.type, name: n.name, secret: n.secret })),
      lanes, vessels, contacts: [], flashes,
    };
  };
})();
