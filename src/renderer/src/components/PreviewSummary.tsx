import { useApp } from '../state/app';
import { fmt, useT } from '../i18n';
import { Swatch } from './LeftPanel';

export function formatDuration(seconds: number | null, lang: 'en' | 'es'): string {
  if (seconds === null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return lang === 'es' ? `${h} h ${m} min` : `${h} h ${m} min`;
}

export function PreviewSummary() {
  const { t, lang } = useT();
  const parsed = useApp((s) => s.parsed);
  const heads = useApp((s) => s.heads);
  const outdated = useApp((s) => s.sliceOutdated);

  if (!parsed) {
    return (
      <aside className="left" aria-label={t.tabs.preview}>
        <p className="empty-note">{t.preview.noSlice}</p>
      </aside>
    );
  }
  const { stats } = parsed;
  const grams = stats.gramsPerTool;
  const totalGrams = grams.reduce((a, b) => a + b, 0);
  const totalMeters = stats.metersPerTool.reduce((a, b) => a + b, 0);
  const maxGrams = Math.max(1, ...grams);
  const number = (n: number, digits = 0) => n.toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits });

  return (
    <aside className="left" aria-label={t.tabs.preview}>
      <section className="stack">
        <h2 className="eyebrow">{fmt(t.preview.sliced, { n: 1 })}</h2>
        <p className="big-number">{formatDuration(stats.timeSeconds, lang)}</p>
        <p className="muted" style={{ margin: 0 }}>
          {number(totalGrams, 1)} g · {number(totalMeters, 1)} m
        </p>
        {outdated && (
          <p className="warn" style={{ margin: 0 }}>
            {t.scene.sliceOutdated}
          </p>
        )}
      </section>

      <section className="stack">
        <h2 className="eyebrow">{t.preview.perHead}</h2>
        <ul className="bars">
          {heads.map((h, i) => {
            const g = grams[i] ?? 0;
            const used = stats.toolLayers[i] !== null && g > 0;
            return (
              <li key={i}>
                <Swatch color={h.color} size={12} />
                <span>
                  <span className="mono">{i + 1}</span> {h.filament.replace(/ @U1$/, '').replace(/^Snapmaker /, '')}
                </span>
                <span className="mono">{used ? `${number(g, 1)} g` : t.preview.unused}</span>
                <span className="bar" aria-hidden="true">
                  <span style={{ width: `${used ? (g / maxGrams) * 100 : 0}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="stack">
        <h2 className="eyebrow">{t.preview.toolchanges}</h2>
        <p className="big-number" style={{ fontSize: 24 }}>
          {number(stats.toolchanges)}
        </p>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {t.preview.toolchangesHelp}
        </p>
      </section>
    </aside>
  );
}
