// Builds the app icon under build/ from scripts/icon/make.mjs:
//   icon.svg, icon.png  the classic icon (1024 px), for the Dock in development
//   icon.icon/          the Icon Composer icon electron-builder compiles with actool (Xcode 26 or later);
//                       it also makes the .icns older macOS versions use from it
// Usage: npm run icon
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const build = join(here, '../../build');
const electron = createRequire(import.meta.url)('electron');

const make = (out, mode) => execFileSync(process.execPath, [join(here, 'make.mjs'), out, ...(mode ? [mode] : [])], { stdio: 'inherit' });
const render = (svg, out, size = 1024) =>
  execFileSync(electron, [join(here, 'render.cjs'), svg, out, String(size)], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 30000 });

make(join(build, 'icon.svg'));
render(join(build, 'icon.svg'), join(build, 'icon.png'));

const bundle = join(build, 'icon.icon');
rmSync(bundle, { recursive: true, force: true });
mkdirSync(join(bundle, 'Assets'), { recursive: true });
make(join(bundle, 'icon.json'), '--json');
const layerSvg = join(build, 'icon-layer.svg');
make(layerSvg, '--layer');
render(layerSvg, join(bundle, 'Assets', 'cube.png'));
console.log('build/icon.svg, build/icon.png, build/icon-layer.svg and build/icon.icon are ready');
