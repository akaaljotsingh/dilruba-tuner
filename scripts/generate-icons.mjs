// Generates the PWA icon set (PNG + ICO + SVG) from the app's logo geometry.
// Pure Node – rasterises with 4×4 supersampling and encodes PNG via zlib.
//   npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/icons');
mkdirSync(out, { recursive: true });

const BG = [18, 17, 19];
const GOLD = [201, 164, 92];
const SAFFRON = [232, 145, 58];
const IVORY = [239, 230, 212];

// Logo in a 64-unit box (matches src/app/shared/components/logo.component.ts).
function bezier(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}
const wire = [];
for (let i = 0; i <= 48; i++) {
  const t = i / 48;
  wire.push([bezier(t, 32, 29.5, 34.5, 32), bezier(t, 9, 22, 42, 55)]);
}
const dots = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
  return {
    x: 32 + 21 * Math.cos(a),
    y: 32 + 21 * Math.sin(a),
    r: i === 0 ? 3.2 : 1.6,
    c: i === 0 ? SAFFRON : GOLD,
    a: i === 0 ? 1 : 0.8,
  };
});

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Returns [r,g,b,a] for a point in logo units, composited over transparent. */
function shade(x, y) {
  let col = null;
  const over = (c, a) => {
    if (!col) col = [0, 0, 0, 0];
    const na = a + col[3] * (1 - a);
    for (let k = 0; k < 3; k++) col[k] = (c[k] * a + col[k] * col[3] * (1 - a)) / (na || 1);
    col[3] = na;
  };
  const d = Math.hypot(x - 32, y - 32);
  if (Math.abs(d - 29) < 1.1) over(GOLD, 0.95);
  for (const p of dots) if (Math.hypot(x - p.x, y - p.y) < p.r) over(p.c, p.a);
  let wd = Infinity;
  for (let i = 1; i < wire.length; i++)
    wd = Math.min(wd, segDist(x, y, wire[i - 1][0], wire[i - 1][1], wire[i][0], wire[i][1]));
  if (wd < 0.9) over(IVORY, 1);
  if (Math.abs(d - 5.5) < 0.9) over(SAFFRON, 1);
  return col;
}

function render(size, { maskable = false, rounded = true } = {}) {
  const px = new Uint8Array(size * size * 4);
  const ss = 4;
  // Logo occupies 78% of an "any" icon and 58% of a maskable one (inside the safe zone).
  const logoFrac = maskable ? 0.58 : 0.78;
  const logoPx = size * logoFrac;
  const off = (size - logoPx) / 2;
  const radius = rounded && !maskable ? size * 0.22 : 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const fx = x + (sx + 0.5) / ss;
          const fy = y + (sy + 0.5) / ss;
          // Background (rounded square)
          let inside = true;
          if (radius > 0) {
            const cx = Math.min(Math.max(fx, radius), size - radius);
            const cy = Math.min(Math.max(fy, radius), size - radius);
            inside = Math.hypot(fx - cx, fy - cy) <= radius;
          }
          if (!inside) continue;
          // Soft warm vignette
          const vd = Math.hypot(fx - size / 2, fy - size * 0.35) / size;
          const glow = Math.max(0, 0.08 - vd * 0.1);
          let cr = BG[0] + 201 * glow,
            cg = BG[1] + 164 * glow,
            cb = BG[2] + 92 * glow;
          const lx = ((fx - off) / logoPx) * 64;
          const ly = ((fy - off) / logoPx) * 64;
          const c = shade(lx, ly);
          if (c) {
            cr = c[0] * c[3] + cr * (1 - c[3]);
            cg = c[1] * c[3] + cg * (1 - c[3]);
            cb = c[2] * c[3] + cb * (1 - c[3]);
          }
          r += cr;
          g += cg;
          b += cb;
          a += 255;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      const alpha = a / n;
      px[i + 3] = Math.round(alpha);
      const cov = a / 255 || 1;
      px[i] = Math.round(r / cov);
      px[i + 1] = Math.round(g / cov);
      px[i + 2] = Math.round(b / cov);
    }
  }
  return encodePng(size, size, px);
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const dir = Buffer.alloc(16);
  dir[0] = size >= 256 ? 0 : size;
  dir[1] = size >= 256 ? 0 : size;
  dir.writeUInt16LE(1, 4);
  dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(png.length, 8);
  dir.writeUInt32LE(22, 12);
  return Buffer.concat([header, dir, png]);
}

for (const size of [72, 96, 128, 144, 152, 192, 384, 512]) {
  writeFileSync(resolve(out, `icon-${size}x${size}.png`), render(size));
}
for (const size of [192, 512]) {
  writeFileSync(resolve(out, `maskable-${size}x${size}.png`), render(size, { maskable: true }));
}
writeFileSync(resolve(out, 'apple-touch-icon.png'), render(180, { rounded: false }));
writeFileSync(resolve(root, 'public/favicon.ico'), encodeIco(render(48), 48));

const dotSvg = dots
  .map(
    (p) =>
      `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${p.r}" fill="rgb(${p.c})" opacity="${p.a}"/>`,
  )
  .join('');
writeFileSync(
  resolve(out, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 80 80"><rect x="-8" y="-8" width="80" height="80" rx="18" fill="rgb(${BG})"/>` +
    `<circle cx="32" cy="32" r="29" fill="none" stroke="rgb(${GOLD})" stroke-width="2.2"/>${dotSvg}` +
    `<path d="M32 9 C 29.5 22, 34.5 42, 32 55" fill="none" stroke="rgb(${IVORY})" stroke-width="1.8" stroke-linecap="round"/>` +
    `<circle cx="32" cy="32" r="5.5" fill="none" stroke="rgb(${SAFFRON})" stroke-width="1.8"/></svg>\n`,
);
console.log('Icons written to public/icons');
