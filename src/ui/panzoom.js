/**
 * panzoom.js — wheel-zoom + drag-pan for a map SVG, applied as a CSS transform on the
 * element so it survives the renderers re-writing innerHTML on every websocket update.
 * Wrap the <svg> in a .mapwrap (overflow:hidden); call attachPanZoom(svg) once.
 * Double-click resets. Clicks that don't drag still reach hex handlers.
 */
(function () {
  window.attachPanZoom = function (svg) {
    if (svg.__panzoom) return;
    const st = { z: 1, x: 0, y: 0 };
    svg.__panzoom = st;
    svg.style.transformOrigin = '0 0';
    svg.style.willChange = 'transform';
    const apply = () => { svg.style.transform = `translate(${st.x}px,${st.y}px) scale(${st.z})`; };

    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nz = Math.max(0.4, Math.min(8, st.z * factor));
      // keep the point under the cursor fixed
      st.x = mx - (mx - st.x) * (nz / st.z);
      st.y = my - (my - st.y) * (nz / st.z);
      st.z = nz;
      apply();
    }, { passive: false });

    let drag = null;
    const wrap = svg.parentElement;
    svg.addEventListener('pointerdown', e => {
      drag = { x: e.clientX, y: e.clientY, ox: st.x, oy: st.y, moved: 0 };
      svg.setPointerCapture(e.pointerId);
      if (wrap) wrap.style.cursor = 'grabbing';
    });
    svg.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      st.x = drag.ox + dx; st.y = drag.oy + dy;
      apply();
    });
    const end = e => {
      if (!drag) return;
      // a real drag suppresses the click that would otherwise plot a hex
      if (drag.moved > 4) {
        const swallow = ev => { ev.stopPropagation(); svg.removeEventListener('click', swallow, true); };
        svg.addEventListener('click', swallow, true);
        setTimeout(() => svg.removeEventListener('click', swallow, true), 0);
      }
      drag = null;
      if (wrap) wrap.style.cursor = 'grab';
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('dblclick', e => {
      e.preventDefault(); st.z = 1; st.x = 0; st.y = 0; apply();
    });
  };
})();
