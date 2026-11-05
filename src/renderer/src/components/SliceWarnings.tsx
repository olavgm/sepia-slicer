import { useApp } from '../state/app';
import { fmt, useT } from '../i18n';
import { Icon } from './Icon';
import type { SliceWarning } from '@shared/types';

/** One line per warning, in the user's language; Orca's own English text only when we have nothing better. */
export function warningText(w: SliceWarning, t: ReturnType<typeof useT>['t'], lang: 'en' | 'es'): string {
  const texts = t.warnings as Record<string, string>;
  const template = texts[w.code] ?? texts['slicing-warning'];
  const height = w.layer !== undefined ? w.layer.toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', { maximumFractionDigits: 2 }) : '';
  return fmt(template, { object: w.objectName ?? t.warnings.unknownObject, height, message: w.message });
}

export function SliceWarnings() {
  const { t, lang } = useT();
  const warnings = useApp((s) => s.warnings);
  if (warnings.length === 0) return null;
  return (
    <section className="stack" aria-label={t.warnings.title}>
      <h2 className="eyebrow">{t.warnings.title}</h2>
      <ul className="warning-list">
        {warnings.map((w, i) => (
          <li key={i} className="warn">
            <Icon name="warn" />
            <span>{warningText(w, t, lang)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
