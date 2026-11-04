// Drives OrcaSlicer's command line: finds the app, reads its Snapmaker U1 profiles and slices.
import { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import type { Config, EngineInfo, ProfileCatalog, SliceRequest, SliceResult } from '@shared/types';

export const U1_MACHINE = 'Snapmaker U1 (0.4 nozzle)';

interface Candidate {
  app: string;
  binary: string;
}

const CANDIDATES: Candidate[] = [
  { app: '/Applications/OrcaSlicer.app', binary: 'Contents/MacOS/OrcaSlicer' },
  { app: '/Applications/Snapmaker Orca.app', binary: 'Contents/MacOS/Snapmaker_Orca' },
];

let engine: EngineInfo | null = null;
type Kind = 'machine' | 'process' | 'filament';
let index: Record<Kind, Map<string, Config>> | null = null;

export function findEngine(): EngineInfo {
  if (engine) return engine;
  for (const c of CANDIDATES) {
    const executable = join(c.app, c.binary);
    const profilesDir = join(c.app, 'Contents/Resources/profiles/Snapmaker');
    if (!existsSync(executable) || !existsSync(profilesDir)) continue;
    let version: string | undefined;
    try {
      const plist = readFileSync(join(c.app, 'Contents/Info.plist'), 'utf8');
      version = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
    } catch {
      version = undefined;
    }
    engine = { found: true, executable, profilesDir, version, appName: c.app.split('/').pop()?.replace('.app', '') };
    return engine;
  }
  engine = { found: false };
  return engine;
}

function loadIndex(): Record<Kind, Map<string, Config>> {
  if (index) return index;
  const info = findEngine();
  if (!info.found || !info.profilesDir) throw new Error('OrcaSlicer not found');
  const result = { machine: new Map(), process: new Map(), filament: new Map() } as Record<Kind, Map<string, Config>>;
  for (const kind of Object.keys(result) as Kind[]) {
    const dir = join(info.profilesDir, kind);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Config;
        if (typeof data.name === 'string') result[kind].set(data.name, data);
      } catch {
        // A broken profile file should not stop the app.
      }
    }
  }
  index = result;
  return result;
}

/** Profile with its whole inheritance chain merged in, like Orca does when it loads a preset. */
export function resolve(kind: Kind, name: string): Config {
  const idx = loadIndex();
  const own = idx[kind].get(name);
  if (!own) throw new Error(`Profile not found: ${kind} "${name}"`);
  const inherits = typeof own.inherits === 'string' ? own.inherits : '';
  const parent = inherits ? resolve(kind, inherits) : {};
  const merged: Config = { ...parent, ...own };
  delete merged.inherits;
  return merged;
}

const asList = (v: Config[string] | undefined): string[] => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []);

export function catalog(): ProfileCatalog {
  const idx = loadIndex();
  const processes: ProfileCatalog['processes'] = [];
  for (const name of idx.process.keys()) {
    const own = idx.process.get(name)!;
    if (own.instantiation === 'false') continue;
    const p = resolve('process', name);
    if (!asList(p.compatible_printers).includes(U1_MACHINE)) continue;
    processes.push({ name, layerHeight: Number(p.layer_height) || 0 });
  }
  processes.sort((a, b) => a.layerHeight - b.layerHeight || a.name.localeCompare(b.name));
  const filaments: ProfileCatalog['filaments'] = [];
  for (const name of idx.filament.keys()) {
    const own = idx.filament.get(name)!;
    if (own.instantiation === 'false') continue;
    const f = resolve('filament', name);
    if (!asList(f.compatible_printers).includes(U1_MACHINE)) continue;
    filaments.push({ name, type: asList(f.filament_type)[0] ?? '' });
  }
  filaments.sort((a, b) => a.name.localeCompare(b.name));
  return { machine: U1_MACHINE, processes, filaments };
}

function applyOverrides(base: Config, overrides: Record<string, string>): Config {
  const out: Config = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const current = base[key];
    out[key] = Array.isArray(current) ? current.map(() => value) : value;
  }
  return out;
}

function run(executable: string, args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    execFile(executable, args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      done({ code, output: `${stdout}\n${stderr}` });
    });
  });
}

const tail = (text: string, lines = 30) => text.split('\n').filter(Boolean).slice(-lines).join('\n');

function writeProfiles(dir: string, machineName: string, processName: string, processOverrides: Record<string, string>, machineOverrides: Record<string, string>) {
  const machine = applyOverrides(resolve('machine', machineName), machineOverrides);
  Object.assign(machine, { name: 'Sepia printer', inherits: machineName, from: 'User' });
  const process = applyOverrides(resolve('process', processName), processOverrides);
  Object.assign(process, { name: 'Sepia process', inherits: processName, from: 'User', compatible_printers: [machineName] });
  writeFileSync(join(dir, 'machine.json'), JSON.stringify(machine));
  writeFileSync(join(dir, 'process.json'), JSON.stringify(process));
  return `${join(dir, 'machine.json')};${join(dir, 'process.json')}`;
}

function writeFilament(dir: string, index: number, filamentName: string, color: string, machineName: string): string {
  const f = resolve('filament', filamentName);
  // Orca needs a colour on every filament, or it crashes when several are loaded.
  Object.assign(f, { name: `Sepia head ${index + 1}`, inherits: filamentName, from: 'User', compatible_printers: [machineName], filament_colour: [color] });
  const file = join(dir, `head${index + 1}.json`);
  writeFileSync(file, JSON.stringify(f));
  return file;
}

/** A closed tetrahedron: the smallest valid model Orca accepts for exporting its settings. */
const PROBE_STL = `solid probe
facet normal 0 0 -1
outer loop
vertex 0 0 0
vertex 0 10 0
vertex 10 0 0
endloop
endfacet
facet normal 0 -1 0
outer loop
vertex 0 0 0
vertex 10 0 0
vertex 0 0 10
endloop
endfacet
facet normal -1 0 0
outer loop
vertex 0 0 0
vertex 0 0 10
vertex 0 10 0
endloop
endfacet
facet normal 0.577 0.577 0.577
outer loop
vertex 10 0 0
vertex 0 10 0
vertex 0 0 10
endloop
endfacet
endsolid probe
`;

const fullCache = new Map<string, Config>();

/**
 * Orca's complete config for a process, defaults included. Profile files only list what differs
 * from Orca's built-in defaults, so the UI needs this to show every value.
 */
async function fullConfig(processName: string): Promise<Config> {
  const cached = fullCache.get(processName);
  if (cached) return cached;
  const info = findEngine();
  if (!info.found || !info.executable) return {};
  const dir = mkdtempSync(join(tmpdir(), 'sepia-defaults-'));
  const settings = writeProfiles(dir, U1_MACHINE, processName, {}, {});
  const filament = writeFilament(dir, 0, 'Snapmaker PLA @U1', '#FFFFFF', U1_MACHINE);
  writeFileSync(join(dir, 'probe.stl'), PROBE_STL);
  const out = join(dir, 'full.json');
  await run(info.executable, ['--arrange', '0', '--load-settings', settings, '--load-filaments', filament, '--export-settings', out, '--outputdir', dir, join(dir, 'probe.stl')]);
  try {
    const full = JSON.parse(readFileSync(out, 'utf8')) as Config;
    fullCache.set(processName, full);
    return full;
  } catch {
    return {};
  }
}

export async function resolveProcessForUi(name: string): Promise<Config> {
  return { ...(await fullConfig(name)), ...resolve('process', name) };
}

export async function resolveMachineForUi(name: string, processName: string): Promise<Config> {
  return { ...(await fullConfig(processName)), ...resolve('machine', name) };
}

export async function slice(request: SliceRequest): Promise<SliceResult> {
  const started = Date.now();
  const info = findEngine();
  if (!info.found || !info.executable) return { ok: false, error: 'engine-not-found', durationMs: 0 };
  if (request.objects.length === 0) return { ok: false, error: 'no-objects', durationMs: 0 };

  const dir = mkdtempSync(join(tmpdir(), 'sepia-'));
  try {
    const settings = writeProfiles(dir, request.machine, request.process, request.processOverrides, request.machineOverrides);
    // All four toolheads are loaded so that head N is always filament N.
    const filamentFiles = request.heads.map((head, i) => writeFilament(dir, i, head.filament, head.color, request.machine));
    const modelFiles = request.objects.map((o, i) => {
      const file = join(dir, `object${i + 1}.stl`);
      writeFileSync(file, Buffer.from(o.stl));
      return file;
    });

    const common = ['--load-settings', settings, '--load-filaments', filamentFiles.join(';'), '--outputdir', dir];
    const ids = ['--load-filament-ids', request.objects.map((o) => String(o.head + 1)).join(',')];
    let result: { code: number; output: string };
    if (request.objects.some((o) => Object.keys(o.overrides).length > 0)) {
      // Orca's command line has no option for per-object settings, but its 3MF project format does:
      // export a project, add each object's settings to it, then slice the project.
      const exported = await run(info.executable, ['--arrange', '0', ...common, ...ids, '--export-3mf', 'project.3mf', ...modelFiles]);
      const project = join(dir, 'project.3mf');
      if (exported.code !== 0 || !existsSync(project)) {
        return { ok: false, error: `orca-exit-${exported.code}`, log: tail(exported.output), durationMs: Date.now() - started };
      }
      addObjectSettings(project, request.objects.map((o) => o.overrides));
      result = await run(info.executable, ['--slice', '0', ...common, project]);
    } else {
      result = await run(info.executable, ['--slice', '0', '--arrange', '0', ...common, ...ids, ...modelFiles]);
    }
    const { code, output } = result;
    const gcodePath = join(dir, 'plate_1.gcode');
    if (code !== 0 || !existsSync(gcodePath)) {
      return { ok: false, error: `orca-exit-${code}`, log: tail(output), durationMs: Date.now() - started };
    }
    return { ok: true, gcode: readFileSync(gcodePath, 'utf8'), gcodePath, durationMs: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - started };
  }
}

/** Writes per-object settings into a 3MF project's model_settings.config, objects in load order. */
export function addObjectSettings(projectPath: string, overrides: Record<string, string>[]): void {
  const files = unzipSync(readFileSync(projectPath));
  const name = 'Metadata/model_settings.config';
  let index = 0;
  const xml = strFromU8(files[name]).replace(/(<object id="[^"]*">\s*\n)/g, (match) => {
    const own = overrides[index++] ?? {};
    const lines = Object.entries(own)
      .map(([key, value]) => `    <metadata key="${escapeXml(key)}" value="${escapeXml(value)}"/>\n`)
      .join('');
    return match + lines;
  });
  files[name] = strToU8(xml);
  writeFileSync(projectPath, zipSync(files));
}

const escapeXml = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
