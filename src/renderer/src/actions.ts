// Things the UI does that involve more than one piece of state: loading models, slicing, sending.
import { useApp, effectiveOverrides, newId, type SceneObject } from './state/app';
import { geometries, geometryFromFile, objectMatrix, toStl } from './scene/models';
import { BED } from './scene/stage';
import type { OpenedModel } from '@shared/types';
import { usePrefs } from './state/prefs';

let worker: Worker | null = null;
function gcodeWorker(): Worker {
  worker ??= new Worker(new URL('./preview/gcode.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

export async function loadProfiles(processName?: string): Promise<void> {
  const app = useApp.getState();
  const engine = app.engine ?? (await window.sepia.engineInfo());
  if (!engine.found) {
    useApp.setState({ engine });
    return;
  }
  const catalog = app.catalog ?? (await window.sepia.catalog());
  const process = processName ?? app.process;
  const [processBase, machineBase] = await Promise.all([window.sepia.resolveProcess(process), window.sepia.resolveMachine(catalog.machine, process)]);
  useApp.setState({ engine, catalog, process, processBase, machineBase });
}

export async function selectProfile(value: string): Promise<void> {
  const s = useApp.getState();
  const user = s.userProfiles.find((p) => `user:${p.name}` === value);
  if (user) {
    await loadProfiles(user.process);
    useApp.setState({ userProfile: user.name, profileOverrides: user.overrides, overrides: {}, sliceOutdated: s.gcode !== null });
  } else {
    await loadProfiles(value);
    useApp.setState({ userProfile: null, profileOverrides: {}, sliceOutdated: s.gcode !== null });
  }
}

export function addModels(models: OpenedModel[]): string[] {
  const failed: string[] = [];
  for (const model of models) {
    try {
      const geometry = geometryFromFile(model.ext, model.data);
      const id = newId();
      geometries.set(id, geometry);
      const count = useApp.getState().objects.length;
      // Place new objects in a loose grid around the centre so they do not land on top of each other.
      const step = Math.min(90, Math.max(40, (geometry.boundingSphere?.radius ?? 30) * 1.4));
      const ring = [
        [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
      ][count % 9];
      const object: SceneObject = {
        id,
        name: model.name,
        head: count % 4,
        x: Math.min(BED - 20, Math.max(20, BED / 2 + ring[0] * step)),
        y: Math.min(BED - 20, Math.max(20, BED / 2 + ring[1] * step)),
        quat: [0, 0, 0, 1],
        scale: 1,
        overrides: {},
      };
      useApp.getState().addObject(object);
    } catch {
      failed.push(model.name);
    }
  }
  return failed;
}

export async function openModelsDialog(): Promise<string[]> {
  const models = await window.sepia.openModels();
  return addModels(models);
}

export async function filesToModels(files: FileList | File[]): Promise<OpenedModel[]> {
  const out: OpenedModel[] = [];
  for (const file of Array.from(files)) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext !== 'stl' && ext !== '3mf') continue;
    out.push({ name: file.name.replace(/\.[^.]+$/, ''), ext, data: await file.arrayBuffer() });
  }
  return out;
}

export async function sliceNow(): Promise<void> {
  const s = useApp.getState();
  if (s.slicing) return;
  if (!s.engine?.found) {
    useApp.setState({ sliceError: { error: 'engine-not-found' }, tab: 'preview' });
    return;
  }
  if (s.objects.length === 0) {
    useApp.setState({ sliceError: { error: 'no-objects' }, tab: 'preview' });
    return;
  }
  useApp.setState({ slicing: true, sliceError: null, tab: 'preview' });
  const { process, machine } = effectiveOverrides(s);
  const objects = s.objects.map((o) => {
    const geometry = geometries.get(o.id)!;
    return { id: o.id, name: o.name, head: o.head, overrides: o.overrides, stl: toStl(geometry, objectMatrix(o, geometry)) };
  });
  const result = await window.sepia.slice({
    machine: s.catalog!.machine,
    process: s.process,
    processOverrides: process,
    machineOverrides: machine,
    heads: s.heads,
    objects,
  });
  if (!result.ok || !result.gcode) {
    useApp.setState({ slicing: false, sliceError: { error: result.error ?? 'unknown', log: result.log } });
    return;
  }
  const parsed = await new Promise<import('./preview/gcode').ParsedGcode>((done) => {
    const w = gcodeWorker();
    w.onmessage = (event) => done(event.data);
    w.postMessage(result.gcode);
  });
  useApp.setState({ slicing: false, gcode: result.gcode, parsed, sliceOutdated: false });
}

export function gcodeFileName(): string {
  const names = useApp.getState().objects.map((o) => o.name);
  const base = names.length === 1 ? names[0] : names.length > 1 ? `${names[0]}+${names.length - 1}` : 'sepia';
  return `${base.replace(/[^\w.+-]+/g, '_')}.gcode`;
}

export async function exportGcode(): Promise<void> {
  const gcode = useApp.getState().gcode;
  if (gcode) await window.sepia.saveGcode(gcode, gcodeFileName());
}

export async function sendToPrinter(start: boolean) {
  const gcode = useApp.getState().gcode;
  const host = usePrefs.getState().printerHost;
  if (!gcode || !host) return { ok: false, error: 'missing' };
  return window.sepia.printerUpload(host, gcode, gcodeFileName(), start);
}
