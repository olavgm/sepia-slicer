// Types for the settings list. The list shows Orca config keys grouped in sections,
// with labels and help in every supported language.

export type Lang = 'en' | 'es';
export type Localized = Record<Lang, string>;

export type SectionId =
  | 'quality'
  | 'walls'
  | 'topBottom'
  | 'infill'
  | 'speed'
  | 'support'
  | 'adhesion'
  | 'toolheads'
  | 'cooling'
  | 'retraction'
  | 'advanced';

export interface SectionDef {
  id: SectionId;
  label: Localized;
}

export type SettingKind = 'number' | 'select' | 'toggle';

export interface SettingOption {
  /** Exact value Orca expects in its config, e.g. "gyroid" or "tree(auto)". */
  value: string;
  label: Localized;
}

export interface SettingDef {
  /** Orca config key, e.g. "layer_height". Must exist in Orca's resolved config. */
  key: string;
  section: SectionId;
  kind: SettingKind;
  /** Which Orca profile the key lives in. Machine keys are per-extruder arrays: we write the same value to every toolhead. */
  scope: 'process' | 'machine';
  /** Shown without pressing "Show more". */
  basic: boolean;
  /** Can be changed for a single object (Orca per-object settings). */
  perObject: boolean;
  /** Unit shown after the value, e.g. "mm", "%", "mm/s", "°C", "s". */
  unit?: string;
  /** Orca stores the value with a trailing "%" (e.g. "15%"); the UI shows the number only. */
  percent?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: SettingOption[];
  label: Localized;
  /** One short sentence, written for someone who is not an expert. */
  help: Localized;
  /** Extra search terms (both languages), e.g. Orca's own name for the setting. */
  keywords?: string[];
}
