import { useState } from 'react';
import { useApp } from '../state/app';
import { fmt, useT } from '../i18n';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { openModelsDialog } from '../actions';

export function Swatch({ color, size = 10 }: { color: string; size?: number }) {
  return <span className="swatch" aria-hidden="true" style={{ width: size, height: size, background: color }} />;
}

function HeadChip({ objectId, name, head }: { objectId: string; name: string; head: number }) {
  const { t } = useT();
  const heads = useApp((s) => s.heads);
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button className="head-chip" aria-label={fmt(t.left.headOf, { name, n: head + 1 })} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Swatch color={heads[head].color} />
        {head + 1}
        <Icon name="chevDown" size={14} />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} label={name} style={{ right: 0, top: 34 }}>
          {heads.map((h, i) => (
            <button
              key={i}
              role="menuitemradio"
              aria-checked={i === head}
              onClick={() => {
                useApp.getState().updateObject(objectId, { head: i });
                setOpen(false);
              }}
            >
              <Swatch color={h.color} size={12} />
              <span className="mono">{i + 1}</span>
              <span>{h.filament.replace(/ @U1$/, '').replace(/^Snapmaker /, '')}</span>
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}

export function LeftPanel() {
  const { t } = useT();
  const objects = useApp((s) => s.objects);
  const selectedId = useApp((s) => s.selectedId);
  const heads = useApp((s) => s.heads);

  return (
    <aside className="left" aria-label={t.left.plates}>
      <section className="stack">
        <h2 className="eyebrow">{t.left.plates}</h2>
        <div className="row">
          <button className="plate-btn" aria-pressed="true">
            {fmt(t.left.plate, { n: 1 })}
          </button>
          <button className="plate-btn" aria-label={t.tools.soon} title={t.tools.soon} disabled>
            <Icon name="plus" />
          </button>
        </div>
      </section>

      <section className="stack">
        <h2 className="eyebrow">{fmt(t.left.objectsOnPlate, { n: 1 })}</h2>
        {objects.length === 0 ? (
          <p className="empty-note">{t.left.noObjects}</p>
        ) : (
          <ul className="obj-list">
            {objects.map((o) => (
              <li key={o.id} className="obj-row" data-selected={o.id === selectedId}>
                <button onClick={() => useApp.setState({ selectedId: o.id === selectedId ? null : o.id })} title={o.name}>
                  {o.name}
                </button>
                <HeadChip objectId={o.id} name={o.name} head={o.head} />
              </li>
            ))}
          </ul>
        )}
        <button className="btn btn-dashed" onClick={() => openModelsDialog()}>
          {t.actions.addModel}
        </button>
      </section>

      <section className="stack" style={{ marginTop: 'auto' }}>
        <div className="row between">
          <h2 className="eyebrow">{t.left.loaded}</h2>
          <button className="link-btn" style={{ fontSize: 13 }} onClick={() => useApp.setState({ headsOpen: true })}>
            {t.left.editHeads}
          </button>
        </div>
        <ul className="head-list">
          {heads.map((h, i) => (
            <li key={i}>
              <Swatch color={h.color} size={14} />
              <span className="mono">{i + 1}</span>
              <span title={h.filament}>{h.filament.replace(/ @U1$/, '').replace(/^Snapmaker /, '')}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
