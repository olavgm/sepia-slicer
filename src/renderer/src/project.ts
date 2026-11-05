// Projects are OrcaSlicer-style 3MF files: they open in OrcaSlicer too, and Sepia opens Orca's.
// Sepia's own state (toolhead filaments and colours, profile, changes) goes in Metadata/sepia.json.
import { zipSync, unzipSync } from 'fflate';
import { useApp, type Plate } from './state/app';
import { loadFilamentBases, loadProfiles, selectProfile, settingsRequest, showNotice } from './actions';
import { write3mf } from './project/threemf-write';
import { read3mf } from './project/threemf-read';
import { usePrefs } from './state/prefs';
import { fmt } from './i18n';
import { en } from './i18n/en';
import { es } from './i18n/es';
import type { HeadConfig } from '@shared/types';

const dict = () => (usePrefs.getState().lang === 'es' ? es : en);

interface SepiaMeta {
  version: number;
  process: string;
  userProfile: string | null;
  profileOverrides: Record<string, string>;
  overrides: Record<string, string>;
  heads: HeadConfig[];
  filamentOverrides?: Record<string, string>[];
  plates: Plate[];
}

export function projectName(path: string | null): string {
  if (!path) return dict().untitled;
  return path.split(/[\\/]/).pop()!.replace(/\.3mf$/i, '');
}

export function serializeProject(): Uint8Array {
  const s = useApp.getState();
  const sepia: SepiaMeta = {
    version: 1,
    process: s.process,
    userProfile: s.userProfile,
    profileOverrides: s.profileOverrides,
    overrides: s.overrides,
    heads: s.heads,
    filamentOverrides: s.filamentOverrides,
    plates: s.plates,
  };
  return zipSync(write3mf({ objects: s.objects, plates: s.plates, engineVersion: s.engine?.version ?? '2.4.2', plateOffsets: true, sepia }), { level: 6 });
}

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/** Toolheads from Orca's project config: colours always, filament profiles when Sepia knows them. */
function headsFromConfig(config: Record<string, unknown>, current: HeadConfig[], known: Set<string>): HeadConfig[] {
  const colours = Array.isArray(config.filament_colour) ? (config.filament_colour as string[]) : [];
  const ids = Array.isArray(config.filament_settings_id) ? (config.filament_settings_id as string[]) : [];
  return current.map((head, i) => ({
    filament: known.has(ids[i]) ? ids[i] : head.filament,
    color: /^#[0-9a-f]{6}$/i.test(colours[i] ?? '') ? colours[i].toUpperCase() : head.color,
  }));
}

/** Reads a 3MF project and replaces everything on screen with it. Throws if it cannot be read. */
export async function loadProject(data: Uint8Array, path: string | null): Promise<void> {
  const read = read3mf(unzipSync(data));
  const app = useApp.getState();
  const meta = read.sepia as SepiaMeta | null;

  if (meta) {
    meta.heads?.forEach((h, i) => app.setHead(i, h));
    if (meta.filamentOverrides?.length === 4) {
      useApp.setState({ filamentOverrides: meta.filamentOverrides });
      localStorage.setItem('sepia-filament-overrides', JSON.stringify(meta.filamentOverrides));
    }
    const user = meta.userProfile ? app.userProfiles.find((p) => p.name === meta.userProfile) : undefined;
    if (user) await selectProfile(`user:${user.name}`);
    else await loadProfiles(meta.process);
    useApp.setState({
      // A user profile that only exists on another computer still keeps its values.
      userProfile: user ? user.name : null,
      profileOverrides: user ? user.overrides : meta.profileOverrides ?? {},
      overrides: meta.overrides ?? {},
    });
  } else if (read.projectConfig) {
    // A project from OrcaSlicer or Bambu Studio: keep its colours, and its process if it is a U1 one.
    const known = new Set(app.catalog?.filaments.map((f) => f.name) ?? []);
    headsFromConfig(read.projectConfig, app.heads, known).forEach((h, i) => app.setHead(i, h));
    const process = String(first(read.projectConfig.print_settings_id) ?? '');
    if (app.catalog?.processes.some((p) => p.name === process)) await loadProfiles(process);
    useApp.setState({ userProfile: null, profileOverrides: {}, overrides: {} });
  }

  await loadFilamentBases();
  const plates = meta?.plates?.length ? read.plates.map((p, i) => ({ ...p, name: meta.plates[i]?.name ?? p.name })) : read.plates;
  useApp.setState({
    plates,
    plate: plates[0].id,
    objects: read.objects,
    selectedIds: [],
    past: [],
    future: [],
    dirty: false,
    projectPath: path,
    gcode: null,
    parsed: null,
    results: {},
    sliceError: null,
    sliceOutdated: false,
    tab: 'prepare',
  });
  if (read.skipped.length) showNotice(fmt(dict().files.skippedParts, { what: read.skipped.join(', ') }));
}

/** True if it is fine to replace the current project: nothing unsaved, or the user agreed to lose it. */
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
    plates: [{ id: 'p1', name: '' }],
    plate: 'p1',
    objects: [],
    overrides: {},
    selectedIds: [],
    past: [],
    future: [],
    dirty: false,
    projectPath: null,
    gcode: null,
    parsed: null,
    results: {},
    sliceError: null,
    sliceOutdated: false,
    tab: 'prepare',
  });
}

export async function openProjectFile(path: string, data: Uint8Array): Promise<void> {
  try {
    await loadProject(data, path);
    addRecent(path);
  } catch {
    const t = dict();
    await window.sepia.ask(fmt(t.project.openFailed, { name: projectName(path) }), '', [t.actions.close]);
  }
}

export async function openProject(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const file = await window.sepia.projectOpen();
  if (file) await openProjectFile(file.path, file.data);
}

export async function openRecent(path: string): Promise<void> {
  if (!(await confirmDiscard())) return;
  const file = await window.sepia.readFile(path);
  if (file) await openProjectFile(path, file);
  else {
    removeRecent(path);
    showNotice(fmt(dict().project.openFailed, { name: projectName(path) }));
  }
}

export async function saveProject(saveAs = false): Promise<boolean> {
  const s = useApp.getState();
  if (!s.catalog) return false;
  const path = await window.sepia.projectSave(serializeProject(), settingsRequest(), saveAs ? null : s.projectPath, `${projectName(s.projectPath)}.3mf`);
  if (!path) return false;
  useApp.setState({ projectPath: path, dirty: false });
  addRecent(path);
  return true;
}

// ---------- Recent projects ----------

const RECENT_KEY = 'sepia-recent';
const RECENT_MAX = 10;

export function recentProjects(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function writeRecent(list: string[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  window.sepia.setRecent(list);
}

export function addRecent(path: string): void {
  writeRecent([path, ...recentProjects().filter((p) => p !== path)].slice(0, RECENT_MAX));
}

function removeRecent(path: string): void {
  writeRecent(recentProjects().filter((p) => p !== path));
}

export function clearRecent(): void {
  writeRecent([]);
}
