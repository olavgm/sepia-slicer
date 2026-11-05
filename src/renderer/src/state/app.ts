// App state: plates, the objects on them, the settings and the slices.
import { create } from 'zustand';
import type { Config, EngineInfo, HeadConfig, ProfileCatalog, SliceWarning } from '@shared/types';
import type { SectionId, SettingDef } from '@shared/settings-types';
import type { ParsedGcode } from '../preview/gcode';
import { SETTINGS } from '@shared/settings-schema';

export type Tab = 'prepare' | 'preview' | 'printer';
export type Tool = 'move' | 'rotate' | 'scale' | 'layFlat' | 'cut' | 'paint';
export type View = 'iso' | 'top' | 'front';
export type Vec3 = [number, number, number];

/** What the paint tool paints: a toolhead's colour, supports, or the seam. */
export type PaintMode = 'color' | 'support' | 'seam';

export interface Part {
  /** Also the key of its geometry in `geometries`. */
  id: string;
  name: string;
  /** 0-based toolhead, or null to use the object's. */
  head: number | null;
  /** Placement inside the object: a column-major 4×4 matrix, as three.js stores it. */
  matrix: number[];
  /** Per triangle: 0 = not painted, n = toolhead n (1-based), as Orca stores painted colours. */
  paintColor?: Uint8Array;
  /** Per triangle: 0 = none, 1 = force supports, 2 = block supports. */
  paintSupport?: Uint8Array;
  /** Per triangle: 0 = none, 1 = put the seam here, 2 = keep it away. */
  paintSeam?: Uint8Array;
}

export interface SceneObject {
  id: string;
  name: string;
  /** 0-based toolhead for parts that do not choose their own. */
  head: number;
  plate: string;
  x: number;
  y: number;
  /** Rotation as a quaternion [x, y, z, w]. */
  quat: [number, number, number, number];
  /** Scale per axis; a negative value mirrors that axis. */
  scale: Vec3;
  /** Settings changed only for this object. */
  overrides: Record<string, string>;
  parts: Part[];
}

export interface Plate {
  id: string;
  name: string;
}

export interface PlateResult {
  gcode: string;
  parsed: ParsedGcode;
  outdated: boolean;
  warnings: SliceWarning[];
}

/** What undo and redo bring back. */
export interface Snapshot {
  objects: SceneObject[];
  overrides: Record<string, string>;
  plates: Plate[];
  filamentOverrides: Record<string, string>[];
}

const HISTORY_LIMIT = 100;
let lastRecord = { key: '', at: 0 };

export interface UserProfile {
  name: string;
  process: string;
  overrides: Record<string, string>;
}

export const DEFAULT_HEADS: HeadConfig[] = [
  { filament: 'Snapmaker PLA @U1', color: '#F4F3EE' },
  { filament: 'Snapmaker PLA @U1', color: '#1F8A7E' },
  { filament: 'Snapmaker PLA @U1', color: '#E8772E' },
  { filament: 'Snapmaker PETG @U1', color: '#2A2A2C' },
];
export const DEFAULT_PROCESS = '0.20 Standard @Snapmaker U1 (0.4 nozzle)';
export const FIRST_PLATE: Plate = { id: 'p1', name: '' };

const SETTING_BY_KEY = new Map<string, SettingDef>(SETTINGS.map((s) => [s.key, s]));
export const settingDef = (key: string) => SETTING_BY_KEY.get(key);

function loadUserProfiles(): UserProfile[] {
  try {
    return JSON.parse(localStorage.getItem('sepia-user-profiles') ?? '[]');
  } catch {
    return [];
  }
}

function loadFilamentOverrides(): Record<string, string>[] {
  try {
    const saved = JSON.parse(localStorage.getItem('sepia-filament-overrides') ?? 'null');
    if (Array.isArray(saved) && saved.length === 4) return saved;
  } catch {
    // ignore
  }
  return [{}, {}, {}, {}];
}

function loadHeads(): HeadConfig[] {
  try {
    const saved = JSON.parse(localStorage.getItem('sepia-heads') ?? 'null');
    if (Array.isArray(saved) && saved.length === 4) return saved;
  } catch {
    // ignore
  }
  return DEFAULT_HEADS;
}

interface AppState {
  engine: EngineInfo | null;
  catalog: ProfileCatalog | null;
  process: string;
  userProfile: string | null;
  processBase: Config;
  machineBase: Config;
  /** Values the selected user profile changes over Orca's profile. */
  profileOverrides: Record<string, string>;
  /** Unsaved plate-level changes. */
  overrides: Record<string, string>;
  userProfiles: UserProfile[];
  heads: HeadConfig[];
  /** Each toolhead's filament profile, resolved. */
  filamentBase: Config[];
  /** Changes to each toolhead's filament settings, kept with the toolheads. */
  filamentOverrides: Record<string, string>[];
  /** Toolhead whose filament settings the list shows. */
  filamentHead: number;

  plates: Plate[];
  /** Id of the plate on screen. */
  plate: string;
  /** Objects on every plate. */
  objects: SceneObject[];
  selectedIds: string[];
  /** Objects copied with ⌘C. */
  clipboard: SceneObject[];

  tab: Tab;
  tool: Tool;
  view: View;
  viewNonce: number;
  paletteOpen: boolean;
  headsOpen: boolean;
  saveAsOpen: boolean;
  highlight: { key: string; nonce: number } | null;
  onlyChanged: boolean;
  expanded: Partial<Record<SectionId, boolean>>;
  collapsed: Partial<Record<SectionId, boolean>>;
  paintMode: PaintMode;
  /** For colour: the toolhead (1-based). For supports and seam: 1 = force, 2 = block. 0 erases. */
  paintValue: number;
  /** Brush radius in millimetres. */
  brushRadius: number;
  /** Paint the whole flat area that is clicked. */
  brushFill: boolean;
  cutHeight: number;

  slicing: boolean;
  sliceError: { error: string; log?: string } | null;
  /** The plate on screen's last slice. */
  gcode: string | null;
  parsed: ParsedGcode | null;
  sliceOutdated: boolean;
  /** What Orca, or Sepia, warned about in the last slice of the plate on screen. */
  warnings: SliceWarning[];
  /** Slices of the other plates, kept while you look at another. */
  results: Record<string, PlateResult>;

  past: Snapshot[];
  future: Snapshot[];
  /** Unsaved changes in the project. */
  dirty: boolean;
  projectPath: string | null;
  /** Short message shown for a few seconds at the bottom of the 3D view. */
  notice: string | null;

  set(partial: Partial<AppState>): void;
  /**
   * Saves the current state so it can be undone. Changes to the same thing within a moment
   * (typing in one field, nudging one object) count as one step.
   */
  record(key?: string): void;
  undo(): void;
  redo(): void;
  setTab(tab: Tab): void;
  setView(view: View): void;
  setSetting(key: string, value: string | null, objectId?: string | null): void;
  addObject(o: SceneObject): void;
  updateObject(id: string, patch: Partial<SceneObject>, options?: { record?: boolean }): void;
  updatePart(objectId: string, partId: string, patch: Partial<Part>, options?: { record?: boolean }): void;
  removeObjects(ids: string[]): void;
  select(ids: string[]): void;
  setHead(index: number, head: HeadConfig): void;
  setFilamentSetting(head: number, key: string, value: string | null): void;
  setPlate(id: string): void;
  addPlate(): void;
  removePlate(id: string): void;
  saveUserProfile(name?: string): void;
  discardChanges(): void;
  focusSetting(key: string): void;
}

const snapshotOf = (s: AppState): Snapshot => ({ objects: s.objects, overrides: s.overrides, plates: s.plates, filamentOverrides: s.filamentOverrides });

/** Marks the plates whose objects changed as needing a new slice. */
function outdate(s: AppState): Partial<AppState> {
  const results: Record<string, PlateResult> = {};
  for (const [plate, r] of Object.entries(s.results)) results[plate] = { ...r, outdated: true };
  return { sliceOutdated: s.gcode !== null, results, dirty: true };
}

export const useApp = create<AppState>()((set, get) => ({
  engine: null,
  catalog: null,
  process: DEFAULT_PROCESS,
  userProfile: null,
  processBase: {},
  machineBase: {},
  profileOverrides: {},
  overrides: {},
  userProfiles: loadUserProfiles(),
  heads: loadHeads(),
  filamentBase: [{}, {}, {}, {}],
  filamentOverrides: loadFilamentOverrides(),
  filamentHead: 0,

  plates: [FIRST_PLATE],
  plate: FIRST_PLATE.id,
  objects: [],
  selectedIds: [],
  clipboard: [],

  tab: 'prepare',
  tool: 'move',
  view: 'iso',
  viewNonce: 0,
  paletteOpen: false,
  headsOpen: false,
  saveAsOpen: false,
  highlight: null,
  onlyChanged: false,
  expanded: {},
  collapsed: {},
  paintMode: 'color',
  paintValue: 2,
  brushRadius: 3,
  brushFill: false,
  cutHeight: 10,

  slicing: false,
  sliceError: null,
  gcode: null,
  parsed: null,
  sliceOutdated: false,
  warnings: [],
  results: {},

  past: [],
  future: [],
  dirty: false,
  projectPath: null,
  notice: null,

  set: (partial) => set(partial),
  record: (key) => {
    const now = Date.now();
    const s = get();
    if (key && key === lastRecord.key && now - lastRecord.at < 1200) {
      lastRecord.at = now;
      set({ dirty: true });
      return;
    }
    lastRecord = { key: key ?? '', at: now };
    set({ past: [...s.past, snapshotOf(s)].slice(-HISTORY_LIMIT), future: [], dirty: true });
  },
  undo: () => {
    const s = get();
    const previous = s.past[s.past.length - 1];
    if (!previous) return;
    lastRecord = { key: '', at: 0 };
    set({
      past: s.past.slice(0, -1),
      future: [snapshotOf(s), ...s.future],
      ...previous,
      plate: previous.plates.some((p) => p.id === s.plate) ? s.plate : previous.plates[0].id,
      selectedIds: s.selectedIds.filter((id) => previous.objects.some((o) => o.id === id)),
      ...outdate(s),
    });
  },
  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    lastRecord = { key: '', at: 0 };
    set({
      future: s.future.slice(1),
      past: [...s.past, snapshotOf(s)],
      ...next,
      plate: next.plates.some((p) => p.id === s.plate) ? s.plate : next.plates[0].id,
      selectedIds: s.selectedIds.filter((id) => next.objects.some((o) => o.id === id)),
      ...outdate(s),
    });
  },
  setTab: (tab) => set({ tab }),
  setView: (view) => set((s) => ({ view, viewNonce: s.viewNonce + 1 })),

  setSetting: (key, value, objectId) => {
    get().record(`setting:${objectId ?? 'plate'}:${key}`);
    const s = get();
    if (objectId) {
      set({
        objects: s.objects.map((o) => {
          if (o.id !== objectId) return o;
          const overrides = { ...o.overrides };
          if (value === null || value === plateValue(s, key)) delete overrides[key];
          else overrides[key] = value;
          return { ...o, overrides };
        }),
        ...outdate(s),
      });
      return;
    }
    const overrides = { ...s.overrides };
    if (value === null || value === profileValue(s, key)) delete overrides[key];
    else overrides[key] = value;
    set({ overrides, ...outdate(s) });
  },

  addObject: (o) => {
    get().record();
    set((s) => ({ objects: [...s.objects, o], selectedIds: [o.id], ...outdate(s) }));
  },
  updateObject: (id, patch, options) => {
    if (options?.record !== false) get().record(`object:${id}:${Object.keys(patch).join(',')}`);
    set((s) => ({ objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)), ...outdate(s) }));
  },
  updatePart: (objectId, partId, patch, options) => {
    if (options?.record !== false) get().record(`part:${partId}:${Object.keys(patch).join(',')}`);
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === objectId ? { ...o, parts: o.parts.map((p) => (p.id === partId ? { ...p, ...patch } : p)) } : o,
      ),
      ...outdate(s),
    }));
  },
  removeObjects: (ids) => {
    if (ids.length === 0) return;
    get().record();
    set((s) => ({
      objects: s.objects.filter((o) => !ids.includes(o.id)),
      selectedIds: s.selectedIds.filter((id) => !ids.includes(id)),
      ...outdate(s),
    }));
  },
  select: (ids) => set({ selectedIds: ids }),
  setHead: (index, head) => {
    const heads = get().heads.map((h, i) => (i === index ? head : h));
    localStorage.setItem('sepia-heads', JSON.stringify(heads));
    set((s) => ({ heads, ...outdate(s) }));
  },

  setFilamentSetting: (head, key, value) => {
    get().record(`filament:${head}:${key}`);
    const s = get();
    const own = { ...s.filamentOverrides[head] };
    if (value === null || value === filamentValue(s.filamentBase[head] ?? {}, key)) delete own[key];
    else own[key] = value;
    const filamentOverrides = s.filamentOverrides.map((o, i) => (i === head ? own : o));
    localStorage.setItem('sepia-filament-overrides', JSON.stringify(filamentOverrides));
    set({ filamentOverrides, ...outdate(s) });
  },

  setPlate: (id) => {
    const s = get();
    if (id === s.plate) return;
    const results = { ...s.results };
    if (s.gcode && s.parsed) results[s.plate] = { gcode: s.gcode, parsed: s.parsed, outdated: s.sliceOutdated, warnings: s.warnings };
    const next = results[id];
    set({
      plate: id,
      results,
      gcode: next?.gcode ?? null,
      parsed: next?.parsed ?? null,
      sliceOutdated: next?.outdated ?? false,
      warnings: next?.warnings ?? [],
      sliceError: null,
      selectedIds: [],
    });
  },
  addPlate: () => {
    get().record();
    const s = get();
    let n = s.plates.length + 1;
    while (s.plates.some((p) => p.id === `p${n}`)) n++;
    const plate = { id: `p${n}`, name: '' };
    set({ plates: [...s.plates, plate] });
    get().setPlate(plate.id);
  },
  removePlate: (id) => {
    const s = get();
    if (s.plates.length <= 1) return;
    get().record();
    const plates = s.plates.filter((p) => p.id !== id);
    const results = { ...s.results };
    delete results[id];
    set({ plates, objects: s.objects.filter((o) => o.plate !== id), results });
    if (s.plate === id) {
      set({ plate: '' });
      get().setPlate(plates[0].id);
    }
  },

  saveUserProfile: (name) => {
    const s = get();
    const merged = { ...s.profileOverrides, ...s.overrides };
    const profileName = name ?? s.userProfile;
    if (!profileName) return;
    const others = s.userProfiles.filter((p) => p.name !== profileName);
    const userProfiles = [...others, { name: profileName, process: s.process, overrides: merged }];
    localStorage.setItem('sepia-user-profiles', JSON.stringify(userProfiles));
    set({ userProfiles, userProfile: profileName, profileOverrides: merged, overrides: {} });
  },
  discardChanges: () => {
    get().record();
    set({ overrides: {} });
  },
  focusSetting: (key) => {
    const def = settingDef(key);
    const s = get();
    set({
      highlight: { key, nonce: (s.highlight?.nonce ?? 0) + 1 },
      onlyChanged: false,
      expanded: def && !def.basic ? { ...s.expanded, [def.section]: true } : s.expanded,
      collapsed: def ? { ...s.collapsed, [def.section]: false } : s.collapsed,
      tab: s.tab === 'printer' ? 'prepare' : s.tab,
    });
  },
}));

// ---------- Selection helpers ----------

export const objectsOnPlate = (s: Pick<AppState, 'objects' | 'plate'>) => s.objects.filter((o) => o.plate === s.plate);

/** The selected object when exactly one is selected. */
export function singleSelection(s: Pick<AppState, 'objects' | 'selectedIds'>): SceneObject | null {
  return s.selectedIds.length === 1 ? s.objects.find((o) => o.id === s.selectedIds[0]) ?? null : null;
}

/** The toolhead a part prints with. */
export const partHead = (o: SceneObject, p: Part) => p.head ?? o.head;

/** Display name of a plate: its own, or "Plate N" by position. */
export const plateIndex = (plates: Plate[], id: string) => plates.findIndex((p) => p.id === id) + 1;

// ---------- Values ----------
// Orca stores everything as strings, some as one value per toolhead. The UI works with one string per key.

export function baseValue(s: Pick<AppState, 'processBase' | 'machineBase'>, key: string): string {
  const def = settingDef(key);
  const raw = def?.scope === 'machine' ? s.machineBase[key] : s.processBase[key] ?? s.machineBase[key];
  if (Array.isArray(raw)) return raw[0] ?? '';
  return raw ?? '';
}

/** Value in the selected profile (Orca's, plus a saved user profile's changes). */
export function profileValue(s: Pick<AppState, 'processBase' | 'machineBase' | 'profileOverrides'>, key: string): string {
  return s.profileOverrides[key] ?? baseValue(s, key);
}

export function plateValue(s: Pick<AppState, 'processBase' | 'machineBase' | 'profileOverrides' | 'overrides'>, key: string): string {
  return s.overrides[key] ?? profileValue(s, key);
}

export function objectValue(
  s: Pick<AppState, 'processBase' | 'machineBase' | 'profileOverrides' | 'overrides'>,
  key: string,
  object: SceneObject,
): string {
  return object.overrides[key] ?? plateValue(s, key);
}

/** Every value that differs from Orca's profile, split by where Orca keeps it. */
export function effectiveOverrides(s: Pick<AppState, 'profileOverrides' | 'overrides'>): { process: Record<string, string>; machine: Record<string, string> } {
  const all = { ...s.profileOverrides, ...s.overrides };
  const process: Record<string, string> = {};
  const machine: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    if (settingDef(key)?.scope === 'machine') machine[key] = value;
    else process[key] = value;
  }
  return { process, machine };
}

/** A filament profile's value as the list shows it: first entry of the array, and "" for "use the printer's". */
export function filamentValue(base: Config, key: string): string {
  const raw = base[key];
  const v = Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  return v === 'nil' ? '' : v;
}

export const newId = () => Math.random().toString(36).slice(2, 10);
export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
