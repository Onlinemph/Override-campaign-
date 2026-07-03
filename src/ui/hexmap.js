/**
 * hexmap.js — dependency-free SVG hex map renderer (pointy-top, axial coords).
 *
 * renderHexMap(svgEl, model, opts)
 *   model = {
 *     cols, rows,                       // grid extent (fog fills the gaps)
 *     hexes: [{ q, r, terrain, infra:[], objective?:{vp,hidden,fake}, fog? }],
 *     markers: [{ q, r, kind, side, label, sub, level, error, stale, dead, big }],
 *       kind: 'formation' | 'facility' | 'contact' | 'haze' | 'salvage' | 'crew' | 'sat'
 *     corridors: [{ points:[{q,r}], color, dash, label }],
 *     paths:     [{ points:[{q,r}], color }],      // plotted routes
 *     highlight: [{q,r}],                          // e.g. the click-to-plot path
 *   }
 *   opts = { size?, onHexClick?, showCoords?, fogUnlisted? }
 */
(function () {
  const TERRAIN_FILL = {
    CLEAR:    '#39432f',
    WOODS:    '#28452c',
    ROUGH:    '#4d4636',
    HILLS:    '#54493a',
    MOUNTAIN: '#5d574f',
    WATER:    '#23425e',
    SWAMP:    '#2e463e',
    URBAN:    '#474d55',
    FOG:      '#101318',
  };
  const TERRAIN_DECOR = {
    WOODS: '♣', ROUGH: '∴', HILLS: '◠', MOUNTAIN: '▲', SWAMP: '≈', URBAN: '▦', WATER: '~',
  };
  const SIDE_COLOR = { blue: '#5aa9ff', red: '#ff6b5e' };
  const NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, text) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function center(q, r, s) {
    return { x: s * Math.sqrt(3) * (q + r / 2) + s * 2, y: s * 1.5 * r + s * 2 };
  }

  function hexPoints(cx, cy, s) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 30);
      pts.push((cx + s * Math.cos(a)).toFixed(1) + ',' + (cy + s * Math.sin(a)).toFixed(1));
    }
    return pts.join(' ');
  }

  function sideColor(side) { return SIDE_COLOR[side] || '#d8c66a'; }

  window.renderHexMap = function (svg, model, opts) {
    opts = opts || {};
    // continental maps (D-040): past ~6k hexes one-DOM-node-per-hex drowns the
    // browser — hand off to the canvas renderer (same model/opts, its own camera)
    const threshold = window.HEXMAP_CANVAS_THRESHOLD ?? 6000;
    if (model.cols * model.rows > threshold && window.renderHexMapCanvas) {
      return window.renderHexMapCanvas(svg, model, opts);
    }
    if (svg.__cnv) { svg.__cnv.style.display = 'none'; svg.style.display = ''; }
    const s = opts.size || 17;
    svg.innerHTML = '';
    const w = Math.sqrt(3) * s * (model.cols + model.rows / 2) + s * 4;
    const h = 1.5 * s * model.rows + s * 4;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.style.background = '#0a0d12';

    const byKey = {};
    (model.hexes || []).forEach(hx => { byKey[hx.q + ',' + hx.r] = hx; });
    const hl = new Set((model.highlight || []).map(p => p.q + ',' + p.r));

    // ── terrain layer ──
    const gTerrain = el('g', {});
    for (let r = 0; r < model.rows; r++) {
      for (let q = 0; q < model.cols; q++) {
        const hx = byKey[q + ',' + r];
        const fogged = !hx || hx.fog;
        const c = center(q, r, s);
        const poly = el('polygon', {
          points: hexPoints(c.x, c.y, s - 0.4),
          fill: fogged ? TERRAIN_FILL.FOG : (TERRAIN_FILL[hx.terrain] || TERRAIN_FILL.CLEAR),
          stroke: fogged ? '#1a1e26' : '#161b14',
          'stroke-width': 0.8,
        });
        if (opts.onHexClick) {
          poly.style.cursor = 'crosshair';
          poly.addEventListener('click', () => opts.onHexClick(q, r));
        }
        let title = fogged ? `${q},${r} — unscouted`
          : `${q},${r} ${hx.terrain}${(hx.infra || []).length ? ' [' + hx.infra.join(',') + ']' : ''}`;
        if (model.distanceFrom) {
          const dq = q - model.distanceFrom.q, dr = r - model.distanceFrom.r;
          const d = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
          title += ` · ${d} hex (${d * 18} km) from selected`;
        }
        poly.appendChild(el('title', {}, title));
        gTerrain.appendChild(poly);

        if (!fogged) {
          const decor = TERRAIN_DECOR[hx.terrain];
          if (decor) gTerrain.appendChild(el('text', {
            x: c.x, y: c.y + s * 0.32, 'text-anchor': 'middle',
            'font-size': s * 0.62, fill: 'rgba(255,255,255,0.14)',
            'pointer-events': 'none',
          }, decor));
        }
        if (hl.has(q + ',' + r)) {
          gTerrain.appendChild(el('polygon', {
            points: hexPoints(c.x, c.y, s - 1.5), fill: 'none',
            stroke: '#ffd75e', 'stroke-width': 1.6, 'pointer-events': 'none',
          }));
        }
      }
    }
    svg.appendChild(gTerrain);

    // ── roads & rails ──
    const gInfra = el('g', { 'pointer-events': 'none' });
    const roadHexes = (model.hexes || []).filter(hx => !hx.fog &&
      (hx.infra || []).some(t => t === 'ROAD' || t === 'RAIL'));
    const roadSet = new Set(roadHexes.map(hx => hx.q + ',' + hx.r));
    roadHexes.forEach(hx => {
      const c = center(hx.q, hx.r, s);
      const dirs = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
      let drew = false;
      dirs.forEach(d => {
        const nk = (hx.q + d[0]) + ',' + (hx.r + d[1]);
        if (roadSet.has(nk)) {
          const n = center(hx.q + d[0], hx.r + d[1], s);
          gInfra.appendChild(el('line', {
            x1: c.x, y1: c.y, x2: (c.x + n.x) / 2, y2: (c.y + n.y) / 2,
            stroke: '#b9a45a', 'stroke-width': s * 0.16, 'stroke-linecap': 'round', opacity: 0.8,
          }));
          drew = true;
        }
      });
      if (!drew) gInfra.appendChild(el('circle', { cx: c.x, cy: c.y, r: s * 0.1, fill: '#b9a45a' }));
    });
    // infra glyphs & objectives
    (model.hexes || []).forEach(hx => {
      if (hx.fog) return;
      const c = center(hx.q, hx.r, s);
      const tags = hx.infra || [];
      const glyph = tags.includes('SPACEPORT') ? '⏏' : tags.includes('AIRSTRIP') ? '✈'
        : tags.includes('SENSOR_STATION') ? '⌖' : tags.includes('DEPOT') ? '▣'
        : tags.includes('FACTORY') ? '⚙' : tags.includes('HPG') ? 'ψ'
        : (tags.includes('TOWN') || tags.includes('CITY')) ? '⌂'
        : tags.includes('FORT') ? '⛫' : null;
      if (glyph) gInfra.appendChild(el('text', {
        x: c.x, y: c.y - s * 0.25, 'text-anchor': 'middle',
        'font-size': s * 0.7, fill: '#cfd6df',
      }, glyph));
      if (hx.objective) {
        gInfra.appendChild(el('text', {
          x: c.x + s * 0.55, y: c.y - s * 0.45, 'text-anchor': 'middle',
          'font-size': s * 0.6,
          fill: hx.objective.fake ? '#b06bd8' : '#ffd75e',
        }, '★'));
        if (hx.objective.hidden) gInfra.appendChild(el('text', {
          x: c.x + s * 0.55, y: c.y - s * 0.05, 'text-anchor': 'middle',
          'font-size': s * 0.42, fill: '#9aa3ad',
        }, 'hidden'));
      }
    });
    svg.appendChild(gInfra);

    // ── coverage zones (net/sensor = dashed hexagon outline; supply = hex fill) ──
    const gZones = el('g', { 'pointer-events': 'none' });
    (model.zones || []).forEach(z => {
      if (z.hexes) {                              // irregular region: tint each hex
        z.hexes.forEach(h => {
          const c = center(h.q, h.r, s);
          gZones.appendChild(el('polygon', { points: hexPoints(c.x, c.y, s - 0.6),
            fill: z.color, 'fill-opacity': z.fillOpacity || 0.07, stroke: 'none' }));
        });
        return;
      }
      const pts = z.corners.map(c => { const p = center(c.q, c.r, s); return p.x + ',' + p.y; }).join(' ');
      gZones.appendChild(el('polygon', { points: pts, fill: z.color, 'fill-opacity': 0.05,
        stroke: z.color, 'stroke-width': 1.2, 'stroke-dasharray': '7 6', opacity: 0.5 }));
    });
    svg.appendChild(gZones);

    // ── corridors (satellite tracks) & plotted paths ──
    const gPaths = el('g', { 'pointer-events': 'none' });
    (model.corridors || []).forEach(cor => {
      const pts = cor.points.map(p => { const c = center(p.q, p.r, s); return c.x + ',' + c.y; }).join(' ');
      gPaths.appendChild(el('polyline', {
        points: pts, fill: 'none', stroke: cor.color || '#7ad0d8',
        'stroke-width': s * 0.9, opacity: 0.10,
      }));
      gPaths.appendChild(el('polyline', {
        points: pts, fill: 'none', stroke: cor.color || '#7ad0d8',
        'stroke-width': 1, 'stroke-dasharray': cor.dash || '5 4', opacity: 0.55,
      }));
    });
    (model.paths || []).forEach(p => {
      const cs = p.points.map(pt => center(pt.q, pt.r, s));
      const pts = cs.map(c => c.x + ',' + c.y).join(' ');
      const color = p.color || '#ffd75e';
      // soft glow under the route, then the dashed line on top
      gPaths.appendChild(el('polyline', { points: pts, fill: 'none', stroke: color,
        'stroke-width': s * 0.22, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.18 }));
      gPaths.appendChild(el('polyline', { points: pts, fill: 'none', stroke: color,
        'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'stroke-dasharray': '4 3', opacity: 0.95 }));
      // a small dot at the start, a ring at the destination (no per-hex clutter)
      const a = cs[0], z = cs[cs.length - 1];
      gPaths.appendChild(el('circle', { cx: a.x, cy: a.y, r: s * 0.1, fill: color, opacity: 0.9 }));
      gPaths.appendChild(el('circle', { cx: z.x, cy: z.y, r: s * 0.2, fill: 'none',
        stroke: color, 'stroke-width': 2, opacity: 0.95 }));
    });
    svg.appendChild(gPaths);

    // ── markers ──
    const gM = el('g', {});
    const stack = {};
    (model.markers || []).forEach(m => {
      const key = m.q + ',' + m.r;
      const n = stack[key] = (stack[key] || 0) + 1;
      const c = center(m.q, m.r, s);
      const off = (n - 1) * s * 0.42;
      const x = c.x + (n > 1 ? off * (n % 2 ? 1 : -1) : 0);
      const y = c.y - (n > 1 ? s * 0.18 : 0);
      const col = sideColor(m.side);
      const g = el('g', { opacity: m.stale ? Math.max(0.45, 1 - m.stale / 240) : 1 });

      if (m.kind === 'contact' || m.kind === 'haze') {
        const r0 = s * (m.big ? 0.62 : 0.5);
        g.appendChild(el('polygon', {
          points: `${x},${y - r0} ${x + r0},${y} ${x},${y + r0} ${x - r0},${y}`,
          fill: 'rgba(0,0,0,0.45)', stroke: m.kind === 'haze' ? '#b06bd8' : '#ffb454',
          'stroke-width': 1.6, 'stroke-dasharray': m.kind === 'haze' ? '2 2' : 'none',
        }));
        g.appendChild(el('text', {
          x, y: y + s * 0.22, 'text-anchor': 'middle', 'font-size': s * 0.55,
          'font-weight': 'bold', fill: '#ffb454',
        }, m.label || '?'));
        if (m.error) g.appendChild(el('circle', {
          cx: x, cy: y, r: s * 1.55, fill: 'none', stroke: '#ffb454',
          'stroke-width': 0.7, 'stroke-dasharray': '3 4', opacity: 0.5,
        }));
      } else if (m.kind === 'facility') {
        const r0 = s * 0.52;
        g.appendChild(el('rect', {
          x: x - r0, y: y - r0, width: r0 * 2, height: r0 * 2, rx: 1.5,
          fill: 'rgba(0,0,0,0.5)', stroke: col, 'stroke-width': 1.6,
        }));
        g.appendChild(el('text', {
          x, y: y + s * 0.22, 'text-anchor': 'middle', 'font-size': s * 0.5,
          'font-weight': 'bold', fill: col,
        }, m.label || 'F'));
      } else if (m.kind === 'salvage' || m.kind === 'crew') {
        g.appendChild(el('text', {
          x, y: y + s * 0.25, 'text-anchor': 'middle', 'font-size': s * 0.75,
          fill: m.kind === 'crew' ? '#7ad07a' : '#d8c66a',
        }, m.kind === 'crew' ? '☂' : '⚒'));
      } else { // formation
        const r0 = s * (m.big ? 0.6 : 0.5);
        g.appendChild(el('circle', {
          cx: x, cy: y, r: r0, fill: 'rgba(0,0,0,0.5)',
          stroke: m.dead ? '#666' : col, 'stroke-width': 1.8,
          'stroke-dasharray': m.dark ? '2.5 2' : 'none',
        }));
        g.appendChild(el('text', {
          x, y: y + s * 0.22, 'text-anchor': 'middle', 'font-size': s * 0.55,
          'font-weight': 'bold', fill: m.dead ? '#666' : col,
        }, m.dead ? '✕' : (m.label || '●')));
      }
      if (m.sub && n === 1) g.appendChild(el('text', {
        x, y: y + s * 1.05, 'text-anchor': 'middle', 'font-size': s * 0.42,
        fill: '#aeb6c0', 'paint-order': 'stroke', stroke: '#0a0d12', 'stroke-width': 2,
      }, m.sub));
      g.appendChild(el('title', {}, m.title || m.sub || m.label || ''));
      gM.appendChild(g);
    });
    svg.appendChild(gM);

    // ── coordinates ──
    if (opts.showCoords) {
      const gC = el('g', { 'pointer-events': 'none' });
      for (let q = 0; q < model.cols; q += 5) {
        const c = center(q, 0, s);
        gC.appendChild(el('text', { x: c.x, y: s * 0.7, 'text-anchor': 'middle',
          'font-size': s * 0.5, fill: '#5a6470' }, String(q)));
      }
      for (let r = 0; r < model.rows; r += 5) {
        const c = center(0, r, s);
        gC.appendChild(el('text', { x: s * 0.5, y: c.y, 'text-anchor': 'middle',
          'font-size': s * 0.5, fill: '#5a6470' }, String(r)));
      }
      svg.appendChild(gC);
    }
  };
})();
