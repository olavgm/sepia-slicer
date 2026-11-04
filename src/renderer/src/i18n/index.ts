import { en, type Dict } from './en';
import { es } from './es';
import { usePrefs } from '../state/prefs';
import type { Lang, Localized } from '@shared/settings-types';

const dicts: Record<Lang, Dict> = { en, es };

/** Replaces {name} placeholders. */
export function fmt(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function useT(): { t: Dict; lang: Lang; L: (l: Localized) => string } {
  const lang = usePrefs((s) => s.lang);
  return { t: dicts[lang], lang, L: (l) => l[lang] };
}

export function detectLang(): Lang {
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
}
