// Rasterises an SVG to a transparent PNG of the given size with Electron's offscreen renderer.
// Usage: electron scripts/icon/render.cjs <in.svg> <out.png> <size>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const [svgPath, outPath, sizeArg] = process.argv.slice(2);
const size = Number(sizeArg || 1024);
const fail = (error) => {
  console.error(error);
  app.exit(1);
};
setTimeout(() => fail(new Error('timed out rendering the icon')), 20000).unref();
process.on('uncaughtException', fail);

app.disableHardwareAcceleration();
app.dock?.hide();
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({ width: size, height: size, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
    let last;
    win.webContents.on('paint', (_e, _d, image) => {
      last = image;
    });
    const svg = fs.readFileSync(svgPath).toString('base64');
    const html = `<html><body style="margin:0;background:transparent;overflow:hidden"><img src="data:image/svg+xml;base64,${svg}" width="${size}" height="${size}" style="display:block"></body></html>`;
    await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
    await new Promise((r) => setTimeout(r, 400));
    win.webContents.invalidate();
    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync(outPath, last.toPNG());
    app.exit(0);
  })
  .catch(fail);
