// End-to-end smoke test. Opens the built app with its own data folder and checks the main flows:
// loading models, per-piece settings, search, arrange, undo/redo, slicing with OrcaSlicer, the preview,
// saving and opening a project, and talking to a printer (a fake Moonraker on localhost).
// Saves a screenshot of each screen. Usage: npm run build && node scripts/smoke.mjs <screenshot-folder>
import { _electron as electron } from 'playwright-core';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
    // Counter-clockwise seen from outside, like the caps, so the mesh is consistently oriented.
    tris.push([[x1, y1, 0], [x2, y2, 0], [x2, y2, h]], [[x1, y1, 0], [x2, y2, h], [x1, y1, h]]);
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
const projectFile = join(userData, 'prueba.3mf');
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
// Show what goes wrong inside the page, so a failing step says why.
page.on('pageerror', (error) => console.log('  page error:', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.log('  console error:', message.text());
});
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
/** Selects only object row `n` (clicking a selected row would deselect it). */
async function selectRow(n) {
  const button = page.locator(`.obj-row >> nth=${n} >> button >> nth=0`);
  if ((await button.getAttribute('aria-pressed')) !== 'true' || (await page.locator('.obj-row[data-selected="true"]').count()) > 1) await button.click();
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
}
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

step('only this layer, moves inside it, pick a line');
await page.click('.views button >> nth=1');
await page.click('.only-layer');
assert.equal(await page.getAttribute('.only-layer', 'aria-pressed'), 'true');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/6a-only-layer.png` });
const layerMoves = Number(await page.getAttribute('#move-range', 'max'));
assert.ok(layerMoves > 10, `the layer has moves (${layerMoves})`);
await page.fill('#move-range', String(Math.round(layerMoves * 0.08)));
await page.waitForTimeout(300);
assert.equal(await page.textContent('.move-count'), `${Math.round(layerMoves * 0.08)}/${layerMoves}`);
await page.screenshot({ path: `${out}/6b-moves.png` });
// Click around the middle of the plate, where the models are, until a line answers.
const canvasBox = await page.locator('.center canvas').boundingBox();
const middle = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };
let pickedLine = false;
for (let r = 0; r <= 240 && !pickedLine; r += 8) {
  const around = Math.max(1, Math.round(r / 3));
  for (let i = 0; i < around && !pickedLine; i++) {
    const a = (i / around) * Math.PI * 2;
    await page.mouse.click(middle.x + Math.cos(a) * r, middle.y + Math.sin(a) * r);
    pickedLine = (await page.locator('.line-card').count()) > 0;
  }
}
assert.ok(pickedLine, 'clicking a line opens its card');
const card = (await page.textContent('.line-card'))?.replace(/\s+/g, ' ');
console.log('  ', card);
assert.match(card ?? '', /mm\/s/);
await page.screenshot({ path: `${out}/6c-pick.png` });
if ((await page.locator('.line-card-setting .btn').count()) > 0) {
  await page.click('.line-card-setting .btn');
  await page.waitForSelector('.setting[data-highlight="true"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/6d-pick-setting.png` });
}
await page.click('.line-card .icon-btn');
await page.click('.only-layer');
await page.click('.views button >> nth=0');

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

step('exact values: rotate 45° about Z');
// The box is still selected from the previous step.
await page.fill('#tf-rZ', '45');
await page.press('#tf-rZ', 'Enter');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/7b-transform.png` });

step('duplicate, then move the copy to a new plate');
await menu('duplicate');
await page.waitForTimeout(300);
assert.equal(await rows(), 3, 'duplicated');
await menu('addPlate');
await page.waitForTimeout(200);
assert.equal(await rows(), 0, 'the new plate is empty');
await page.click('.plate-btn >> nth=0');
await page.click('.obj-row >> nth=2 >> button >> nth=0');
await page.click('.obj-row >> nth=2 >> [aria-label^="Más de"]');
await page.click('.menu button:has-text("Mover a Placa 2")');
await page.waitForTimeout(300);
assert.equal(await rows(), 2, 'moved away from plate 1');
await page.click('.plate-btn >> nth=1');
assert.equal(await rows(), 1, 'and onto plate 2');

step('a 3MF with two parts on different heads and painted facets');
await page.evaluate((bytes) => {
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(bytes)], 'piezas.3mf'));
  document.querySelector('.app').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}, [...readFileSync(new URL('./fixtures/parts-and-paint.3mf', import.meta.url))]);
await page.waitForSelector('.part-list li');
await page.screenshot({ path: `${out}/7c-parts.png` });

step('paint a face of the box with head 4');
await selectRow(0);
await page.click('.toolbar .tool >> nth=5');
await page.click('.paint-choice >> nth=3');
await page.check('#brush-fill');
const canvas = page.locator('.center canvas');
const box = await canvas.boundingBox();
// Paint where the selected object is drawn: the middle of its selection box on screen.
const target = await page.evaluate(() => {
  const c = document.querySelector('.center canvas').getBoundingClientRect();
  return { x: c.width / 2, y: c.height / 2 };
});
void box;
await canvas.click({ position: target });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/7d-paint.png` });

step('slice plate 2 and check the toolheads Orca used');
await page.click('.toolbar .tool >> nth=0');
await page.click('.top-actions .btn-primary');
await page.waitForSelector('.layer-rail', { timeout: 180000 });
await page.waitForTimeout(500);
const plate2 = (await page.textContent('.left'))?.replace(/\s+/g, ' ');
console.log('  ', plate2?.slice(0, 200));
assert.match(plate2 ?? '', /3 PLA\s*[\d,]+ g/, 'the part on head 3 was printed');
await page.screenshot({ path: `${out}/7e-plate2-preview.png` });

step('cut the copy on plate 2 in two');
await page.click('.tabs .tab >> nth=0');
const before = await rows();
await selectRow(0);
await page.click('.toolbar .tool >> nth=4');
await page.click('.transform-panel .btn-primary');
await page.waitForTimeout(500);
assert.equal(await rows(), before + 1, 'one object became two');
await page.screenshot({ path: `${out}/7f-cut.png` });

step('save the project and slice it with OrcaSlicer itself');
await menu('save');
await page.waitForTimeout(1500);
const orcaOut = mkdtempSync(join(tmpdir(), 'sepia-orca-'));
execFileSync('/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer', ['--slice', '0', '--outputdir', orcaOut, projectFile], { stdio: 'ignore' });
const plates = readdirSync(orcaOut).filter((f) => f.endsWith('.gcode')).sort();
console.log('   OrcaSlicer sliced the saved project:', plates.join(', '));
assert.deepEqual(plates, ['plate_1.gcode', 'plate_2.gcode'], 'Orca slices both plates of the saved project');
await page.click('.plate-btn >> nth=0');

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
