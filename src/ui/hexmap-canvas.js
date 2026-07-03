/**
 * hexmap-canvas.js — canvas hex map renderer for CONTINENTAL maps (D-040).
 *
 * Same model/opts contract as hexmap.js's renderHexMap. The SVG renderer is one DOM
 * node per hex — beautiful to ~6k hexes, then the browser drowns. This renderer draws
 * the same picture into a single <canvas> with viewport culling and level-of-detail,
 * and carries its own camera (wheel zoom to cursor, drag pan, double-click reset,
 * click-to-plot with a drag threshold) since CSS-transform pan/zoom would rasterize.
 * hexmap.js dispatches here automatically when cols×rows exceeds the threshold.
 */
(function () {
  const TERRAIN_FILL = {
    CLEAR: '#39432f', WOODS: '#28452c', ROUGH: '#4d4636', HILLS: '#54493a',
    MOUNTAIN: '#5d574f', WATER: '#23425e', SWAMP: '#2e463e', URBAN: '#474d55',
    FOG: '#101318',
  };
  const TERRAIN_DECOR = {
    WOODS: '♣', ROUGH: '∴', HILLS: '◠', MOUNTAIN: '▲', SWAMP: '≈', URBAN: '▦', WATER: '~',
  };
  const SIDE_COLOR = { blue: '#5aa9ff', red: '#ff6b5e' };
  const SQ3 = Math.sqrt(3);

  const center = (q, r, s) => ({ x: s * SQ3 * (q + r / 2) + s * 2, y: s * 1.5 * r + s * 2 });
  const sideColor = side => SIDE_COLOR[side] || '#d8c66a';

  /** world point → axial hex (inverse of center(), cube-rounded) */
  function hexAt(x, y, s) {
    const rf = (y - s * 2) / (s * 1.5);
    const qf = (x - s * 2) / (s * SQ3) - rf / 2;
    let q = Math.round(qf), r = Math.round(rf), z = Math.round(-qf - rf);
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), dz = Math.abs(z - (-qf - rf));
    if (dq > dr && dq > dz) q = -r - z; else if (dr > dz) r = -q - z;
    return { q, r };
  }

  function hexPath(ctx, cx, cy, s) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 30);
      const x = cx + s * Math.cos(a), y = cy + s * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function ensureCanvas(svg) {
    if (svg.__cnv && svg.__cnv.isConnected) return svg.__cnv;
    const cnv = document.createElement('canvas');
    cnv.className = 'map';
    cnv.style.display = 'block';
    cnv.style.width = '100%';
    svg.parentNode.insertBefore(cnv, svg.nextSibling);
    svg.__cnv = cnv;
    return cnv;
  }

  window.renderHexMapCanvas = function (svg, model, opts) {
    opts = opts || {};
    const s = opts.size || 17;
    const cnv = ensureCanvas(svg);
    svg.style.display = 'none';
    cnv.style.display = 'block';

    const worldW = SQ3 * s * (model.cols + model.rows / 2) + s * 4;
    const worldH = 1.5 * s * model.rows + s * 4;
    const wrap = cnv.parentNode;
    const cssW = Math.max(320, wrap.clientWidth || 800);
    const cssH = Math.max(240, Math.round(cssW * worldH / worldW));
    const dpr = window.devicePixelRatio || 1;
    if (cnv.width !== Math.round(cssW * dpr) || cnv.height !== Math.round(cssH * dpr)) {
      cnv.width = Math.round(cssW * dpr);
      cnv.height = Math.round(cssH * dpr);
      cnv.style.height = cssH + 'px';
      delete cnv.__cam; // container changed shape: refit
    }
    const fitZ = Math.min(cssW / worldW, cssH / worldH);
    if (!cnv.__cam) cnv.__cam = { z: fitZ, x: 0, y: 0 };
    cnv.__fitZ = fitZ;
    cnv.__state = { model, opts, s, dpr, cssW, cssH };
    bind(cnv);
    draw(cnv);
  };

  function draw(cnv) {
    const { model, opts, s, dpr, cssW, cssH } = cnv.__state;
    const cam = cnv.__cam;
    const ctx = cnv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(0, 0, cnv.width, cnv.height);
    ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * cam.x, dpr * cam.y);

    const sz = s * cam.z; // on-screen hex size in css px — the level-of-detail knob
    // visible world rect (with a hex of slack) → row/col bounds for culling
    const wx0 = (-cam.x) / cam.z - s * 2, wy0 = (-cam.y) / cam.z - s * 2;
    const wx1 = (cssW - cam.x) / cam.z + s * 2, wy1 = (cssH - cam.y) / cam.z + s * 2;
    const r0 = Math.max(0, Math.floor((wy0 - s * 2) / (1.5 * s)));
    const r1 = Math.min(model.rows - 1, Math.ceil((wy1 - s * 2) / (1.5 * s)));

    const byKey = cnv.__byKey && cnv.__byKeyModel === model ? cnv.__byKey : (() => {
      const m = {};
      (model.hexes || []).forEach(hx => { m[hx.q + ',' + hx.r] = hx; });
      cnv.__byKey = m; cnv.__byKeyModel = model;
      return m;
    })();
    const hl = new Set((model.highlight || []).map(p => p.q + ',' + p.r));

    // ── terrain (culled, batched by fill color) ──
    const buckets = new Map();
    for (let r = r0; r <= r1; r++) {
      const q0 = Math.max(0, Math.floor((wx0 - s * 2) / (s * SQ3) - r / 2));
      const q1 = Math.min(model.cols - 1, Math.ceil((wx1 - s * 2) / (s * SQ3) - r / 2));
      for (let q = q0; q <= q1; q++) {
        const hx = byKey[q + ',' + r];
        const fill = (!hx || hx.fog) ? TERRAIN_FILL.FOG
          : (TERRAIN_FILL[hx.terrain] || TERRAIN_FILL.CLEAR);
        let b = buckets.get(fill);
        if (!b) buckets.set(fill, b = []);
        b.push(q, r);
      }
    }
    if (sz < 4) {
      // LOD: hexes smaller than ~4px are pixels — fillRect them (a 30k-subpath fill
      // stalls canvas for seconds; 30k fillRects take milliseconds)
      const rw = s * SQ3, rh = s * 1.5;
      for (const [fill, cells] of buckets) {
        ctx.fillStyle = fill;
        for (let i = 0; i < cells.length; i += 2) {
          const c = center(cells[i], cells[i + 1], s);
          ctx.fillRect(c.x - rw / 2, c.y - rh / 2, rw, rh);
        }
      }
    } else {
      for (const [fill, cells] of buckets) {
        ctx.fillStyle = fill;
        ctx.strokeStyle = '#161b14'; ctx.lineWidth = 0.8;
        // chunk the path: huge multi-subpath fills degrade superlinearly
        for (let i = 0; i < cells.length; i += 2) {
          if (i % 4000 === 0) ctx.beginPath();
          const c = center(cells[i], cells[i + 1], s);
          for (let k = 0; k < 6; k++) {
            const a = Math.PI / 180 * (60 * k - 30);
            const x = c.x + (s - 0.4) * Math.cos(a), y = c.y + (s - 0.4) * Math.sin(a);
            if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          if (i % 4000 === 3998 || i + 2 >= cells.length) { ctx.fill(); ctx.stroke(); }
        }
      }
    }
    // decor glyphs only when hexes are big enough to read
    if (sz >= 8) {
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.font = `${s * 0.62}px system-ui`;
      ctx.textAlign = 'center';
      for (let i = 0; i < (model.hexes || []).length; i++) {
        const hx = model.hexes[i];
        if (hx.fog || hx.r < r0 || hx.r > r1) continue;
        const decor = TERRAIN_DECOR[hx.terrain];
        if (!decor) continue;
        const c = center(hx.q, hx.r, s);
        if (c.x < wx0 || c.x > wx1) continue;
        ctx.fillText(decor, c.x, c.y + s * 0.32);
      }
    }
    // highlight ring (click-to-plot)
    ctx.strokeStyle = '#ffd75e'; ctx.lineWidth = 1.6;
    for (const key of hl) {
      const [q, r] = key.split(',').map(Number);
      const c = center(q, r, s);
      hexPath(ctx, c.x, c.y, s - 1.5); ctx.stroke();
    }

    // ── roads & rails (visible hexes only) ──
    const roadHexes = (model.hexes || []).filter(hx => !hx.fog && hx.r >= r0 && hx.r <= r1 &&
      (hx.infra || []).some(t => t === 'ROAD' || t === 'RAIL'));
    const roadSet = new Set((model.hexes || [])
      .filter(hx => !hx.fog && (hx.infra || []).some(t => t === 'ROAD' || t === 'RAIL'))
      .map(hx => hx.q + ',' + hx.r));
    ctx.strokeStyle = '#b9a45a'; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.8, s * 0.16); ctx.globalAlpha = 0.8;
    const dirs = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
    ctx.beginPath();
    for (const hx of roadHexes) {
      const c = center(hx.q, hx.r, s);
      for (const d of dirs) {
        if (roadSet.has((hx.q + d[0]) + ',' + (hx.r + d[1]))) {
          const n = center(hx.q + d[0], hx.r + d[1], s);
          ctx.moveTo(c.x, c.y); ctx.lineTo((c.x + n.x) / 2, (c.y + n.y) / 2);
        }
      }
    }
    ctx.stroke(); ctx.globalAlpha = 1;
    // infra glyphs & objectives
    if (sz >= 5) {
      ctx.textAlign = 'center';
      for (const hx of model.hexes || []) {
        if (hx.fog || hx.r < r0 || hx.r > r1) continue;
        const c = center(hx.q, hx.r, s);
        if (c.x < wx0 || c.x > wx1) continue;
        const tags = hx.infra || [];
        const glyph = tags.includes('SPACEPORT') ? '⏏' : tags.includes('AIRSTRIP') ? '✈'
          : tags.includes('SENSOR_STATION') ? '⌖' : tags.includes('DEPOT') ? '▣'
          : tags.includes('FACTORY') ? '⚙' : tags.includes('HPG') ? 'ψ'
          : (tags.includes('TOWN') || tags.includes('CITY')) ? '⌂'
          : tags.includes('FORT') ? '⛫' : null;
        if (glyph) {
          ctx.fillStyle = '#cfd6df'; ctx.font = `${s * 0.7}px system-ui`;
          ctx.fillText(glyph, c.x, c.y - s * 0.25 + s * 0.35);
        }
        if (hx.objective) {
          ctx.fillStyle = hx.objective.fake ? '#b06bd8' : '#ffd75e';
          ctx.font = `${s * 0.6}px system-ui`;
          ctx.fillText('★', c.x + s * 0.55, c.y - s * 0.45 + s * 0.3);
        }
      }
    }

    // ── coverage zones ──
    for (const z of model.zones || []) {
      if (z.hexes) {
        ctx.fillStyle = z.color; ctx.globalAlpha = z.fillOpacity || 0.07;
        ctx.beginPath();
        for (const h of z.hexes) {
          if (h.r < r0 - 1 || h.r > r1 + 1) continue;
          const c = center(h.q, h.r, s);
          for (let k = 0; k < 6; k++) {
            const a = Math.PI / 180 * (60 * k - 30);
            const x = c.x + (s - 0.6) * Math.cos(a), y = c.y + (s - 0.6) * Math.sin(a);
            if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
        ctx.fill(); ctx.globalAlpha = 1;
        continue;
      }
      ctx.strokeStyle = z.color; ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.2 / cam.z; ctx.setLineDash([7, 6]);
      ctx.beginPath();
      (z.corners || []).forEach((cc, i) => {
        const p = center(cc.q, cc.r, s);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    // ── corridors & plotted paths ──
    for (const cor of model.corridors || []) {
      const cs = cor.points.map(p => center(p.q, p.r, s));
      ctx.strokeStyle = cor.color || '#7ad0d8';
      ctx.lineWidth = s * 0.9; ctx.globalAlpha = 0.10;
      ctx.beginPath(); cs.forEach((c, i) => i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)); ctx.stroke();
      ctx.lineWidth = Math.max(1, 1 / cam.z); ctx.globalAlpha = 0.55; ctx.setLineDash([5, 4]);
      ctx.beginPath(); cs.forEach((c, i) => i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    for (const p of model.paths || []) {
      const cs = p.points.map(pt => center(pt.q, pt.r, s));
      if (!cs.length) continue;
      const color = p.color || '#ffd75e';
      ctx.strokeStyle = color; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = s * 0.22; ctx.globalAlpha = 0.18;
      ctx.beginPath(); cs.forEach((c, i) => i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)); ctx.stroke();
      ctx.lineWidth = Math.max(1.2, 2 / cam.z); ctx.globalAlpha = 0.95; ctx.setLineDash([4, 3]);
      ctx.beginPath(); cs.forEach((c, i) => i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)); ctx.stroke();
      ctx.setLineDash([]);
      const a = cs[0], zz = cs[cs.length - 1];
      ctx.fillStyle = color; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(a.x, a.y, s * 0.1, 0, 7); ctx.fill();
      ctx.globalAlpha = 0.95; ctx.lineWidth = 2 / cam.z;
      ctx.beginPath(); ctx.arc(zz.x, zz.y, s * 0.2, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ── markers ──
    const stack = {};
    cnv.__markerPts = [];
    for (const m of model.markers || []) {
      const key = m.q + ',' + m.r;
      const n = stack[key] = (stack[key] || 0) + 1;
      const c = center(m.q, m.r, s);
      const off = (n - 1) * s * 0.42;
      const x = c.x + (n > 1 ? off * (n % 2 ? 1 : -1) : 0);
      const y = c.y - (n > 1 ? s * 0.18 : 0);
      if (x < wx0 || x > wx1 || y < wy0 || y > wy1) continue;
      cnv.__markerPts.push({ x, y, title: m.title || m.sub || m.label || '' });
      const col = sideColor(m.side);
      ctx.globalAlpha = m.stale ? Math.max(0.45, 1 - m.stale / 240) : 1;
      ctx.textAlign = 'center';
      // keep markers legible when zoomed far out: floor their on-screen size
      const mScale = Math.max(1, 6 / sz);
      const S = s * mScale;

      if (m.kind === 'contact' || m.kind === 'haze') {
        const r0m = S * (m.big ? 0.62 : 0.5);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.strokeStyle = m.kind === 'haze' ? '#b06bd8' : '#ffb454';
        ctx.lineWidth = 1.6 / cam.z;
        if (m.kind === 'haze') ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(x, y - r0m); ctx.lineTo(x + r0m, y); ctx.lineTo(x, y + r0m); ctx.lineTo(x - r0m, y);
        ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ffb454'; ctx.font = `bold ${S * 0.55}px system-ui`;
        ctx.fillText(m.label || '?', x, y + S * 0.22);
      } else if (m.kind === 'facility') {
        const r0m = S * 0.52;
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.strokeStyle = col; ctx.lineWidth = 1.6 / cam.z;
        ctx.fillRect(x - r0m, y - r0m, r0m * 2, r0m * 2);
        ctx.strokeRect(x - r0m, y - r0m, r0m * 2, r0m * 2);
        ctx.fillStyle = col; ctx.font = `bold ${S * 0.5}px system-ui`;
        ctx.fillText(m.label || 'F', x, y + S * 0.22);
      } else if (m.kind === 'salvage' || m.kind === 'crew') {
        ctx.fillStyle = m.kind === 'crew' ? '#7ad07a' : '#d8c66a';
        ctx.font = `${S * 0.75}px system-ui`;
        ctx.fillText(m.kind === 'crew' ? '☂' : '⚒', x, y + S * 0.25);
      } else {
        const r0m = S * (m.big ? 0.6 : 0.5);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.strokeStyle = m.dead ? '#666' : col;
        ctx.lineWidth = 1.8 / cam.z;
        if (m.dark) ctx.setLineDash([2.5, 2]);
        ctx.beginPath(); ctx.arc(x, y, r0m, 0, 7); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = m.dead ? '#666' : col; ctx.font = `bold ${S * 0.55}px system-ui`;
        ctx.fillText(m.dead ? '✕' : (m.label || '●'), x, y + S * 0.22);
      }
      if (m.sub && n === 1 && sz >= 9) {
        ctx.font = `${s * 0.42}px system-ui`;
        ctx.lineWidth = 2 / cam.z; ctx.strokeStyle = '#0a0d12';
        ctx.strokeText(m.sub, x, y + s * 1.05);
        ctx.fillStyle = '#aeb6c0';
        ctx.fillText(m.sub, x, y + s * 1.05);
      }
      ctx.globalAlpha = 1;
    }

    // ── coordinates ──
    if (opts.showCoords && sz >= 4) {
      ctx.fillStyle = '#5a6470'; ctx.font = `${s * 0.5}px system-ui`; ctx.textAlign = 'center';
      for (let q = 0; q < model.cols; q += 5) {
        const c = center(q, 0, s);
        ctx.fillText(String(q), c.x, s * 0.7);
      }
      for (let r = 0; r < model.rows; r += 5) {
        const c = center(0, r, s);
        ctx.fillText(String(r), s * 0.5, c.y);
      }
    }
  }

  function bind(cnv) {
    if (cnv.__bound) return;
    cnv.__bound = true;
    const cam = () => cnv.__cam;
    const toWorld = (e) => {
      const rect = cnv.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      return { mx, my, x: (mx - cam().x) / cam().z, y: (my - cam().y) / cam().z };
    };

    cnv.addEventListener('wheel', e => {
      e.preventDefault();
      const { mx, my } = toWorld(e);
      const c = cam();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nz = Math.max(cnv.__fitZ * 0.4, Math.min(cnv.__fitZ * 24, c.z * factor));
      c.x = mx - (mx - c.x) * (nz / c.z);
      c.y = my - (my - c.y) * (nz / c.z);
      c.z = nz;
      requestAnimationFrame(() => draw(cnv));
    }, { passive: false });

    let down = null, dragging = false;
    cnv.addEventListener('pointerdown', e => {
      down = { x: e.clientX, y: e.clientY, camX: cam().x, camY: cam().y };
      dragging = false;
    });
    cnv.addEventListener('pointermove', e => {
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (dragging || Math.abs(dx) + Math.abs(dy) > 4) {
          if (!dragging) { dragging = true; cnv.setPointerCapture(e.pointerId); }
          cam().x = down.camX + dx;
          cam().y = down.camY + dy;
          requestAnimationFrame(() => draw(cnv));
        }
        return;
      }
      // hover: nearest marker title, else the hex under the cursor
      const st = cnv.__state;
      if (!st) return;
      const w = toWorld(e);
      let best = null, bestD = st.s * 0.9;
      for (const p of cnv.__markerPts || []) {
        const d = Math.hypot(p.x - w.x, p.y - w.y);
        if (d < bestD) { best = p; bestD = d; }
      }
      if (best && best.title) { cnv.title = best.title; return; }
      const { q, r } = hexAt(w.x, w.y, st.s);
      if (q < 0 || r < 0 || q >= st.model.cols || r >= st.model.rows) { cnv.title = ''; return; }
      const hx = (cnv.__byKey || {})[q + ',' + r];
      let title = (!hx || hx.fog) ? `${q},${r} — unscouted`
        : `${q},${r} ${hx.terrain}${(hx.infra || []).length ? ' [' + hx.infra.join(',') + ']' : ''}`;
      if (st.model.distanceFrom) {
        const dq = q - st.model.distanceFrom.q, dr = r - st.model.distanceFrom.r;
        const d = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
        title += ` · ${d} hex (${d * 18} km) from selected`;
      }
      cnv.title = title;
    });
    const finish = e => {
      if (!down) return;
      const wasDrag = dragging;
      down = null; dragging = false;
      try { cnv.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      if (wasDrag) return;
      const st = cnv.__state;
      if (!st || !st.opts.onHexClick) return;
      const w = toWorld(e);
      const { q, r } = hexAt(w.x, w.y, st.s);
      if (q >= 0 && r >= 0 && q < st.model.cols && r < st.model.rows) st.opts.onHexClick(q, r);
    };
    cnv.addEventListener('pointerup', finish);
    cnv.addEventListener('pointercancel', () => { down = null; dragging = false; });
    cnv.addEventListener('dblclick', () => {
      cnv.__cam = { z: cnv.__fitZ, x: 0, y: 0 };
      draw(cnv);
    });
  }
})();
