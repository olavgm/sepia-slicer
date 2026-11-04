// Applies the appearance preference: follows the system unless the user picked light or dark.
import { useEffect, useState } from 'react';
import { usePrefs } from './state/prefs';

export type ResolvedTheme = 'light' | 'dark';

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function useResolvedTheme(): ResolvedTheme {
  const pref = usePrefs((s) => s.theme);
  const [systemDark, setSystemDark] = useState(() => media().matches);

  useEffect(() => {
    const m = media();
    const onChange = () => setSystemDark(m.matches);
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  useEffect(() => {
    window.sepia?.setNativeTheme(pref);
  }, [pref]);

  return resolved;
}
