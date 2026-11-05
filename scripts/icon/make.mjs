// Sepia Slicer's icon: a cuttlefish (una sepia) built from printed layers, on cuttlefish-ink brown.
// Usage: node scripts/icon/make.mjs <out> [--layer | --json]
//   default: the whole icon as SVG in Apple's classic grid (an 824 px rounded square on a 1024 canvas)
//   --layer: only the cuttlefish as SVG, full-bleed on a transparent 1024 canvas, for the Icon Composer
//            .icon (macOS 26 and later draw the background, the shape and the shadow themselves)
//   --json:  the .icon's icon.json: the ink gradient as fill, the cuttlefish as its one layer
// scripts/icon/build.mjs runs both and writes everything under build/.
import { writeFileSync } from 'node:fs';
const out = process.argv[2];
const mode = process.argv[3] ?? '';
const LAYER = 46; // one printed layer, in px of the 1024 canvas
const SEAM = 7;
const f = (n) => +n.toFixed(1);

// macOS app icon body: 824 px continuous-corner square centred on a 1024 canvas.
function squircle(cx, cy, a, n = 5, steps = 240) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push([cx + a * Math.sign(c) * Math.abs(c) ** (2 / n), cy + a * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
}

// Ellipse with an optional ripple along its edge (the cuttlefish's fin).
function blob(cx, cy, rx, ry, ripple = 0, waves = 0, steps = 360) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const k = 1 + ripple * Math.sin(t * waves);
    pts.push([cx + rx * k * Math.cos(t), cy + ry * k * Math.sin(t)]);
  }
  return 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
}

// Mantle: wider at the front, rounder at the back.
function mantle(cx, cy, rx, ry, steps = 360) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = Math.cos(t), y = Math.sin(t);
    const swell = 1 + 0.08 * -x; // fuller toward the head (left)
    pts.push([cx + rx * x, cy + ry * y * swell]);
  }
  return 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
}

// A tapering arm along a quadratic curve.
function arm(p0, p1, p2, w0, w1, steps = 40) {
  const left = [], right = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0];
    const y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1];
    const dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
    const dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const w = (w0 + (w1 - w0) * t) / 2;
    left.push([x + nx * w, y + ny * w]);
    right.push([x - nx * w, y - ny * w]);
  }
  const tip = right.at(-1);
  return 'M' + left.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + `A${f(w1 / 2)} ${f(w1 / 2)} 0 0 0 ${f(tip[0])} ${f(tip[1])}` + 'L' + right.reverse().map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
}

const cy = 500;
const dx = 4; // centre the animal on the canvas (drawn facing left, then mirrored)
const X = (x) => x + dx;
const arms = [];
const n = 6;
for (let i = 0; i < n; i++) {
  const u = i / (n - 1) - 0.5; // -0.5 .. 0.5
  const base = [X(316), cy + 8 + u * 78];
  const ctrl = [X(236), cy + 10 + u * 70];
  // Bunched forward in a cone; the outer ones shorter and curling away.
  const tip = [X(160 + Math.abs(u) * 70 + (i % 2) * 12), cy + 14 + u * 112 + Math.sign(u) * Math.abs(u) ** 2 * 60];
  arms.push(arm(base, ctrl, tip, 48, 13));
}

const cream = '#f7ead5';
const INK_TOP = '#a8713f';
const INK_BOTTOM = '#47280f';

// Swim up and to the right; drawn facing left, then mirrored and tilted.
const pose = `translate(512 ${cy}) scale(1.06) translate(-512 -${cy}) rotate(-9 512 ${cy}) translate(1024 0) scale(-1 1)`;
const fin = `<path d="${blob(X(600), cy, 250, 150, 0.018, 22)}"/>`;
const bodyShapes = [`<path d="${mantle(X(600), cy, 232, 122)}"/>`, `<path d="${blob(X(348), cy, 84, 80)}"/>`, ...arms.map((d) => `<path d="${d}"/>`)].join('');

// Printed layers: horizontal bands in canvas space, so they stay level whatever the pose.
function bands(fill) {
  const rects = [];
  for (let y = cy - LAYER / 2 - LAYER * 6; y < cy + LAYER * 7; y += LAYER) rects.push(`<rect x="0" y="${f(y)}" width="1024" height="${LAYER - SEAM}" fill="${fill}"/>`);
  return rects.join('');
}

const defs = `
    <!-- One printed layer: a rounded bead, lit from above. -->
    <linearGradient id="bead" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffaf0"/>
      <stop offset="0.45" stop-color="${cream}"/>
      <stop offset="1" stop-color="#d8bb93"/>
    </linearGradient>
    <linearGradient id="bead-fin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e9d3b2"/>
      <stop offset="1" stop-color="#b8956a"/>
    </linearGradient>
    <mask id="fin" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><g transform="${pose}" fill="#fff">${fin}</g></mask>
    <mask id="animal" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><g transform="${pose}" fill="#fff">${bodyShapes}</g></mask>`;

const animal = (shadow) => `
    <g${shadow ? ' filter="url(#soft)"' : ''}>
      <g mask="url(#fin)">${bands('url(#bead-fin)')}</g>
      <g mask="url(#animal)">${bands('url(#bead)')}</g>
    </g>
    <g transform="${pose}">
      <circle cx="${X(360)}" cy="${cy - 22}" r="38" fill="${cream}" stroke="#c09a6c" stroke-width="5"/>
      <circle cx="${X(358)}" cy="${cy - 20}" r="25" fill="#2e1a0b"/>
      <circle cx="${X(366)}" cy="${cy - 29}" r="8" fill="#fffaf0"/>
    </g>`;

const classic = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${INK_TOP}"/>
      <stop offset="1" stop-color="${INK_BOTTOM}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.32" r="0.65">
      <stop offset="0" stop-color="#ffd9a8" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ffd9a8" stop-opacity="0"/>
    </radialGradient>${defs}
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.28"/>
    </filter>
    <filter id="soft" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#2a1607" flood-opacity="0.45"/>
    </filter>
    <clipPath id="body"><path d="${squircle(512, 512, 412)}"/></clipPath>
  </defs>
  <path d="${squircle(512, 512, 412)}" fill="url(#ink)" filter="url(#shadow)"/>
  <g clip-path="url(#body)">
    <rect width="1024" height="1024" fill="url(#glow)"/>${animal(true)}
  </g>
</svg>
`;

// Icon Composer's canvas is the icon shape itself, so the 824 px body grows to fill all 1024 px.
const layer = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>${defs}
  </defs>
  <g transform="translate(512 512) scale(${f(1024 / 824)}) translate(-512 -512)">${animal(false)}
  </g>
</svg>
`;
// Icon Composer colours are "space:r,g,b,a" with 0..1 channels.
const srgb = (hex) => `srgb:${[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(',')},1.00000`;
const iconJson = {
  fill: { 'linear-gradient': [srgb(INK_TOP), srgb(INK_BOTTOM)], orientation: { start: { x: 0.5, y: 0 }, stop: { x: 0.5, y: 1 } } },
  groups: [{ layers: [{ name: 'cuttlefish', 'image-name': 'cuttlefish.png' }], shadow: { kind: 'neutral', opacity: 0.5 }, translucency: { enabled: false, value: 0.5 } }],
  'supported-platforms': { squares: 'shared' },
};

writeFileSync(out, mode === '--layer' ? layer : mode === '--json' ? JSON.stringify(iconJson, null, 2) + '\n' : classic);
