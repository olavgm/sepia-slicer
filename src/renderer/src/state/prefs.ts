// User preferences that survive a restart: appearance, language and the printer address.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Lang } from '@shared/settings-types';

export type ThemePref = 'system' | 'light' | 'dark';

interface PrefsState {
  theme: ThemePref;
  lang: Lang;
  printerHost: string;
  setTheme(theme: ThemePref): void;
  setLang(lang: Lang): void;
  setPrinterHost(host: string): void;
}

const initialLang: Lang = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      lang: initialLang,
      printerHost: '',
      setTheme: (theme) => set({ theme }),
      setLang: (lang) => set({ lang }),
      setPrinterHost: (printerHost) => set({ printerHost }),
    }),
    { name: 'sepia-prefs' },
  ),
);
