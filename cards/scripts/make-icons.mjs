/**
 * Generate PWA icons (public/icon-192.png, icon-512.png) without any image lib —
 * a minimal PNG encoder (node zlib) drawing the OVERRIDE mark: dark background,
 * accent triangle, purple bar. Run: node scripts/make-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

// CRC32
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; };
const chunk = (type, data) => {
  const t = Buffer.from(type, "ascii");
  const body = Buffer.concat([t, data]);
  return Buffer.concat([u32(data.length), body, u32(CRC(body))]);
};
function png(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.concat([u32(w), u32(h), Buffer.from([8, 6, 0, 0, 0])]);
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const sign = (px, py, ax, ay, bx, by) => (px - bx) * (ay - by) - (ax - bx) * (py - by);
function inTri(px, py, a, b, c) {
  const d1 = sign(px, py, ...a, ...b), d2 = sign(px, py, ...b, ...c), d3 = sign(px, py, ...c, ...a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function makeIcon(S) {
  const rgba = Buffer.alloc(S * S * 4);
  const set = (x, y, r, g, b) => { const i = (y * S + x) * 4; rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255; };
  // outer triangle (accent) and inner notch (dark) -> BattleTech-style ▲
  const A = [0.5 * S, 0.16 * S], B = [0.14 * S, 0.80 * S], C = [0.86 * S, 0.80 * S];
  const A2 = [0.5 * S, 0.32 * S], B2 = [0.28 * S, 0.74 * S], C2 = [0.72 * S, 0.74 * S];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let r = 21, g = 23, b = 28; // #15171c dark bg
      if (inTri(x + 0.5, y + 0.5, A, B, C)) { r = 240; g = 160; b = 32; } // accent #f0a020
      if (inTri(x + 0.5, y + 0.5, A2, B2, C2)) { r = 21; g = 23; b = 28; } // notch
      // purple base bar
      if (y > 0.84 * S && y < 0.90 * S && x > 0.18 * S && x < 0.82 * S) { r = 108; g = 79; b = 158; } // #6c4f9e
      set(x, y, r, g, b);
    }
  return png(S, S, rgba);
}

for (const S of [192, 512]) {
  writeFileSync(join(OUT, `icon-${S}.png`), makeIcon(S));
  console.log(`wrote public/icon-${S}.png`);
}
