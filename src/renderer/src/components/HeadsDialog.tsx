import { useApp } from '../state/app';
import { loadFilamentBases } from '../actions';
import { useT } from '../i18n';
import { Swatch } from './LeftPanel';

export function HeadsDialog() {
  const { t } = useT();
  const heads = useApp((s) => s.heads);
  const catalog = useApp((s) => s.catalog);
  const objects = useApp((s) => s.objects);
  const close = () => useApp.setState({ headsOpen: false });
  const filaments = catalog?.filaments ?? [];

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="heads-title">
        <div className="dialog-body">
          <h2 id="heads-title">{t.heads.title}</h2>
          <div className="heads-grid">
            {heads.map((h, i) => {
              const used = objects.filter((o) => o.head === i).map((o) => o.name);
              return (
                <div key={i} className="head-card">
                  <div className="row between">
                    <strong className="mono" style={{ fontSize: 20 }}>
                      {i + 1}
                    </strong>
                    <Swatch color={h.color} size={28} />
                  </div>
                  <div className="field">
                    <label htmlFor={`head-${i}-filament`}>{t.heads.filament}</label>
                    <select
                      id={`head-${i}-filament`}
                      value={h.filament}
                      onChange={(e) => {
                        useApp.getState().setHead(i, { ...h, filament: e.target.value });
                        loadFilamentBases();
                      }}
                    >
                      {!filaments.some((f) => f.name === h.filament) && <option value={h.filament}>{h.filament}</option>}
                      {filaments.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.name.replace(/ @U1$/, '')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="row">
                    <label htmlFor={`head-${i}-color`}>{t.heads.color}</label>
                    <input
                      id={`head-${i}-color`}
                      type="color"
                      value={h.color}
                      onChange={(e) => useApp.getState().setHead(i, { ...h, color: e.target.value.toUpperCase() })}
                    />
                    <span className="mono muted" style={{ fontSize: 12 }}>
                      {h.color}
                    </span>
                  </div>
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    {used.length ? used.join(', ') : t.heads.unused}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn btn-primary" onClick={close} autoFocus>
            {t.actions.close}
          </button>
        </div>
      </div>
    </div>
  );
}

