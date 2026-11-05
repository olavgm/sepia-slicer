import { useMemo } from 'react';
import { useApp, plateIndex, objectsOnPlate } from '../state/app';
import { bestToolchangeSuggestion, toolsPerLayer } from '../preview/suggest';
import { fmt, useT } from '../i18n';
import { Swatch } from './LeftPanel';
import { SliceWarnings } from './SliceWarnings';

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
  const plateNumber = useApp((s) => plateIndex(s.plates, s.plate));

  if (!parsed) {
    return (
      <aside className="left" aria-label={t.tabs.preview}>
        <p className="empty-note">{t.preview.noSlice}</p>
        <SliceWarnings />
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
        <h2 className="eyebrow">{fmt(t.preview.sliced, { n: plateNumber })}</h2>
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

      <SliceWarnings />
      <ToolchangeSuggestion />

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

/** "Move head 2's objects to head 1 and save N toolhead changes", with a button to try it. */
function ToolchangeSuggestion() {
  const { t } = useT();
  const parsed = useApp((s) => s.parsed);
  const outdated = useApp((s) => s.sliceOutdated);
  // Select the stable pieces: a selector that builds a new array would re-render forever.
  const all = useApp((s) => s.objects);
  const plate = useApp((s) => s.plate);
  const suggestion = useMemo(() => {
    const objects = objectsOnPlate({ objects: all, plate });
    if (!parsed || outdated) return null;
    // Only toolheads whose objects use nothing else can move as a whole.
    const blocked = new Set<number>();
    const used = new Set<number>();
    for (const o of objects) {
      const mixed = o.parts.some((p) => (p.head !== null && p.head !== o.head) || p.paintColor?.some((v) => v > 0));
      for (const p of o.parts) used.add(p.head ?? o.head);
      if (mixed) for (const p of o.parts) blocked.add(p.head ?? o.head);
    }
    const movable = new Set([...used].filter((h) => !blocked.has(h)));
    return bestToolchangeSuggestion(toolsPerLayer(parsed.tools, parsed.layerEnds), movable);
  }, [parsed, outdated, all, plate]);
  if (!suggestion) return null;
  const apply = () => {
    const s = useApp.getState();
    s.record();
    useApp.setState({
      objects: s.objects.map((o) => (o.plate === s.plate && o.head === suggestion.from ? { ...o, head: suggestion.to } : o)),
      sliceOutdated: true,
      dirty: true,
    });
  };
  return (
    <section className="stack suggestion" aria-label={t.suggestions.title}>
      <h2 className="eyebrow">{t.suggestions.title}</h2>
      <p style={{ margin: 0, fontSize: 13 }}>
        {fmt(t.suggestions.toolchanges, { from: suggestion.from + 1, to: suggestion.to + 1, now: suggestion.now, after: suggestion.after })}
      </p>
      <div className="row">
        <button className="btn" onClick={apply}>
          {t.suggestions.apply}
        </button>
      </div>
    </section>
  );
}

