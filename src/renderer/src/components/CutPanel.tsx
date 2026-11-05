import { useEffect, useState } from 'react';
import { useApp, singleSelection } from '../state/app';
import { useT } from '../i18n';
import { objectBounds } from '../scene/models';
import { cutObject } from '../actions';
import { NumField } from './NumField';

/** Cut the selected object in two with a horizontal plane. */
export function CutPanel() {
  const { t } = useT();
  const object = useApp(singleSelection);
  const height = useApp((s) => s.cutHeight);
  const [flip, setFlip] = useState(true);
  const bounds = object ? objectBounds(object) : null;
  const top = bounds ? bounds.max.z : 0;

  // Start at half height whenever another object is selected.
  useEffect(() => {
    if (bounds) useApp.setState({ cutHeight: +(top / 2).toFixed(2) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [object?.id]);

  if (!object || !bounds) {
    return (
      <section className="floating transform-panel" aria-label={t.cut.title}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {t.cut.needsSelection}
        </p>
      </section>
    );
  }

  return (
    <section className="floating transform-panel" aria-label={t.cut.title}>
      <div className="row" style={{ gap: 10 }}>
        <input
          type="range"
          aria-label={t.cut.height}
          min={0}
          max={top}
          step={0.1}
          value={height}
          onChange={(e) => useApp.setState({ cutHeight: Number(e.target.value) })}
          style={{ flex: 1, accentColor: 'var(--accent)' }}
        />
        <NumField id="cut-height" label={t.cut.height} value={height} unit="mm" onCommit={(v) => useApp.setState({ cutHeight: Math.min(top, Math.max(0, v)) })} />
      </div>
      <label className="row" style={{ fontSize: 13 }} htmlFor="cut-flip">
        <input id="cut-flip" type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} />
        {t.cut.flip}
      </label>
      <button className="btn btn-primary" onClick={() => cutObject(object.id, height, flip)}>
        {t.cut.apply}
      </button>
    </section>
  );
}
