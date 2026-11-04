// Sepia project files (.sepia): a zip with project.json and one STL per object.
import * as THREE from 'three';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { useApp, newId, type SceneObject } from './state/app';
import { geometries, geometryFromFile, toStl } from './scene/models';
import { loadProfiles, selectProfile } from './actions';
import { usePrefs } from './state/prefs';
import { fmt } from './i18n';
import { en } from './i18n/en';
import { es } from './i18n/es';
import type { HeadConfig } from '@shared/types';

const FORMAT = 'sepia-project';
const VERSION = 1;

interface ProjectFile {
  format: typeof FORMAT;
  version: number;
  process: string;
  userProfile: string | null;
  profileOverrides: Record<string, string>;
  overrides: Record<string, string>;
  heads: HeadConfig[];
  objects: (SceneObject & { mesh: string })[];
}

const dict = () => (usePrefs.getState().lang === 'es' ? es : en);

export function projectName(path: string | null): string {
  if (!path) return dict().untitled;
  return path.split(/[\\/]/).pop()!.replace(/\.sepia$/i, '');
}

export function serializeProject(): Uint8Array {
  const s = useApp.getState();
  const files: Record<string, Uint8Array> = {};
  const objects = s.objects.map((o) => {
    const mesh = `meshes/${o.id}.stl`;
    files[mesh] = new Uint8Array(toStl(geometries.get(o.id)!, new THREE.Matrix4()));
    return { ...o, mesh };
  });
  const doc: ProjectFile = {
    format: FORMAT,
    version: VERSION,
    process: s.process,
    userProfile: s.userProfile,
    profileOverrides: s.profileOverrides,
    overrides: s.overrides,
    heads: s.heads,
    objects,
  };
  files['project.json'] = strToU8(JSON.stringify(doc, null, 2));
  return zipSync(files, { level: 6 });
}

/** Reads a project file and replaces the current plate with it. Throws if the file is not a Sepia project. */
export async function loadProject(data: Uint8Array, path: string | null): Promise<void> {
  const files = unzipSync(data);
  const doc = JSON.parse(strFromU8(files['project.json'] ?? new Uint8Array())) as ProjectFile;
  if (doc.format !== FORMAT || typeof doc.version !== 'number' || doc.version > VERSION) throw new Error('not a Sepia project');

  const objects: SceneObject[] = [];
  for (const o of doc.objects) {
    const bytes = files[o.mesh];
    if (!bytes) continue;
    const id = geometries.has(o.id) ? newId() : o.id;
    geometries.set(id, geometryFromFile('stl', bytes.slice().buffer));
    objects.push({ id, name: o.name, head: o.head, x: o.x, y: o.y, quat: o.quat, scale: o.scale, overrides: o.overrides ?? {} });
  }

  const app = useApp.getState();
  doc.heads?.forEach((h, i) => app.setHead(i, h));
  const user = doc.userProfile ? app.userProfiles.find((p) => p.name === doc.userProfile) : undefined;
  if (user) await selectProfile(`user:${user.name}`);
  else await loadProfiles(doc.process);

  useApp.setState({
    // A user profile that only exists on another computer still keeps its values.
    userProfile: user ? user.name : null,
    profileOverrides: user ? user.overrides : doc.profileOverrides ?? {},
    overrides: doc.overrides ?? {},
    objects,
    selectedId: null,
    past: [],
    future: [],
    dirty: false,
    projectPath: path,
    gcode: null,
    parsed: null,
    sliceError: null,
    sliceOutdated: false,
    tab: 'prepare',
  });
}

/** True if it is fine to replace the current plate: nothing unsaved, or the user agreed to lose it. */
async function confirmDiscard(): Promise<boolean> {
  const s = useApp.getState();
  if (!s.dirty || s.objects.length === 0) return true;
  const t = dict();
  const choice = await window.sepia.ask(fmt(t.project.discardQuestion, { name: projectName(s.projectPath) }), t.project.discardDetail, [
    t.actions.cancel,
    t.project.discard,
  ]);
  return choice === 1;
}

export async function newProject(): Promise<void> {
  if (!(await confirmDiscard())) return;
  useApp.setState({
    objects: [],
    overrides: {},
    selectedId: null,
    past: [],
    future: [],
    dirty: false,
    projectPath: null,
    gcode: null,
    parsed: null,
    sliceError: null,
    sliceOutdated: false,
    tab: 'prepare',
  });
}

export async function openProject(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const file = await window.sepia.projectOpen();
  if (!file) return;
  try {
    await loadProject(file.data, file.path);
  } catch {
    const t = dict();
    await window.sepia.ask(fmt(t.project.openFailed, { name: projectName(file.path) }), '', [t.actions.close]);
  }
}

export async function saveProject(saveAs = false): Promise<boolean> {
  const s = useApp.getState();
  const path = await window.sepia.projectSave(serializeProject(), saveAs ? null : s.projectPath, `${projectName(s.projectPath)}.sepia`);
  if (!path) return false;
  useApp.setState({ projectPath: path, dirty: false });
  return true;
}
