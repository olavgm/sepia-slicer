// App state: the plate, its objects, the settings and the last slice.
import { create } from 'zustand';
import type { Config, EngineInfo, HeadConfig, ProfileCatalog } from '@shared/types';
import type { SectionId, SettingDef } from '@shared/settings-types';
import type { ParsedGcode } from '../preview/gcode';
import { SETTINGS } from '@shared/settings-schema';

export type Tab = 'prepare' | 'preview' | 'printer';
export type Tool = 'move' | 'rotate' | 'scale' | 'layFlat';
export type View = 'iso' | 'top' | 'front';

export interface SceneObject {
  id: string;
  name: string;
  head: number;
  x: number;
  y: number;
  /** Rotation as a quaternion [x, y, z, w]. */
  quat: [number, number, number, number];
  scale: number;
  /** Settings changed only for this object. */
  overrides: Record<string, string>;
}

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

const SETTING_BY_KEY = new Map<string, SettingDef>(SETTINGS.map((s) => [s.key, s]));
export const settingDef = (key: string) => SETTING_BY_KEY.get(key);

function loadUserProfiles(): UserProfile[] {
  try {
    return JSON.parse(localStorage.getItem('sepia-user-profiles') ?? '[]');
  } catch {
    return [];
  }
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
  objects: SceneObject[];
  selectedId: string | null;

  tab: Tab;
  tool: Tool;
  view: View;
  viewNonce: number;
  paletteOpen: boolean;
  prefsOpen: boolean;
  headsOpen: boolean;
  saveAsOpen: boolean;
  highlight: { key: string; nonce: number } | null;
  onlyChanged: boolean;
  expanded: Partial<Record<SectionId, boolean>>;
  collapsed: Partial<Record<SectionId, boolean>>;

  slicing: boolean;
  sliceError: { error: string; log?: string } | null;
  gcode: string | null;
  parsed: ParsedGcode | null;
  sliceOutdated: boolean;

  set(partial: Partial<AppState>): void;
  setTab(tab: Tab): void;
  setView(view: View): void;
  setSetting(key: string, value: string | null, objectId?: string | null): void;
  addObject(o: SceneObject): void;
  updateObject(id: string, patch: Partial<SceneObject>): void;
  removeObject(id: string): void;
  setHead(index: number, head: HeadConfig): void;
  saveUserProfile(name?: string): void;
  discardChanges(): void;
  focusSetting(key: string): void;
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
  objects: [],
  selectedId: null,

  tab: 'prepare',
  tool: 'move',
  view: 'iso',
  viewNonce: 0,
  paletteOpen: false,
  prefsOpen: false,
  headsOpen: false,
  saveAsOpen: false,
  highlight: null,
  onlyChanged: false,
  expanded: {},
  collapsed: {},

  slicing: false,
  sliceError: null,
  gcode: null,
  parsed: null,
  sliceOutdated: false,

  set: (partial) => set(partial),
  setTab: (tab) => set({ tab }),
  setView: (view) => set((s) => ({ view, viewNonce: s.viewNonce + 1 })),

  setSetting: (key, value, objectId) => {
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
        sliceOutdated: s.gcode !== null,
      });
      return;
    }
    const overrides = { ...s.overrides };
    if (value === null || value === profileValue(s, key)) delete overrides[key];
    else overrides[key] = value;
    set({ overrides, sliceOutdated: s.gcode !== null });
  },

  addObject: (o) => set((s) => ({ objects: [...s.objects, o], selectedId: o.id, sliceOutdated: s.gcode !== null })),
  updateObject: (id, patch) =>
    set((s) => ({ objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)), sliceOutdated: s.gcode !== null })),
  removeObject: (id) =>
    set((s) => ({
      objects: s.objects.filter((o) => o.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      sliceOutdated: s.gcode !== null,
    })),
  setHead: (index, head) => {
    const heads = get().heads.map((h, i) => (i === index ? head : h));
    localStorage.setItem('sepia-heads', JSON.stringify(heads));
    set({ heads, sliceOutdated: get().gcode !== null });
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
  discardChanges: () => set({ overrides: {} }),
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
export function effectiveOverrides(s: AppState): { process: Record<string, string>; machine: Record<string, string> } {
  const all = { ...s.profileOverrides, ...s.overrides };
  const process: Record<string, string> = {};
  const machine: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    if (settingDef(key)?.scope === 'machine') machine[key] = value;
    else process[key] = value;
  }
  return { process, machine };
}

export const newId = () => Math.random().toString(36).slice(2, 10);
