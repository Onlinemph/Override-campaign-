/**
 * mapmodel.js — turn ViewStates (player) or raw truth (GM / audit) into the models
 * hexmap.js and sysmap.js render. Shared by all screens so the fog rules live in
 * exactly one place per audience.
 */
(function () {
  const LV = ['', 'G', 'S', 'C', 'L'];

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
      if (!f.pos) return;
      markers.push({ q: f.pos.q, r: f.pos.r, kind: 'formation', side: v.sideId,
        label: classLetter(f.units), sub: f.name, dark: f.emcon === 'DARK',
        title: `${f.name} · RDY ${f.rdy} · ${f.emcon}/${f.posture} · ${f.onNet ? 'ON-NET' : 'OFF-NET'}` });
    });
    (v.ownFacilities || []).forEach(fc => {
      markers.push({ q: fc.pos.q, r: fc.pos.r, kind: 'facility', side: v.sideId,
        label: fc.tags.includes('AIRSTRIP') ? 'A' : fc.tags.includes('SPACEPORT') ? 'P'
             : fc.tags.includes('SENSOR_STATION') ? '⌖' : 'F',
        title: `${fc.name}${fc.fuelFarmTons ? ' · farm ' + fc.fuelFarmTons.toFixed(1) + 't' : ''}` +
               `${fc.supplyPoints ? ' · ' + fc.supplyPoints + ' SP' : ''}` });
    });
    (v.contacts || []).forEach(c => {
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
    return { cols: th.cols, rows: th.rows, hexes, markers, corridors };
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
        label: fc.tags.includes('AIRSTRIP') ? 'A' : fc.tags.includes('SPACEPORT') ? 'P'
             : fc.tags.includes('SENSOR_STATION') ? '⌖' : 'F',
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
    return { cols, rows, hexes, markers, corridors };
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
