// Things the UI does that involve more than one piece of state: loading models, slicing, sending, editing.
import * as THREE from 'three';
import { unzipSync, zipSync } from 'fflate';
import { useApp, effectiveOverrides, newId, objectsOnPlate, plateValue, IDENTITY, type Part, type SceneObject } from './state/app';
import { cleanGeometry, geometries, geometryFromFile, objectBounds, partWorldMatrix } from './scene/models';
import { cutMesh } from './scene/cut';
import { arrange, objectRect, type Rect } from './scene/arrange';
import { isOn } from './settings/format';
import { write3mf } from './project/threemf-write';
import { read3mf } from './project/threemf-read';
import { fmt } from './i18n';
import { en } from './i18n/en';
import { es } from './i18n/es';
import type { OpenedModel, SettingsRequest, SliceWarning } from '@shared/types';
import { BED } from './scene/stage';
import { usePrefs } from './state/prefs';

const dict = () => (usePrefs.getState().lang === 'es' ? es : en);

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
  await loadFilamentBases();
}

/** Resolves each toolhead's filament profile, for the filament part of the settings list. */
export async function loadFilamentBases(): Promise<void> {
  const heads = useApp.getState().heads;
  const filamentBase = await Promise.all(heads.map((h) => window.sepia.resolveFilament(h.filament).catch(() => ({}))));
  useApp.setState({ filamentBase });
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

// ---------- Notices ----------

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
export function showNotice(text: string): void {
  clearTimeout(noticeTimer);
  useApp.setState({ notice: text });
  noticeTimer = setTimeout(() => useApp.setState({ notice: null }), 4000);
}

// ---------- Placing objects ----------

const firstNumber = (v: unknown, fallback: number) => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : fallback;
};

const usesSeveralHeads = (objects: SceneObject[]) => {
  const heads = new Set<number>();
  for (const o of objects) {
    heads.add(o.head);
    for (const p of o.parts) {
      if (p.head !== null) heads.add(p.head);
      if (p.paintColor?.some((v) => v > 0)) heads.add(-1);
    }
  }
  return heads.size > 1;
};

/** Where Orca will put the prime tower, if the plate uses more than one toolhead. */
function primeTowerArea(objects: SceneObject[]): Rect[] {
  const s = useApp.getState();
  if (!usesSeveralHeads(objects)) return [];
  if (!isOn(plateValue(s, 'enable_prime_tower') || '1')) return [];
  const x = firstNumber(s.processBase.wipe_tower_x, 15);
  const y = firstNumber(s.processBase.wipe_tower_y, 220);
  const w = firstNumber(plateValue(s, 'prime_tower_width'), 35);
  const brim = firstNumber(plateValue(s, 'prime_tower_brim_width'), 5);
  return [{ x: x - brim, y: y - brim, w: w + brim * 2, h: w + brim * 2 }];
}

/** Moves new objects into free space on their plate, away from what is there and from the prime tower. */
function placeInFreeSpace(newObjects: SceneObject[]): SceneObject[] {
  const s = useApp.getState();
  const placed: SceneObject[] = [];
  for (const o of newObjects) {
    const others = [...s.objects.filter((x) => x.plate === o.plate), ...placed.filter((x) => x.plate === o.plate)];
    const free = arrange([o], [...others.map(objectRect), ...primeTowerArea([...others, o])]).positions.get(o.id);
    placed.push(free ? { ...o, ...free } : o);
  }
  return placed;
}

/** Lays every object on the plate on screen out without overlaps. One undo step. */
export function arrangeObjects(): void {
  const s = useApp.getState();
  const objects = objectsOnPlate(s);
  if (objects.length === 0) return;
  const { positions, didNotFit } = arrange(objects, primeTowerArea(objects));
  s.record();
  useApp.setState({ objects: s.objects.map((o) => (positions.has(o.id) ? { ...o, ...positions.get(o.id)! } : o)) });
  useApp.getState().set({ dirty: true });
  outdatePlate();
  if (didNotFit.length) showNotice(fmt(dict().edit.didNotFit, { count: didNotFit.length }));
}

function outdatePlate() {
  const s = useApp.getState();
  useApp.setState({ sliceOutdated: s.gcode !== null, dirty: true });
}

// ---------- Adding models ----------

function singlePartObject(name: string, geometry: THREE.BufferGeometry, head: number, plate: string): SceneObject {
  const partId = newId();
  geometries.set(partId, geometry);
  return {
    id: newId(),
    name,
    head,
    plate,
    x: 135,
    y: 135,
    quat: [0, 0, 0, 1],
    scale: [1, 1, 1],
    overrides: {},
    parts: [{ id: partId, name, head: null, matrix: [...IDENTITY] }],
  };
}

/** Adds models to the plate on screen. 3MF files keep their objects, parts and toolheads. */
export function addModels(models: OpenedModel[]): string[] {
  const failed: string[] = [];
  const s = useApp.getState();
  const fresh: SceneObject[] = [];
  let nextHead = objectsOnPlate(s).length % 4;
  for (const model of models) {
    try {
      if (model.error) throw new Error(model.error);
      if (model.ext === '3mf') {
        const read = read3mf(unzipSync(new Uint8Array(model.data)));
        if (read.objects.length === 0) throw new Error('empty');
        for (const o of read.objects) fresh.push({ ...o, plate: s.plate });
        if (read.skipped.length) showNotice(fmt(dict().files.skippedParts, { what: read.skipped.join(', ') }));
      } else {
        fresh.push(singlePartObject(model.name, geometryFromFile(model.ext, model.data), nextHead, s.plate));
        nextHead = (nextHead + 1) % 4;
      }
    } catch {
      failed.push(model.name);
    }
  }
  if (fresh.length) {
    s.record();
    const placed = placeInFreeSpace(fresh);
    useApp.setState((st) => ({ objects: [...st.objects, ...placed], selectedIds: placed.map((o) => o.id), tab: 'prepare' }));
    outdatePlate();
  }
  if (failed.length) reportUnreadable(failed);
  return failed;
}

function reportUnreadable(names: string[]): void {
  const t = dict();
  const message = names.length === 1 ? fmt(t.models.openFailed, { name: names[0] }) : fmt(t.models.openFailedMany, { count: names.length, names: names.join(', ') });
  window.sepia.ask(message, t.models.openFailedDetail, [t.actions.close]);
}

export async function openModelsDialog(): Promise<string[]> {
  return addModels(await window.sepia.openModels());
}

export const MODEL_EXTENSIONS = ['stl', '3mf', 'obj', 'step', 'stp'];

export async function filesToModels(files: FileList | File[]): Promise<OpenedModel[]> {
  const out: OpenedModel[] = [];
  for (const file of Array.from(files)) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!MODEL_EXTENSIONS.includes(ext)) continue;
    const name = file.name.replace(/\.[^.]+$/, '');
    const data = await file.arrayBuffer();
    // STEP needs OpenCascade, which only the main process loads; it comes back as STL.
    out.push(ext === 'step' || ext === 'stp' ? await window.sepia.convertModel(name, ext, data) : { name, ext, data });
  }
  return out;
}

// ---------- Editing ----------

/** A copy of an object with new ids; parts share their geometry with the original. */
function cloneObject(o: SceneObject, plate: string): SceneObject {
  const parts: Part[] = o.parts.map((p) => {
    const id = newId();
    const g = geometries.get(p.id);
    if (g) geometries.set(id, g);
    return { ...p, id };
  });
  return { ...o, id: newId(), plate, parts, name: o.name };
}

export function copySelection(): void {
  const s = useApp.getState();
  const selected = s.objects.filter((o) => s.selectedIds.includes(o.id));
  if (selected.length) useApp.setState({ clipboard: selected });
}

export function paste(objects?: SceneObject[]): void {
  const s = useApp.getState();
  const source = objects ?? s.clipboard;
  if (source.length === 0) return;
  s.record();
  const copies = placeInFreeSpace(source.map((o) => cloneObject(o, s.plate)));
  useApp.setState((st) => ({ objects: [...st.objects, ...copies], selectedIds: copies.map((o) => o.id) }));
  outdatePlate();
}

export function duplicateSelection(): void {
  const s = useApp.getState();
  paste(s.objects.filter((o) => s.selectedIds.includes(o.id)));
}

export function deleteSelection(): void {
  const s = useApp.getState();
  s.removeObjects(s.selectedIds);
}

/** Mirrors the selected objects along one axis. */
export function mirrorSelection(axis: 0 | 1 | 2): void {
  const s = useApp.getState();
  if (s.selectedIds.length === 0) return;
  s.record();
  useApp.setState({
    objects: s.objects.map((o) => {
      if (!s.selectedIds.includes(o.id)) return o;
      const scale = [...o.scale] as SceneObject['scale'];
      scale[axis] = -scale[axis];
      return { ...o, scale };
    }),
  });
  outdatePlate();
}

export function moveSelectionToPlate(plate: string): void {
  const s = useApp.getState();
  const moving = s.objects.filter((o) => s.selectedIds.includes(o.id)).map((o) => ({ ...o, plate }));
  if (moving.length === 0) return;
  s.record();
  const others = s.objects.filter((o) => !s.selectedIds.includes(o.id));
  useApp.setState({ objects: others });
  const placed = placeInFreeSpace(moving);
  useApp.setState({ objects: [...others, ...placed], selectedIds: [] });
  outdatePlate();
}

// ---------- Slicing ----------

export function settingsRequest(): SettingsRequest {
  const s = useApp.getState();
  const { process, machine } = effectiveOverrides(s);
  return {
    machine: s.catalog!.machine,
    process: s.process,
    processOverrides: process,
    machineOverrides: machine,
    heads: s.heads,
    filamentOverrides: s.filamentOverrides,
  };
}

export async function sliceNow(): Promise<void> {
  const s = useApp.getState();
  if (s.slicing) return;
  if (!s.engine?.found) {
    useApp.setState({ sliceError: { error: 'engine-not-found' }, tab: 'preview' });
    return;
  }
  const objects = objectsOnPlate(s);
  if (objects.length === 0) {
    useApp.setState({ sliceError: { error: 'no-objects' }, tab: 'preview' });
    return;
  }
  // Orca drops objects that are wholly off the bed without a word: catch them here.
  const own: SliceWarning[] = [];
  for (const o of objects) {
    const b = objectBounds(o);
    const outside = b.max.x < 0 || b.min.x > BED || b.max.y < 0 || b.min.y > BED;
    const partly = !outside && (b.min.x < -0.01 || b.max.x > BED + 0.01 || b.min.y < -0.01 || b.max.y > BED + 0.01 || b.max.z > BED);
    if (outside) own.push({ code: 'outside-bed', message: '', objectName: o.name });
    else if (partly) own.push({ code: 'partly-outside-bed', message: '', objectName: o.name });
  }
  useApp.setState({ slicing: true, sliceError: null, warnings: own, tab: 'preview' });
  const plate = s.plates.find((p) => p.id === s.plate)!;
  const project = zipSync(write3mf({ objects, plates: [plate], engineVersion: s.engine.version ?? '2.4.2', plateOffsets: false }), { level: 1 });
  const result = await window.sepia.slice({ ...settingsRequest(), project, objectCount: objects.length });
  // Sepia's own checks first, without repeating what Orca also reported.
  const warnings = [...own, ...(result.warnings ?? []).filter((w) => !own.some((x) => x.code === w.code && x.objectName === w.objectName))];
  if (!result.ok || !result.gcode) {
    useApp.setState({ slicing: false, sliceError: { error: result.error ?? 'unknown', log: result.log }, warnings });
    return;
  }
  const parsed = await new Promise<import('./preview/gcode').ParsedGcode>((done) => {
    const w = gcodeWorker();
    w.onmessage = (event) => done(event.data);
    w.postMessage(result.gcode);
  });
  // The user may have switched plates while Orca worked: file the result under the plate it belongs to.
  const now = useApp.getState();
  if (now.plate === plate.id) useApp.setState({ slicing: false, gcode: result.gcode, parsed, sliceOutdated: false, warnings });
  else useApp.setState({ slicing: false, results: { ...now.results, [plate.id]: { gcode: result.gcode, parsed, outdated: false, warnings } } });
}

export function gcodeFileName(): string {
  const s = useApp.getState();
  const names = objectsOnPlate(s).map((o) => o.name);
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

/** Size of the selection on the bed, for the transform panel. */
export function selectionSize(o: SceneObject): THREE.Vector3 {
  return objectBounds(o).getSize(new THREE.Vector3());
}

// ---------- Cutting ----------

/**
 * Cuts an object with the horizontal plane at `height` mm above the bed. Each half becomes an object
 * of its own, with its parts' toolheads; painting does not survive the cut, because the triangles change.
 */
export function cutObject(id: string, height: number, flipTop: boolean): void {
  const s = useApp.getState();
  const o = s.objects.find((x) => x.id === id);
  if (!o) return;
  const halves: { above: Part[]; below: Part[] } = { above: [], below: [] };
  for (const p of o.parts) {
    const g = geometries.get(p.id);
    if (!g) continue;
    // Cut in bed coordinates, where the plane is horizontal.
    const world = g.clone().applyMatrix4(partWorldMatrix(o, p));
    const { above, below } = cutMesh(world.getAttribute('position').array as Float32Array, { normal: [0, 0, 1], constant: -height });
    for (const [side, positions] of [['above', above], ['below', below]] as const) {
      if (positions.length < 9) continue;
      const piece = new THREE.BufferGeometry();
      piece.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const partId = newId();
      geometries.set(partId, cleanGeometry(piece));
      halves[side].push({ id: partId, name: p.name, head: p.head, matrix: [...IDENTITY] });
    }
  }
  if (halves.above.length === 0 || halves.below.length === 0) {
    showNotice(dict().cut.missed);
    return;
  }
  const make = (parts: Part[], suffix: string, flip: boolean): SceneObject => {
    // Centre the parts on their joint footprint, so the object's position is where it stands.
    const box = new THREE.Box3();
    for (const p of parts) box.union(geometries.get(p.id)!.boundingBox!);
    const centre = new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z);
    const recentre = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z).toArray();
    return {
      ...o,
      id: newId(),
      name: `${o.name} ${suffix}`,
      x: centre.x,
      y: centre.y,
      quat: flip ? [1, 0, 0, 0] : [0, 0, 0, 1],
      scale: [1, 1, 1],
      parts: parts.map((p) => ({ ...p, matrix: recentre })),
    };
  };
  const pieces = [make(halves.below, '(1)', false), make(halves.above, '(2)', flipTop)];
  s.record();
  useApp.setState({ objects: s.objects.filter((x) => x.id !== id) });
  const placed = placeInFreeSpace(pieces);
  useApp.setState((st) => ({ objects: [...st.objects, ...placed], selectedIds: placed.map((x) => x.id), tool: 'move' }));
  outdatePlate();
}
