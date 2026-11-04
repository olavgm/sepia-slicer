// End-to-end smoke test. Opens the built app with its own data folder and checks the main flows:
// loading models, per-piece settings, search, arrange, undo/redo, slicing with OrcaSlicer, the preview,
// saving and opening a project, and talking to a printer (a fake Moonraker on localhost).
// Saves a screenshot of each screen. Usage: npm run build && node scripts/smoke.mjs <screenshot-folder>
import { _electron as electron } from 'playwright-core';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const out = process.argv[2] ?? 'smoke-shots';
mkdirSync(out, { recursive: true });
const step = (text) => console.log(`· ${text}`);

/** Binary STL for an n-sided prism (4 = box). */
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

// ---------- A fake U1: just enough of Moonraker's API ----------
const uploads = [];
const moonraker = createServer((req, res) => {
  const json = (body) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ result: body }));
  };
  if (req.url === '/printer/info') return json({ hostname: 'u1-de-prueba', state: 'ready', state_message: 'Printer is ready' });
  if (req.url?.startsWith('/printer/objects/query')) {
    return json({
      status: {
        extruder: { temperature: 214.6, target: 215 },
        extruder1: { temperature: 169.8, target: 170 },
        extruder2: { temperature: 24.1, target: 0 },
        extruder3: { temperature: 23.9, target: 0 },
        heater_bed: { temperature: 59.9, target: 60 },
        print_stats: { state: 'printing', filename: 'caja+1.gcode', print_duration: 1520 },
        display_status: { progress: 0.42 },
        toolhead: { extruder: 'extruder' },
      },
    });
  }
  if (req.url === '/server/webcams/list') return json({ webcams: [{ name: 'cam', enabled: true, snapshot_url: '/webcam/?action=snapshot' }] });
  if (req.url?.startsWith('/webcam/')) {
    res.setHeader('content-type', 'image/svg+xml');
    return res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#2a2f36"/><circle cx="320" cy="240" r="90" fill="#1F8A7E"/><text x="320" y="420" fill="#fff" font-size="28" text-anchor="middle" font-family="sans-serif">camara de prueba</text></svg>',
    );
  }
  if (req.url === '/server/files/upload' && req.method === 'POST') {
    let size = 0;
    req.on('data', (c) => (size += c.length));
    req.on('end', () => {
      uploads.push(size);
      json({ item: { path: 'caja.gcode' } });
    });
    return;
  }
  res.statusCode = 404;
  res.end();
});
await new Promise((done) => moonraker.listen(0, '127.0.0.1', done));
const printerHost = `127.0.0.1:${moonraker.address().port}`;

// ---------- The app ----------
const userData = mkdtempSync(join(tmpdir(), 'sepia-smoke-'));
const projectFile = join(userData, 'prueba.sepia');
const app = await electron.launch({ executablePath: require('electron'), args: ['.'], env: { ...process.env, SEPIA_USER_DATA: userData } });
// Native file dialogs cannot be clicked from a test: answer them with our project path.
await app.evaluate(({ dialog }, path) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  dialog.showMessageBox = async () => ({ response: 1 });
}, projectFile);
const menu = (command) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), command);
const title = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());

const page = await app.firstWindow();
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => {
  localStorage.setItem('sepia-prefs', JSON.stringify({ state: { theme: 'light', lang: 'es', printerHost: '' }, version: 0 }));
});
await page.reload();
await page.waitForSelector('.settings-scroll .setting', { timeout: 30000 });
await page.screenshot({ path: `${out}/1-empty.png` });

step('drop two models');
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
const rows = () => page.locator('.obj-row').count();
assert.equal(await rows(), 2);

step('arrange with the A key');
await page.locator('.center canvas').click({ position: { x: 40, y: 600 } });
await page.keyboard.press('a');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/2-prepare.png` });

step('per-piece setting');
await page.click('.obj-row >> nth=0 >> button >> nth=0');
await page.fill('#s-wall_loops', '5');
await page.press('#s-wall_loops', 'Enter');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/3-piece.png` });

step('delete, undo, redo, undo');
await page.click('.obj-row >> nth=1 >> button >> nth=0');
await page.locator('.center canvas').click({ position: { x: 40, y: 600 } });
await page.click('.obj-row >> nth=1 >> button >> nth=0');
await menu('delete');
await page.waitForTimeout(200);
assert.equal(await rows(), 1, 'deleted');
await menu('undo');
await page.waitForTimeout(200);
assert.equal(await rows(), 2, 'undo brings it back');
await menu('redo');
await page.waitForTimeout(200);
assert.equal(await rows(), 1, 'redo deletes it again');
await menu('undo');
await page.waitForTimeout(200);
assert.equal(await rows(), 2);

step('search');
await page.keyboard.press('Meta+k');
await page.fill('.palette-input input', 'relleno');
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/4-palette.png` });
await page.keyboard.press('Escape');

step('slice');
await page.click('.top-actions .btn-primary');
await page.waitForSelector('.layer-rail', { timeout: 180000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/5-preview.png` });
const summary = (await page.textContent('.left'))?.replace(/\s+/g, ' ');
console.log('  ', summary?.slice(0, 160));
assert.match(summary ?? '', /Cambios de cabezal/);
// The box (head 1) has 5 walls instead of 2: it must weigh more than the 5.9 g it weighs with 2.
const boxGrams = Number(summary?.match(/1 PLA\s*([\d,]+) g/)?.[1].replace(',', '.'));
assert.ok(boxGrams > 6.5, `per-piece walls reached the box (${boxGrams} g)`);
await page.focus('.layer-range');
for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowDown');
await page.click('.panel-handle.left');
await page.click('.panel-handle.right');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/6-preview-folded.png` });
await page.click('.panel-handle.left');
await page.click('.panel-handle.right');

step('save, new, open');
assert.equal(await page.locator('.brand .edited').count(), 1, 'shown as edited before saving');
await menu('save');
await page.waitForTimeout(500);
assert.ok(existsSync(projectFile), 'project file written');
assert.equal(await title(), 'prueba — Sepia');
assert.equal(await page.locator('.brand .edited').count(), 0, 'not edited after saving');
await menu('new');
await page.waitForTimeout(300);
assert.equal(await rows(), 0, 'new project is empty');
await menu('open');
await page.waitForSelector('.obj-row >> nth=1');
assert.equal(await rows(), 2, 'project reopened');
await page.click('.obj-row >> nth=0 >> button >> nth=0');
assert.equal(await page.inputValue('#s-wall_loops'), '5', 'per-piece setting survived the round trip');
await page.screenshot({ path: `${out}/7-reopened.png` });

step('printer status and camera');
await page.click('.tabs .tab >> nth=2');
await page.fill('#printer-host', printerHost);
await page.click('.printer-card button[type=submit]');
await page.waitForSelector('.temps li');
await page.waitForSelector('img.camera', { timeout: 10000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/8-printer.png` });

step('send to the printer');
await page.click('.tabs .tab >> nth=0');
await page.click('.top-actions .btn-primary');
await page.waitForSelector('.layer-rail', { timeout: 180000 });
await page.click('.top-actions .btn-primary');
await page.click('.menu .btn:not(.btn-primary)');
await page.waitForTimeout(1000);
assert.equal(uploads.length, 1, 'the printer received one upload');
assert.ok(uploads[0] > 10000, 'with a G-code file in it');

step('dark theme and English');
await page.click('.top-actions .icon-btn');
await page.click('.menu [role=radiogroup] >> nth=0 >> [role=radio] >> nth=2');
await page.click('.menu [role=radiogroup] >> nth=1 >> [role=radio] >> nth=0');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/9-dark-en.png` });

await app.close();
moonraker.close();
console.log('ok');
