import { useApp, singleSelection, type PaintMode } from '../state/app';
import { useT } from '../i18n';
import { Swatch } from './LeftPanel';

/** The brush settings, read by the 3D view while painting. */
export const paintBrush = () => {
  const s = useApp.getState();
  return { radius: s.brushRadius, fill: s.brushFill };
};

const FIELD = { color: 'paintColor', support: 'paintSupport', seam: 'paintSeam' } as const;

/** Paint toolheads, supports or the seam onto the selected object. */
export function PaintPanel() {
  const { t } = useT();
  const object = useApp(singleSelection);
  const mode = useApp((s) => s.paintMode);
  const value = useApp((s) => s.paintValue);
  const heads = useApp((s) => s.heads);
  const radius = useApp((s) => s.brushRadius);
  const fill = useApp((s) => s.brushFill);

  const setMode = (m: PaintMode) => useApp.setState({ paintMode: m, paintValue: m === 'color' ? (value >= 1 && value <= 4 ? value : 2) : 1 });

  const clearAll = () => {
    if (!object) return;
    const s = useApp.getState();
    s.record();
    for (const p of object.parts) s.updatePart(object.id, p.id, { [FIELD[mode]]: undefined }, { record: false });
  };

  const choice = (v: number, label: React.ReactNode, aria: string) => (
    <button key={v} className="btn paint-choice" aria-pressed={value === v} aria-label={aria} onClick={() => useApp.setState({ paintValue: v })}>
      {label}
    </button>
  );

  return (
    <section className="floating transform-panel" aria-label={t.paint.title}>
      <div className="seg paint-modes" role="radiogroup" aria-label={t.paint.title}>
        {(['color', 'support', 'seam'] as PaintMode[]).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} aria-pressed={mode === m} onClick={() => setMode(m)}>
            {m === 'color' ? t.paint.color : m === 'support' ? t.paint.supports : t.paint.seam}
          </button>
        ))}
      </div>
      {!object ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {t.paint.needsSelection}
        </p>
      ) : (
        <>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {mode === 'color'
              ? heads.map((h, i) =>
                  choice(
                    i + 1,
                    <>
                      <Swatch color={h.color} size={14} />
                      <span className="mono">{i + 1}</span>
                    </>,
                    `${t.paint.color} ${i + 1}`,
                  ),
                )
              : [choice(1, t.paint.force, t.paint.force), choice(2, t.paint.block, t.paint.block)]}
            {choice(0, t.paint.erase, t.paint.erase)}
          </div>
          <label className="row" style={{ fontSize: 13 }} htmlFor="brush-radius">
            <span className="numfield-label" style={{ minWidth: 56 }}>
              ⌀ {radius} mm
            </span>
            <input
              id="brush-radius"
              type="range"
              min={1}
              max={25}
              value={radius}
              disabled={fill}
              onChange={(e) => useApp.setState({ brushRadius: Number(e.target.value) })}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
          </label>
          <label className="row" style={{ fontSize: 13 }} htmlFor="brush-fill">
            <input id="brush-fill" type="checkbox" checked={fill} onChange={(e) => useApp.setState({ brushFill: e.target.checked })} />
            {t.paint.fill}
          </label>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            {t.paint.help}
          </p>
          <button className="link-btn" style={{ fontSize: 13, alignSelf: 'flex-start' }} onClick={clearAll}>
            {t.paint.clear}
          </button>
        </>
      )}
    </section>
  );
}
