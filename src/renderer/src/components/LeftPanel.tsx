import { useState } from 'react';
import { useApp, objectsOnPlate, plateIndex, type SceneObject } from '../state/app';
import { fmt, useT } from '../i18n';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { arrangeObjects, duplicateSelection, moveSelectionToPlate, openModelsDialog } from '../actions';

export function Swatch({ color, size = 10 }: { color: string; size?: number }) {
  return <span className="swatch" aria-hidden="true" style={{ width: size, height: size, background: color }} />;
}

const filamentLabel = (name: string) => name.replace(/ @U1$/, '').replace(/^Snapmaker /, '');

/** Chip with a toolhead's colour and number; opens a menu to pick another. */
function HeadChip({
  head,
  label,
  onPick,
  allowInherit,
  inheritLabel,
}: {
  head: number | null;
  label: string;
  onPick(head: number | null): void;
  allowInherit?: boolean;
  inheritLabel?: string;
}) {
  const heads = useApp((s) => s.heads);
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button className="head-chip" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {head === null ? <span className="muted">=</span> : <Swatch color={heads[head].color} />}
        {head === null ? '' : head + 1}
        <Icon name="chevDown" size={14} />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} label={label} style={{ right: 0, top: 34 }}>
          {allowInherit && (
            <button role="menuitemradio" aria-checked={head === null} onClick={() => (onPick(null), setOpen(false))}>
              <span className="muted">=</span>
              <span>{inheritLabel}</span>
            </button>
          )}
          {heads.map((h, i) => (
            <button key={i} role="menuitemradio" aria-checked={i === head} onClick={() => (onPick(i), setOpen(false))}>
              <Swatch color={h.color} size={12} />
              <span className="mono">{i + 1}</span>
              <span>{filamentLabel(h.filament)}</span>
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}

function ObjectMenu({ object }: { object: SceneObject }) {
  const { t } = useT();
  const plates = useApp((s) => s.plates);
  const [open, setOpen] = useState(false);
  const select = () => {
    const s = useApp.getState();
    if (!s.selectedIds.includes(object.id)) s.select([object.id]);
  };
  const label = fmt(t.objects.more, { name: object.name });
  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" style={{ width: 28, height: 30 }} aria-label={label} aria-expanded={open} onClick={() => (select(), setOpen((v) => !v))}>
        <Icon name="more" />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} label={label} style={{ right: 0, top: 34 }}>
          <button onClick={() => (duplicateSelection(), setOpen(false))}>{t.objects.duplicate}</button>
          {plates
            .filter((p) => p.id !== object.plate)
            .map((p) => (
              <button key={p.id} onClick={() => (moveSelectionToPlate(p.id), setOpen(false))}>
                {fmt(t.plates.moveTo, { name: p.name || fmt(t.left.plate, { n: plateIndex(plates, p.id) }) })}
              </button>
            ))}
          <button onClick={() => (useApp.getState().removeObjects(useApp.getState().selectedIds), setOpen(false))}>{t.objects.delete}</button>
        </Popover>
      )}
    </div>
  );
}

function PlateBar() {
  const { t } = useT();
  const plates = useApp((s) => s.plates);
  const plate = useApp((s) => s.plate);
  const objects = useApp((s) => s.objects);
  const [menu, setMenu] = useState(false);
  const name = (id: string) => plates.find((p) => p.id === id)?.name || fmt(t.left.plate, { n: plateIndex(plates, id) });

  const remove = async () => {
    setMenu(false);
    const count = objects.filter((o) => o.plate === plate).length;
    if (count > 0) {
      const choice = await window.sepia.ask(fmt(t.plates.removeConfirm, { name: name(plate), count }), '', [t.actions.cancel, t.plates.remove]);
      if (choice !== 1) return;
    }
    useApp.getState().removePlate(plate);
  };

  return (
    <section className="stack">
      <div className="row between">
        <h2 className="eyebrow">{t.left.plates}</h2>
        {plates.length > 1 && (
          <div style={{ position: 'relative' }}>
            <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label={t.plates.menu} aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
              <Icon name="more" />
            </button>
            {menu && (
              <Popover onClose={() => setMenu(false)} label={t.plates.menu} style={{ right: 0, top: 32 }}>
                <button onClick={remove}>{t.plates.remove}</button>
              </Popover>
            )}
          </div>
        )}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {plates.map((p) => (
          <button key={p.id} className="plate-btn" aria-pressed={p.id === plate} onClick={() => useApp.getState().setPlate(p.id)}>
            {name(p.id)}
          </button>
        ))}
        <button className="plate-btn" aria-label={t.plates.add} title={t.plates.add} onClick={() => useApp.getState().addPlate()}>
          <Icon name="plus" />
        </button>
      </div>
    </section>
  );
}

export function LeftPanel() {
  const { t } = useT();
  const all = useApp((s) => s.objects);
  const plate = useApp((s) => s.plate);
  const plates = useApp((s) => s.plates);
  const selectedIds = useApp((s) => s.selectedIds);
  const heads = useApp((s) => s.heads);
  const objects = objectsOnPlate({ objects: all, plate });

  /** Click selects one; ⌘/Ctrl adds or removes; Shift selects a range. */
  const onRowClick = (e: React.MouseEvent, id: string) => {
    const s = useApp.getState();
    if (e.metaKey || e.ctrlKey) {
      s.select(s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id]);
    } else if (e.shiftKey && s.selectedIds.length) {
      const ids = objects.map((o) => o.id);
      const from = ids.indexOf(s.selectedIds[s.selectedIds.length - 1]);
      const to = ids.indexOf(id);
      s.select(ids.slice(Math.min(from, to), Math.max(from, to) + 1));
    } else {
      s.select(s.selectedIds.length === 1 && s.selectedIds[0] === id ? [] : [id]);
    }
  };

  return (
    <aside className="left" aria-label={t.left.plates}>
      <PlateBar />

      <section className="stack">
        <h2 className="eyebrow">{fmt(t.left.objectsOnPlate, { n: plateIndex(plates, plate) })}</h2>
        {objects.length === 0 ? (
          <p className="empty-note">{t.left.noObjects}</p>
        ) : (
          <ul className="obj-list">
            {objects.map((o) => {
              const selected = selectedIds.includes(o.id);
              return (
                <li key={o.id}>
                  <div className="obj-row" data-selected={selected}>
                    <button onClick={(e) => onRowClick(e, o.id)} title={o.name} aria-pressed={selected}>
                      {o.name}
                    </button>
                    <HeadChip head={o.head} label={fmt(t.left.headOf, { name: o.name, n: o.head + 1 })} onPick={(h) => useApp.getState().updateObject(o.id, { head: h ?? 0 })} />
                    <ObjectMenu object={o} />
                  </div>
                  {o.parts.length > 1 && (
                    <ul className="part-list">
                      {o.parts.map((p) => (
                        <li key={p.id}>
                          <span title={p.name}>{p.name}</span>
                          <HeadChip
                            head={p.head}
                            allowInherit
                            inheritLabel={t.objects.sameAsObject}
                            label={fmt(t.objects.headOfPart, { name: p.name, n: (p.head ?? o.head) + 1 })}
                            onPick={(h) => useApp.getState().updatePart(o.id, p.id, { head: h })}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {selectedIds.length > 1 && (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {fmt(t.objects.selected, { count: selectedIds.length })}
          </p>
        )}
        <div className="row">
          <button className="btn btn-dashed" style={{ flex: 1, minWidth: 0 }} onClick={() => openModelsDialog()}>
            {t.actions.addModel}
          </button>
          <button
            className="btn"
            style={{ flex: 'none', width: 40, padding: 0 }}
            aria-label={t.edit.arrangeHelp}
            title={t.edit.arrangeHelp}
            disabled={objects.length === 0}
            onClick={() => arrangeObjects()}
          >
            <Icon name="arrange" />
          </button>
        </div>
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
              <span title={h.filament}>{filamentLabel(h.filament)}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
