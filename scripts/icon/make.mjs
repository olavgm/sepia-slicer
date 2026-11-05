// Sepia Slicer's icon: a cube sliced into four floating layers, white and black, on the app's blue.
// Usage: node scripts/icon/make.mjs <out> [--layer | --json]
//   default: the whole icon as SVG in Apple's classic grid (an 824 px rounded square on a 1024 canvas)
//   --layer: only the cube as SVG, full-bleed on a transparent 1024 canvas, for the Icon Composer
//            .icon (macOS 26 and later draw the background, the shape and the shadow themselves)
//   --json:  the .icon's icon.json: the blue gradient as fill, the cube as its one layer
// scripts/icon/build.mjs runs all three and writes everything under build/.
import { writeFileSync } from 'node:fs';
const out = process.argv[2];
const mode = process.argv[3] ?? '';
const f = (n) => +n.toFixed(1);
const poly = (pts) => 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';

const BLUE_TOP = '#2b5fe3';
const BLUE_BOTTOM = '#0c1d52';
// Each layer's faces, [top, left, right], lit from above and the left.
const WHITE = ['#ffffff', '#d3def5', '#8ea4dc'];
const BLACK = ['#1b2232', '#0d121c', '#05070c'];
const LAYERS = [WHITE, BLACK, WHITE, BLACK]; // top to bottom
const EDGE = 292; // a side of the cube's top face, as drawn
const THICK = 62;
const GAP = 30;

// macOS app icon body: 824 px continuous-corner square centred on a 1024 canvas.
function squircle(cx, cy, a, n = 5, steps = 240) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push([cx + a * Math.sign(c) * Math.abs(c) ** (2 / n), cy + a * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return poly(pts);
}

// The cube in isometric view, drawn from the bottom layer up so each one covers the one below.
function cube() {
  const n = LAYERS.length;
  const height = EDGE + n * THICK + (n - 1) * GAP;
  const ex = EDGE * Math.cos(Math.PI / 6);
  let shapes = '';
  for (let i = n - 1; i >= 0; i--) {
    const y = 512 - height / 2 + 6 + i * (THICK + GAP);
    const [top, left, right] = LAYERS[i];
    const T = [512, y], R = [512 + ex, y + EDGE / 2], B = [512, y + EDGE], L = [512 - ex, y + EDGE / 2];
    const down = ([x, yy]) => [x, yy + THICK];
    // A hairline stroke in the face's own colour hides the anti-aliasing seam between faces.
    const face = (pts, colour) => `<path d="${poly(pts)}" fill="${colour}" stroke="${colour}" stroke-width="1.5" stroke-linejoin="round"/>`;
    shapes += face([L, B, down(B), down(L)], left);
    shapes += face([B, R, down(R), down(B)], right);
    shapes += face([T, R, B, L], top);
  }
  return shapes;
}

const classic = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="blue" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BLUE_TOP}"/>
      <stop offset="1" stop-color="${BLUE_BOTTOM}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.2" r="0.75">
      <stop offset="0" stop-color="#a8c4ff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#a8c4ff" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.3"/>
    </filter>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000614" flood-opacity="0.5"/>
    </filter>
    <clipPath id="body"><path d="${squircle(512, 512, 412)}"/></clipPath>
  </defs>
  <path d="${squircle(512, 512, 412)}" fill="url(#blue)" filter="url(#shadow)"/>
  <g clip-path="url(#body)">
    <rect width="1024" height="1024" fill="url(#glow)"/>
    <g filter="url(#soft)">${cube()}</g>
  </g>
</svg>
`;

// Icon Composer's canvas is the icon shape itself, so the 824 px body grows to fill all 1024 px.
const layer = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <g transform="translate(512 512) scale(${f(1024 / 824)}) translate(-512 -512)">${cube()}</g>
</svg>
`;

// Icon Composer colours are "space:r,g,b,a" with 0..1 channels.
const srgb = (hex) => `srgb:${[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(',')},1.00000`;
const iconJson = {
  fill: { 'linear-gradient': [srgb(BLUE_TOP), srgb(BLUE_BOTTOM)], orientation: { start: { x: 0.5, y: 0 }, stop: { x: 0.5, y: 1 } } },
  groups: [{ layers: [{ name: 'cube', 'image-name': 'cube.png' }], shadow: { kind: 'neutral', opacity: 0.5 }, translucency: { enabled: false, value: 0.5 } }],
  'supported-platforms': { squares: 'shared' },
};

writeFileSync(out, mode === '--layer' ? layer : mode === '--json' ? JSON.stringify(iconJson, null, 2) + '\n' : classic);
