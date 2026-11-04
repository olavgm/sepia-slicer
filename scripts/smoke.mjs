// End-to-end smoke test: opens the built app, drops two models, assigns toolheads,
// slices with OrcaSlicer and saves screenshots of each screen.
// Usage: npm run build && node scripts/smoke.mjs <screenshot-folder>
import { _electron as electron } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = process.argv[2] ?? 'smoke-shots';
mkdirSync(out, { recursive: true });

/** Binary STL for a box, or an n-sided prism when sides > 4. */
function prismStl(w, d, h, sides = 4) {
  const tris = [];
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 * i) / sides + Math.PI / sides;
    ring.push([(Math.cos(a) * w) / 2 / Math.cos(Math.PI / sides), (Math.sin(a) * d) / 2 / Math.cos(Math.PI / sides)]);
  }
  for (let i = 0; i < sides; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % sides];
    tris.push([[x1, y1, 0], [x2, y2, h], [x2, y2, 0]], [[x1, y1, 0], [x1, y1, h], [x2, y2, h]]);
    tris.push([[0, 0, 0], [x2, y2, 0], [x1, y1, 0]], [[0, 0, h], [x1, y1, h], [x2, y2, h]]);
  }
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const t of tris) {
    o += 12;
    for (const [x, y, z] of t) {
      buf.writeFloatLE(x, o);
      buf.writeFloatLE(y, o + 4);
      buf.writeFloatLE(z, o + 8);
      o += 12;
    }
    o += 2;
  }
  return [...buf];
}

const app = await electron.launch({ executablePath: require('electron'), args: ['.'], env: { ...process.env, LANG: 'es_ES.UTF-8' } });
const page = await app.firstWindow();
await page.setViewportSize({ width: 1440, height: 900 });
// Start from clean preferences, in Spanish and light mode.
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('sepia-prefs', JSON.stringify({ state: { theme: 'light', lang: 'es', printerHost: '' }, version: 0 }));
});
await page.reload();
await page.waitForSelector('.settings-scroll .setting', { timeout: 30000 });
await page.screenshot({ path: `${out}/1-empty.png` });

// Drop two models onto the window.
await page.evaluate(
  ([box, hex]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(box)], 'caja.stl'));
    dt.items.add(new File([new Uint8Array(hex)], 'maceta_hexagonal.stl'));
    document.querySelector('.app').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  },
  [prismStl(30, 30, 12, 4), prismStl(40, 40, 18, 6)],
);
await page.waitForSelector('.obj-row >> nth=1');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/2-prepare.png` });

// Select the first object and give it more walls than the rest of the plate.
await page.click('.obj-row >> nth=0 >> button >> nth=0');
await page.fill('#s-wall_loops', '5');
await page.press('#s-wall_loops', 'Enter');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/3-piece.png` });
await page.click('.obj-row >> nth=0 >> button >> nth=0');

// Change a plate setting and open the palette.
await page.keyboard.press('Meta+k');
await page.fill('.palette-input input', 'relleno');
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/4-palette.png` });
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/5-jump.png` });

// Slice.
await page.click('.top-actions .btn-primary');
await page.waitForSelector('.timeline', { timeout: 180000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/6-preview.png` });
const summary = await page.textContent('.left');
console.log('SUMMARY', summary?.replace(/\s+/g, ' ').slice(0, 300));

// Dark theme and English.
await page.click('.top-actions .icon-btn');
await page.click('.menu [role=radiogroup] >> nth=0 >> [role=radio] >> nth=2');
await page.click('.menu [role=radiogroup] >> nth=1 >> [role=radio] >> nth=0');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/7-dark-en.png` });

await app.close();
console.log('ok');
