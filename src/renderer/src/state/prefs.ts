// User preferences that survive a restart: appearance, language, printer address and panel layout.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Lang } from '@shared/settings-types';

export type ThemePref = 'system' | 'light' | 'dark';
export type Side = 'left' | 'right';

interface PrefsState {
  theme: ThemePref;
  lang: Lang;
  printerHost: string;
  /** Whether each side panel is open. */
  panels: Record<Side, boolean>;
  setTheme(theme: ThemePref): void;
  setLang(lang: Lang): void;
  setPrinterHost(host: string): void;
  togglePanel(side: Side): void;
}

const initialLang: Lang = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      lang: initialLang,
      printerHost: '',
      panels: { left: true, right: true },
      setTheme: (theme) => set({ theme }),
      setLang: (lang) => set({ lang }),
      setPrinterHost: (printerHost) => set({ printerHost }),
      togglePanel: (side) => set((s) => ({ panels: { ...s.panels, [side]: !s.panels[side] } })),
    }),
    {
      name: 'sepia-prefs',
      // Older saved preferences have no panel layout: keep the defaults for anything missing.
      merge: (saved, current) => ({ ...current, ...(saved as Partial<PrefsState>), panels: { ...current.panels, ...(saved as Partial<PrefsState>)?.panels } }),
    },
  ),
);
