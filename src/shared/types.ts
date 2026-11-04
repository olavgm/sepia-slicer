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

export interface SliceObject {
  id: string;
  name: string;
  /** 0-based toolhead index. */
  head: number;
  /** Binary STL with the object's position, rotation and scale already applied, in bed coordinates (mm). */
  stl: ArrayBuffer;
  /** Settings changed only for this object (Orca keys → Orca values). */
  overrides: Record<string, string>;
}

export interface SliceRequest {
  machine: string;
  process: string;
  processOverrides: Record<string, string>;
  machineOverrides: Record<string, string>;
  heads: HeadConfig[];
  objects: SliceObject[];
}

export interface SliceResult {
  ok: boolean;
  gcode?: string;
  gcodePath?: string;
  error?: string;
  /** Last lines of Orca's log, to show when something fails. */
  log?: string;
  durationMs: number;
}

export interface OpenedModel {
  name: string;
  ext: string;
  data: ArrayBuffer;
}

export interface PrinterStatus {
  ok: boolean;
  state?: string;
  message?: string;
  hostname?: string;
  progress?: number;
  error?: string;
}

export interface SepiaApi {
  engineInfo(): Promise<EngineInfo>;
  catalog(): Promise<ProfileCatalog>;
  resolveProcess(name: string): Promise<Config>;
  resolveMachine(name: string, processName: string): Promise<Config>;
  resolveFilament(name: string): Promise<Config>;
  openModels(): Promise<OpenedModel[]>;
  slice(request: SliceRequest): Promise<SliceResult>;
  saveGcode(gcode: string, suggestedName: string): Promise<string | null>;
  printerStatus(host: string): Promise<PrinterStatus>;
  printerUpload(host: string, gcode: string, filename: string, start: boolean): Promise<PrinterStatus>;
  setNativeTheme(theme: 'system' | 'light' | 'dark'): Promise<void>;
}
