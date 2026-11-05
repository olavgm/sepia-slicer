// Types shared by the Electron main process, the preload bridge and the UI.

export type ConfigValue = string | string[];
export type Config = Record<string, ConfigValue>;

export interface EngineInfo {
  found: boolean;
  /** Path to the OrcaSlicer executable we drive from the command line. */
  executable?: string;
  appName?: string;
  version?: string;
  /** Folder with Orca's Snapmaker profiles. */
  profilesDir?: string;
}

export interface ProcessProfile {
  name: string;
  layerHeight: number;
}

export interface FilamentProfile {
  name: string;
  /** Material type from the profile, e.g. "PLA", "PETG". */
  type: string;
}

export interface ProfileCatalog {
  machine: string;
  processes: ProcessProfile[];
  filaments: FilamentProfile[];
}

export interface HeadConfig {
  /** Orca filament profile name, e.g. "Snapmaker PLA @U1". */
  filament: string;
  /** Hex colour of the loaded spool, e.g. "#F4F3EE". */
  color: string;
}

export interface SettingsRequest {
  machine: string;
  process: string;
  processOverrides: Record<string, string>;
  machineOverrides: Record<string, string>;
  heads: HeadConfig[];
  /** Per toolhead: filament settings changed in Sepia. "" means "use the printer's value" (Orca's nil). */
  filamentOverrides: Record<string, string>[];
}

export interface SliceRequest extends SettingsRequest {
  /** One plate as an Orca-style 3MF, without project_settings.config: the main process adds it. */
  project: Uint8Array;
  objectCount: number;
}

/** A problem Orca reported while slicing. */
export interface SliceWarning {
  /** Stable id for the UI to translate, e.g. "floating-regions", "empty-layer", "partly-outside-bed". */
  code: string;
  /** Orca's own text, in English. */
  message: string;
  objectName?: string;
  /** Print height in mm, as Orca reports it (it gives heights, not layer numbers). */
  layer?: number;
}

export interface SliceResult {
  ok: boolean;
  gcode?: string;
  gcodePath?: string;
  error?: string;
  /** Last lines of Orca's log, to show when something fails. */
  log?: string;
  /** What Orca warned about, whether or not the slice succeeded. */
  warnings?: SliceWarning[];
  durationMs: number;
}

export interface OpenedModel {
  name: string;
  /** Format of `data`: stl, 3mf or obj. STEP arrives already converted to stl. */
  ext: string;
  data: ArrayBuffer;
  /** Set when the main process could not convert the file, so the UI reports it as unreadable. */
  error?: string;
}

export interface HeaterReading {
  /** Klipper's name for it: "extruder", "extruder1", …, "heater_bed". */
  name: string;
  temperature: number;
  target: number;
}

export interface PrinterStatus {
  ok: boolean;
  /** Klipper's print state: standby, printing, paused, complete, cancelled, error. */
  state?: string;
  message?: string;
  hostname?: string;
  /** 0–1. */
  progress?: number;
  filename?: string;
  /** Seconds spent printing so far. */
  printDuration?: number;
  /** Toolheads first, then the bed. */
  heaters?: HeaterReading[];
  /** Klipper's name for the active extruder. */
  activeExtruder?: string;
  hasCamera?: boolean;
  error?: string;
}

export type MenuCommand =
  | 'new'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'addModel'
  | 'exportGcode'
  | 'undo'
  | 'redo'
  | 'arrange'
  | 'delete'
  | 'palette'
  | 'toggleLeft'
  | 'toggleRight'
  | 'slice'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'selectAll'
  | 'clearRecent'
  | 'addPlate';

export interface DocumentInfo {
  title: string;
  dirty: boolean;
  path: string | null;
  lang: 'en' | 'es';
  /** Text for the "close without saving?" question, in the user's language. */
  closePrompt: { message: string; detail: string; close: string; cancel: string };
}

export interface SepiaApi {
  engineInfo(): Promise<EngineInfo>;
  catalog(): Promise<ProfileCatalog>;
  resolveProcess(name: string): Promise<Config>;
  resolveMachine(name: string, processName: string): Promise<Config>;
  resolveFilament(name: string): Promise<Config>;
  openModels(): Promise<OpenedModel[]>;
  /** Converts a dropped file the renderer cannot read itself (STEP) into one it can. */
  convertModel(name: string, ext: string, data: ArrayBuffer): Promise<OpenedModel>;
  slice(request: SliceRequest): Promise<SliceResult>;
  saveGcode(gcode: string, suggestedName: string): Promise<string | null>;
  printerStatus(host: string): Promise<PrinterStatus>;
  printerUpload(host: string, gcode: string, filename: string, start: boolean): Promise<PrinterStatus>;
  printerSnapshot(host: string): Promise<string | null>;
  setNativeTheme(theme: 'system' | 'light' | 'dark'): Promise<void>;
  /** Saves a 3MF project, adding Orca's full config to it. Asks where if `path` is null. */
  projectSave(data: Uint8Array, settings: SettingsRequest, path: string | null, suggestedName: string): Promise<string | null>;
  projectOpen(): Promise<{ path: string; data: Uint8Array } | null>;
  /** Asks a question with native buttons; resolves to the index of the button pressed. */
  ask(message: string, detail: string, buttons: string[]): Promise<number>;
  setDocument(info: DocumentInfo): Promise<void>;
  onMenu(listener: (command: MenuCommand) => void): () => void;
  /** Reads a file by path (recent projects); null if it is gone. */
  readFile(path: string): Promise<Uint8Array | null>;
  /** Keeps the "Open recent" menu in step. */
  setRecent(paths: string[]): Promise<void>;
  /** Files opened from Finder, the Dock, the command line or the "Open recent" menu. */
  onOpenFile(listener: (file: { path: string; name: string; ext: string; data: Uint8Array }) => void): () => void;
  /** Copy, paste… in a text field: the native commands, which the menu otherwise sends to the objects. */
  nativeEdit(command: 'cut' | 'copy' | 'paste' | 'selectAll'): Promise<void>;
}
