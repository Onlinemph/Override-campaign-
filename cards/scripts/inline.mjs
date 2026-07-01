/**
 * Post-build: inline the hashed JS and CSS into dist-web/index.html, producing
 * a single self-contained file, then delete the assets directory.
 *
 * WHY: Vite emits content-hashed asset filenames and each deploy replaces them.
 * GitHub Pages caches index.html (~10 min), so a returning visitor with a
 * cached index.html can request asset hashes the latest deploy already deleted
 * -> 404 on both CSS and JS -> an unstyled, dead page until a hard refresh.
 * With everything inlined there are no separate assets to go stale: you get a
 * whole old page or a whole new page, never a broken half.
 */
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = "dist-web";
const indexPath = join(dir, "index.html");
let html = readFileSync(indexPath, "utf8");

// Inline the module script. Escape any "</script" so it can't close the tag early.
html = html.replace(
  /<script\b[^>]*\bsrc="\.?\/?(assets\/[^"]+\.js)"[^>]*><\/script>/,
  (_m, src) => {
    const js = readFileSync(join(dir, src), "utf8").replace(/<\/script/gi, "<\\/script");
    return `<script type="module">\n${js}\n</script>`;
  },
);

// Inline the stylesheet link.
html = html.replace(
  /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\.?\/?(assets\/[^"]+\.css)"[^>]*>/,
  (_m, href) => {
    const css = readFileSync(join(dir, href), "utf8");
    return `<style>\n${css}\n</style>`;
  },
);

writeFileSync(indexPath, html);
rmSync(join(dir, "assets"), { recursive: true, force: true });

// Emit the service worker from its source (scripts/sw-source.js — kept OUT of
// public/ so Vite never copies it and races this write), stamping a unique cache
// version per build. The changed sw.js makes the browser install a new worker,
// whose activate step deletes old caches -> stale bundled MUL data can't linger.
const swVersion = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const swSource = readFileSync(join("scripts", "sw-source.js"), "utf8");
writeFileSync(join(dir, "sw.js"), swSource.replace("__SW_VERSION__", swVersion));

// GitHub Pages runs Jekyll, which silently drops files/dirs beginning with "_"
// (e.g. units/Mechs/.../_Gestalt_ D2X-G.mtf -> 404). An empty .nojekyll marker
// disables Jekyll so every unit file is served verbatim.
writeFileSync(join(dir, ".nojekyll"), "");

console.log("inlined CSS + JS into a single dist-web/index.html (+ .nojekyll)");
