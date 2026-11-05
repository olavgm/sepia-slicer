// Converts between Orca's stored values and what the settings list shows.
import type { Lang, SettingDef } from '@shared/settings-types';

/** What formatting needs from a setting: the plate settings and the filament settings both have it. */
export type ValueDef = Pick<SettingDef, 'kind' | 'unit' | 'percent' | 'min' | 'max' | 'options'>;

export function isOn(value: string): boolean {
  return value === '1' || value.toLowerCase() === 'true';
}

/** Turns a switch on or off, keeping the style Orca used for this key ("1"/"0" or "true"/"false"). */
export function toggleValue(current: string, on: boolean): string {
  return current === 'true' || current === 'false' ? String(on) : on ? '1' : '0';
}

/** Number as the user sees it: without the "%" Orca stores, with a decimal comma in Spanish. */
export function displayNumber(def: ValueDef, value: string, lang: Lang): string {
  let v = value.trim();
  if (def.percent && v.endsWith('%')) v = v.slice(0, -1);
  return lang === 'es' ? v.replace('.', ',') : v;
}

/** Parses what the user typed back into Orca's format, or null if it is not a number. */
export function parseNumber(def: ValueDef, typed: string): string | null {
  const clean = typed.trim().replace(',', '.').replace(/%$/, '');
  if (clean === '' || Number.isNaN(Number(clean))) return null;
  let n = Number(clean);
  if (def.min !== undefined) n = Math.max(def.min, n);
  if (def.max !== undefined) n = Math.min(def.max, n);
  const text = String(n);
  return def.percent ? `${text}%` : text;
}

/** Short text for a value: used in notes ("The profile has 3") and in search results. */
export function describeValue(def: ValueDef, value: string, lang: Lang, layersWord: string): string {
  if (def.kind === 'toggle') return isOn(value) ? (lang === 'es' ? 'Sí' : 'Yes') : 'No';
  if (def.kind === 'select') {
    const option = def.options?.find((o) => o.value === value);
    return option ? option.label[lang] : value;
  }
  const unit = def.unit === 'layers' ? layersWord : def.unit ?? (def.percent ? '%' : '');
  const n = displayNumber(def, value, lang);
  return unit ? `${n} ${unit}` : n;
}
