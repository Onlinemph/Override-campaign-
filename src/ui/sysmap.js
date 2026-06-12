/**
 * sysmap.js — the DEEP SKY node-and-lane diagram ("a subway map, which is honestly how
 * a DropShip captain sees it too"). Deterministic radial layout from the first planet.
 *
 * renderSysMap(svgEl, model)
 *   model = {
 *     nodes: [{ id, type, name, secret? }],
 *     lanes: [{ a, b, distanceAU, transitDays1G? }],
 *     vessels: [{ id, side, label, nodeId? , laneId?, progressAU?, velocityKps?, dead? }],
 *     contacts: [{ label, side?, nodeId?, laneId?, progressAU?, stale? }],
 *     flashes: [{ nodeId, ageTicks }],
 *   }
 */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const NODE_GLYPH = {
    JUMP_ZENITH: '✦', JUMP_NADIR: '✧', PIRATE_POINT: '✕', PLANET: '◉', MOON: '◍',
    GAS_GIANT: '◯', BELT_SECTOR: '⁘', STATION_RECHARGE: '▣', STATION_OTHER: '▢',
    SHIPYARD: '⚓',
  };
  const SIDE_COLOR = { blue: '#5aa9ff', red: '#ff6b5e' };

  function el(name, attrs, text) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function layout(nodes, lanes, W, H) {
    // radial: first PLANET (or first node) at center; BFS rings by lane distance
    const adj = {};
    nodes.forEach(n => { adj[n.id] = []; });
    lanes.forEach(l => {
      if (adj[l.a] && adj[l.b]) {
        adj[l.a].push({ to: l.b, d: l.distanceAU });
        adj[l.b].push({ to: l.a, d: l.distanceAU });
      }
    });
    const centerNode = nodes.find(n => n.type === 'PLANET') || nodes[0];
    const dist = { [centerNode.id]: 0 };
    const order = [centerNode.id];
    for (let i = 0; i < order.length; i++) {
      adj[order[i]].forEach(e => {
        const d = dist[order[i]] + e.d;
        if (dist[e.to] === undefined || d < dist[e.to]) {
          if (dist[e.to] === undefined) order.push(e.to);
          dist[e.to] = d;
        }
      });
    }
    nodes.forEach(n => { if (dist[n.id] === undefined) { dist[n.id] = 1; order.push(n.id); } });
    const maxD = Math.max(1, ...Object.values(dist));
    const ring = Math.min(W, H) / 2 - 46;
    const others = order.filter(id => id !== centerNode.id);
    const pos = { [centerNode.id]: { x: W / 2, y: H / 2 } };
    others.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, others.length) - Math.PI / 2;
      const r = 40 + (dist[id] / maxD) * ring;
      pos[id] = { x: W / 2 + r * Math.cos(angle), y: H / 2 + r * Math.sin(angle) };
    });
    return pos;
  }

  window.renderSysMap = function (svg, model) {
    const W = 560, H = 360;
    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.background = 'radial-gradient(ellipse at center, #0d1220 0%, #05070d 100%)';

    // starfield (deterministic)
    const gStars = el('g', {});
    for (let i = 0; i < 90; i++) {
      const x = (i * 97.31) % W, y = (i * 53.77) % H;
      gStars.appendChild(el('circle', { cx: x, cy: y, r: (i % 3) * 0.3 + 0.3,
        fill: '#aab8d8', opacity: 0.12 + (i % 5) * 0.05 }));
    }
    svg.appendChild(gStars);

    const pos = layout(model.nodes, model.lanes, W, H);
    const laneById = {};

    // lanes
    const gL = el('g', {});
    model.lanes.forEach(l => {
      laneById[l.id || (l.a + '--' + l.b)] = l;
      const a = pos[l.a], b = pos[l.b];
      if (!a || !b) return;
      gL.appendChild(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: '#3a4a66', 'stroke-width': 1.4, 'stroke-dasharray': '1 4',
        'stroke-linecap': 'round' }));
      gL.appendChild(el('text', {
        x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 5, 'text-anchor': 'middle',
        'font-size': 9, fill: '#6c7a94',
      }, `${l.distanceAU} AU${l.transitDays1G ? ' · ' + l.transitDays1G + 'd @1G' : ''}`));
    });
    svg.appendChild(gL);

    function lanePoint(laneId, progressAU) {
      const l = laneById[laneId];
      if (!l) return null;
      const a = pos[l.a], b = pos[l.b];
      const t = Math.max(0, Math.min(1, progressAU / l.distanceAU));
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }

    // jump flashes (GM view): the brightest thing in the sky
    (model.flashes || []).forEach(f => {
      const p = pos[f.nodeId];
      if (!p) return;
      const o = Math.max(0.15, 1 - (f.ageTicks || 0) / 120);
      [10, 16].forEach((r, i) => svg.appendChild(el('circle', {
        cx: p.x, cy: p.y, r, fill: 'none', stroke: '#fff3b0',
        'stroke-width': 1.5 - i * 0.5, opacity: o * (1 - i * 0.4),
      })));
    });

    // nodes
    const gN = el('g', {});
    model.nodes.forEach(n => {
      const p = pos[n.id];
      if (!p) return;
      const big = n.type === 'PLANET' || n.type === 'GAS_GIANT';
      gN.appendChild(el('circle', { cx: p.x, cy: p.y, r: big ? 13 : 9,
        fill: '#0c1018', stroke: n.secret ? '#b06bd8' : '#7e8ba3', 'stroke-width': 1.4,
        'stroke-dasharray': n.secret ? '2 3' : 'none' }));
      gN.appendChild(el('text', { x: p.x, y: p.y + 4, 'text-anchor': 'middle',
        'font-size': big ? 13 : 10, fill: n.type === 'GAS_GIANT' ? '#d8a45a'
          : n.type === 'PLANET' ? '#7ad0a0' : '#cfd6df' },
        NODE_GLYPH[n.type] || '•'));
      gN.appendChild(el('text', { x: p.x, y: p.y + (big ? 26 : 21), 'text-anchor': 'middle',
        'font-size': 9.5, fill: '#aeb6c0' }, n.name));
    });
    svg.appendChild(gN);

    // vessels & contacts
    const gV = el('g', {});
    const nodeStack = {};
    function place(item) {
      if (item.laneId !== undefined && item.laneId !== null) {
        return lanePoint(item.laneId, item.progressAU || 0);
      }
      const p = pos[item.nodeId];
      if (!p) return null;
      const n = nodeStack[item.nodeId] = (nodeStack[item.nodeId] || 0) + 1;
      const a = n * 1.1 - 1.8; // start the orbit up-right, clear of the node's name
      return { x: p.x + 28 * Math.cos(a), y: p.y + 28 * Math.sin(a) };
    }
    (model.vessels || []).forEach(v => {
      const p = place(v);
      if (!p) return;
      const col = SIDE_COLOR[v.side] || '#d8c66a';
      const g = el('g', {});
      g.appendChild(el('polygon', {
        points: `${p.x},${p.y - 5.5} ${p.x + 4.5},${p.y + 4} ${p.x - 4.5},${p.y + 4}`,
        fill: 'rgba(0,0,0,0.5)', stroke: v.dead ? '#666' : col, 'stroke-width': 1.6,
      }));
      g.appendChild(el('text', { x: p.x, y: p.y + 14, 'text-anchor': 'middle',
        'font-size': 8.5, fill: v.dead ? '#666' : col,
        'paint-order': 'stroke', stroke: '#05070d', 'stroke-width': 2 }, v.label));
      if (v.velocityKps > 10) g.appendChild(el('text', {
        x: p.x, y: p.y - 9, 'text-anchor': 'middle', 'font-size': 7.5, fill: '#8a93a0',
      }, Math.round(v.velocityKps) + ' kps'));
      g.appendChild(el('title', {}, v.title || v.label));
      gV.appendChild(g);
    });
    (model.contacts || []).forEach(c => {
      const p = place(c);
      if (!p) return;
      const o = c.stale ? Math.max(0.4, 1 - c.stale / 480) : 1;
      const g = el('g', { opacity: o });
      g.appendChild(el('polygon', {
        points: `${p.x},${p.y - 5.5} ${p.x + 5.5},${p.y} ${p.x},${p.y + 5.5} ${p.x - 5.5},${p.y}`,
        fill: 'rgba(0,0,0,0.45)', stroke: '#ffb454', 'stroke-width': 1.4,
      }));
      g.appendChild(el('text', { x: p.x, y: p.y + 2.8, 'text-anchor': 'middle',
        'font-size': 7, 'font-weight': 'bold', fill: '#ffb454' }, c.label || '?'));
      if (c.sub) g.appendChild(el('text', { x: p.x, y: p.y + 14, 'text-anchor': 'middle',
        'font-size': 8, fill: '#aeb6c0', 'paint-order': 'stroke', stroke: '#05070d',
        'stroke-width': 2 }, c.sub));
      gV.appendChild(g);
    });
    svg.appendChild(gV);
  };
})();
