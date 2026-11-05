import { useEffect, useRef, useState } from 'react';
import { SECTIONS, SETTINGS } from '@shared/settings-schema';
import type { SectionDef, SettingDef } from '@shared/settings-types';
import { FILAMENT_SECTIONS, FILAMENT_SETTINGS, type FilamentSettingDef } from '@shared/filament-schema';
import { filamentValue } from '../state/app';
import { useShallow } from 'zustand/react/shallow';
import { useApp, plateValue, profileValue, objectValue, singleSelection, plateIndex, type SceneObject } from '../state/app';
import { fmt, useT } from '../i18n';
import { describeValue, displayNumber, isOn, parseNumber, toggleValue } from '../settings/format';
import { selectProfile } from '../actions';
import { Icon } from './Icon';
import { Popover } from './Popover';

const BY_SECTION = new Map(SECTIONS.map((s) => [s.id, SETTINGS.filter((d) => d.section === s.id)]));

export function SettingsPanel() {
  const { t } = useT();
  const selected = useApp(singleSelection);
  const ready = useApp((s) => Object.keys(s.processBase).length > 0);
  const engine = useApp((s) => s.engine);

  return (
    <aside className="right" aria-label={t.settings.plateTitle}>
      {selected ? <PieceHeader object={selected} /> : <PlateHeader />}
      <div className="settings-scroll">
        {!ready ? (
          <p className="note">{engine && !engine.found ? t.prefs.engineMissing : t.settings.loading}</p>
        ) : selected ? (
          <PieceList object={selected} />
        ) : (
          <>
            <PlateList />
            <FilamentList />
          </>
        )}
      </div>
    </aside>
  );
}

// ---------- Headers ----------

function PlateHeader() {
  const { t } = useT();
  const catalog = useApp((s) => s.catalog);
  const process = useApp((s) => s.process);
  const userProfile = useApp((s) => s.userProfile);
  const userProfiles = useApp((s) => s.userProfiles);
  const overrides = useApp((s) => s.overrides);
  const onlyChanged = useApp((s) => s.onlyChanged);
  const [menu, setMenu] = useState(false);
  const count = Object.keys(overrides).length;

  const save = () => {
    if (userProfile) useApp.getState().saveUserProfile();
    else useApp.setState({ saveAsOpen: true });
  };

  return (
    <div className="settings-head">
      <div className="row between">
        <h2>{t.settings.plateTitle}</h2>
        <div style={{ position: 'relative' }}>
          <button className="icon-btn" aria-label={t.actions.moreOptions} aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            <Icon name="more" size={18} />
          </button>
          {menu && (
            <Popover onClose={() => setMenu(false)} label={t.actions.moreOptions} style={{ right: 0, top: 40 }}>
              <button
                onClick={() => {
                  setMenu(false);
                  useApp.setState({ saveAsOpen: true });
                }}
              >
                {t.settings.saveAs}…
              </button>
              <button
                disabled={count === 0}
                onClick={() => {
                  setMenu(false);
                  useApp.getState().discardChanges();
                }}
              >
                {t.settings.discard}
              </button>
            </Popover>
          )}
        </div>
      </div>
      <div className="row">
        <label className="visually-hidden" htmlFor="profile-select">
          Profile
        </label>
        <select
          id="profile-select"
          className="profile-select"
          value={userProfile ? `user:${userProfile}` : process}
          onChange={(e) => selectProfile(e.target.value)}
        >
          <optgroup label={t.settings.orcaProfiles}>
            {(catalog?.processes ?? []).map((p) => (
              <option key={p.name} value={p.name}>
                {p.name.replace(' @Snapmaker U1 (0.4 nozzle)', '')}
              </option>
            ))}
          </optgroup>
          {userProfiles.length > 0 && (
            <optgroup label={t.settings.yourProfiles}>
              {userProfiles.map((p) => (
                <option key={p.name} value={`user:${p.name}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button className="btn btn-primary" disabled={count === 0} onClick={save}>
          {t.actions.save}
        </button>
      </div>
      <div className="row between" style={{ fontSize: 13, flexWrap: 'wrap' }}>
        <span style={{ color: count ? 'var(--accent-ink)' : 'var(--muted)', fontWeight: count ? 600 : 400 }}>
          {count === 0 ? t.settings.noChanges : count === 1 ? t.settings.unsavedOne : fmt(t.settings.unsaved, { count })}
        </span>
        <div className="row">
          <label htmlFor="only-changed">{t.settings.onlyChanged}</label>
          <button
            id="only-changed"
            role="switch"
            aria-checked={onlyChanged}
            className="switch small"
            onClick={() => useApp.setState({ onlyChanged: !onlyChanged })}
          />
        </div>
      </div>
    </div>
  );
}

function PieceHeader({ object }: { object: SceneObject }) {
  const { t } = useT();
  const plateNumber = useApp((s) => plateIndex(s.plates, object.plate));
  return (
    <div className="settings-head" style={{ gap: 6 }}>
      <nav className="crumbs" aria-label="Breadcrumb">
        <button className="link-btn" onClick={() => useApp.getState().select([])}>
          {fmt(t.left.plate, { n: plateNumber })}
        </button>
        <Icon name="chevRight" size={14} />
        <span>{object.name}</span>
      </nav>
      <h2>{t.settings.pieceTitle}</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {t.settings.pieceHelp}
      </p>
    </div>
  );
}

// ---------- Lists ----------

function SectionHeader({ section, changes, collapsed, onToggle }: { section: SectionDef; changes: number; collapsed: boolean; onToggle(): void }) {
  const { L } = useT();
  return (
    <h3 className="section-head">
      <button aria-expanded={!collapsed} onClick={onToggle}>
        <span style={{ flex: 1 }}>{L(section.label)}</span>
        {changes > 0 && <span className="badge">{changes}</span>}
        <Icon name={collapsed ? 'chevRight' : 'chevDown'} />
      </button>
    </h3>
  );
}

const pickSettingsState = (s: ReturnType<typeof useApp.getState>) => ({
  overrides: s.overrides,
  processBase: s.processBase,
  machineBase: s.machineBase,
  profileOverrides: s.profileOverrides,
  onlyChanged: s.onlyChanged,
  expanded: s.expanded,
  collapsed: s.collapsed,
  highlight: s.highlight,
  setSetting: s.setSetting,
});

function PlateList() {
  const { t, lang } = useT();
  const state = useApp(useShallow(pickSettingsState));
  const { onlyChanged, expanded, collapsed, highlight } = state;
  const isChanged = (key: string) => key in state.overrides;

  const sections = SECTIONS.map((section) => {
    const defs = BY_SECTION.get(section.id) ?? [];
    const changes = defs.filter((d) => isChanged(d.key)).length;
    const isCollapsed = collapsed[section.id] ?? section.id === 'advanced';
    const showAll = expanded[section.id] ?? false;
    const visible = defs.filter((d) => (onlyChanged ? isChanged(d.key) : d.basic || showAll || isChanged(d.key) || highlight?.key === d.key));
    return { section, defs, changes, isCollapsed, showAll, visible };
  }).filter((s) => !onlyChanged || s.changes > 0);

  if (onlyChanged && sections.length === 0) return <p className="note">{t.settings.noChanges}</p>;

  return (
    <>
      {sections.map(({ section, defs, changes, isCollapsed, showAll, visible }) => (
        <section key={section.id} aria-label={section.id}>
          <SectionHeader
            section={section}
            changes={changes}
            collapsed={isCollapsed}
            onToggle={() => useApp.setState((s) => ({ collapsed: { ...s.collapsed, [section.id]: !isCollapsed } }))}
          />
          {!isCollapsed && (
            <>
              {visible.map((def) => {
                const value = plateValue(state, def.key);
                const original = profileValue(state, def.key);
                const changed = isChanged(def.key);
                return (
                  <SettingRow
                    key={def.key}
                    def={def}
                    value={value}
                    changed={changed}
                    note={changed ? fmt(t.settings.profileHas, { value: describeValue(def, original, lang, t.settings.layers) }) : undefined}
                    undoLabel={changed ? fmt(t.actions.resetTo, { value: describeValue(def, original, lang, t.settings.layers) }) : undefined}
                    onUndo={() => state.setSetting(def.key, null)}
                    onChange={(v) => state.setSetting(def.key, v)}
                  />
                );
              })}
              {!onlyChanged && defs.length > visible.length && (
                <button className="more-btn" onClick={() => useApp.setState((s) => ({ expanded: { ...s.expanded, [section.id]: true } }))}>
                  {fmt(t.actions.showMore, { count: defs.length - visible.length })}
                </button>
              )}
              {!onlyChanged && showAll && defs.some((d) => !d.basic) && (
                <button className="more-btn" onClick={() => useApp.setState((s) => ({ expanded: { ...s.expanded, [section.id]: false } }))}>
                  {t.actions.showLess}
                </button>
              )}
            </>
          )}
        </section>
      ))}
    </>
  );
}

function PieceList({ object }: { object: SceneObject }) {
  const { t, L, lang } = useT();
  const state = useApp(useShallow(pickSettingsState));
  const overridden = SETTINGS.filter((d) => d.key in object.overrides);

  return (
    <>
      <section aria-label={t.settings.changedHere} style={{ paddingBottom: 8 }}>
        <h3 className="section-head" style={{ position: 'static' }}>
          <button style={{ cursor: 'default', color: 'var(--accent-ink)' }} tabIndex={-1}>
            <span style={{ flex: 1 }}>{t.settings.changedHere}</span>
            {overridden.length > 0 && <span className="badge">{overridden.length}</span>}
          </button>
        </h3>
        {overridden.map((def) => {
          const plate = plateValue(state, def.key);
          return (
            <SettingRow
              key={def.key}
              def={def}
              idPrefix="ov"
              value={object.overrides[def.key]}
              changed
              tag={L(SECTIONS.find((s) => s.id === def.section)!.label)}
              note={fmt(t.settings.onPlate, { value: describeValue(def, plate, lang, t.settings.layers) })}
              undoLabel={t.actions.remove}
              undoIcon="x"
              onUndo={() => state.setSetting(def.key, null, object.id)}
              onChange={(v) => state.setSetting(def.key, v, object.id)}
            />
          );
        })}
        <p className="note" style={{ paddingBottom: 4 }}>
          {t.settings.otherHere}
        </p>
      </section>
      {SECTIONS.map((section) => {
        const defs = (BY_SECTION.get(section.id) ?? []).filter((d) => d.perObject);
        if (defs.length === 0) return null;
        const changes = defs.filter((d) => d.key in object.overrides).length;
        return (
          <section key={section.id} aria-label={section.id}>
            <SectionHeader section={section} changes={changes} collapsed={false} onToggle={() => undefined} />
            {defs
              .filter((d) => d.basic || d.key in object.overrides || state.expanded[section.id])
              .map((def) => {
                const own = def.key in object.overrides;
                return (
                  <SettingRow
                    key={def.key}
                    def={def}
                    value={objectValue(state, def.key, object)}
                    changed={own}
                    dim={!own}
                    tag={own ? t.settings.onlyThisPiece : undefined}
                    onChange={(v) => state.setSetting(def.key, v, object.id)}
                  />
                );
              })}
          </section>
        );
      })}
      <p className="note">{t.settings.plateOnly}</p>
    </>
  );
}

// ---------- One setting ----------

type RowDef = Pick<SettingDef, 'key' | 'kind' | 'unit' | 'percent' | 'min' | 'max' | 'options' | 'label' | 'help'> & { nullable?: boolean };

interface RowProps {
  def: RowDef;
  value: string;
  changed: boolean;
  dim?: boolean;
  tag?: string;
  note?: string;
  undoLabel?: string;
  undoIcon?: 'undo' | 'x';
  idPrefix?: string;
  onUndo?(): void;
  onChange(value: string): void;
}

function SettingRow({ def, value, changed, dim, tag, note, undoLabel, undoIcon = 'undo', idPrefix = 's', onUndo, onChange }: RowProps) {
  const { t, L, lang } = useT();
  const highlight = useApp((s) => s.highlight);
  const ref = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(false);
  const id = `${idPrefix}-${def.key}`;

  useEffect(() => {
    if (highlight?.key !== def.key) return;
    ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    (ref.current?.querySelector('input, select, button[role=switch]') as HTMLElement | null)?.focus({ preventScroll: true });
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 2600);
    return () => clearTimeout(timer);
  }, [highlight, def.key]);

  return (
    <div ref={ref} className="setting" data-changed={changed} data-dim={dim ?? false} data-highlight={flash}>
      <div className="setting-line">
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <label htmlFor={id} title={def.key}>
            {changed && <span className="changed-dot" aria-hidden="true" />}
            {L(def.label)}
          </label>
          {tag && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{tag}</span>}
        </div>
        <Control id={id} def={def} value={value} onChange={onChange} lang={lang} layersWord={t.settings.layers} />
      </div>
      {note && (
        <div className="setting-note">
          <span>{note}</span>
          {undoLabel && onUndo && (
            <button className="undo-btn" onClick={onUndo}>
              <Icon name={undoIcon} size={14} stroke={2} />
              {undoLabel}
            </button>
          )}
        </div>
      )}
      {flash && <p className="setting-help">{L(def.help)}</p>}
    </div>
  );
}

function Control({
  id,
  def,
  value,
  onChange,
  lang,
  layersWord,
}: {
  id: string;
  def: RowDef;
  value: string;
  onChange(v: string): void;
  lang: 'en' | 'es';
  layersWord: string;
}) {
  const shown = displayNumber(def, value, lang);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  if (def.kind === 'toggle') {
    const on = isOn(value);
    return <button id={id} role="switch" aria-checked={on} className="switch" onClick={() => onChange(toggleValue(value, !on))} />;
  }
  if (def.kind === 'select') {
    const options = def.options ?? [];
    const known = options.some((o) => o.value === value);
    return (
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {!known && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label[lang]}
          </option>
        ))}
      </select>
    );
  }
  const unit = def.unit === 'layers' ? layersWord : def.unit;
  const commit = () => {
    // A filament override left empty means "use the printer's value".
    if (def.nullable && draft.trim() === '') {
      if (value !== '') onChange('');
      return;
    }
    const parsed = parseNumber(def, draft);
    if (parsed === null) setDraft(shown);
    else if (parsed !== value) onChange(parsed);
  };
  return (
    <span className="num">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={draft}
        style={{ width: Math.max(32, draft.length * 9 + 8) }}
        placeholder={def.nullable ? '—' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(shown);
        }}
      />
      {unit && <span>{unit}</span>}
    </span>
  );
}

// ---------- Filament settings, per toolhead ----------

const FILAMENT_BY_SECTION = new Map(FILAMENT_SECTIONS.map((sec) => [sec.id, FILAMENT_SETTINGS.filter((d) => d.section === sec.id)]));

function FilamentList() {
  const { t, L, lang } = useT();
  const heads = useApp((s) => s.heads);
  const head = useApp((s) => s.filamentHead);
  const base = useApp((s) => s.filamentBase[s.filamentHead]);
  const own = useApp((s) => s.filamentOverrides[s.filamentHead]);
  const onlyChanged = useApp((s) => s.onlyChanged);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (!base || Object.keys(base).length === 0) return null;
  const value = (d: FilamentSettingDef) => own?.[d.key] ?? filamentValue(base, d.key);
  const changed = (d: FilamentSettingDef) => own !== undefined && d.key in own;
  const total = FILAMENT_SETTINGS.filter(changed).length;

  return (
    <section aria-label={t.filament.title} className="filament-block">
      <div className="filament-head">
        <h3 style={{ margin: 0, fontSize: 15 }}>
          {t.filament.title}
          {total > 0 && (
            <span className="badge" style={{ marginLeft: 8 }}>
              {total}
            </span>
          )}
        </h3>
        <div className="seg" role="radiogroup" aria-label={t.filament.head}>
          {heads.map((h, i) => (
            <button key={i} role="radio" aria-checked={head === i} aria-pressed={head === i} onClick={() => useApp.setState({ filamentHead: i })} title={h.filament}>
              <span className="swatch" aria-hidden="true" style={{ width: 10, height: 10, background: h.color }} /> {i + 1}
            </button>
          ))}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {fmt(t.filament.profile, { name: heads[head].filament.replace(/ @U1$/, '') })}
        </p>
      </div>
      {FILAMENT_SECTIONS.map((section) => {
        const defs = FILAMENT_BY_SECTION.get(section.id) ?? [];
        const showAll = expanded[section.id];
        const visible = defs.filter((d) => (onlyChanged ? changed(d) : d.basic || showAll || changed(d)));
        if (onlyChanged && visible.length === 0) return null;
        const count = defs.filter(changed).length;
        return (
          <section key={section.id} aria-label={section.id}>
            <h3 className="section-head">
              <button aria-expanded="true" onClick={() => setExpanded((e) => ({ ...e, [section.id]: !showAll }))}>
                <span style={{ flex: 1 }}>{L(section.label)}</span>
                {count > 0 && <span className="badge">{count}</span>}
              </button>
            </h3>
            {visible.map((d) => {
              const original = filamentValue(base, d.key);
              const isChanged = changed(d);
              const shownOriginal = original === '' ? t.filament.printerValue : describeValue(d, original, lang, t.settings.layers);
              return (
                <SettingRow
                  key={d.key}
                  idPrefix={`f${head}`}
                  def={d}
                  value={value(d)}
                  changed={isChanged}
                  note={isChanged ? fmt(t.settings.profileHas, { value: shownOriginal }) : undefined}
                  undoLabel={isChanged ? fmt(t.actions.resetTo, { value: shownOriginal }) : undefined}
                  onUndo={() => useApp.getState().setFilamentSetting(head, d.key, null)}
                  onChange={(v) => useApp.getState().setFilamentSetting(head, d.key, v)}
                />
              );
            })}
            {!onlyChanged && defs.length > visible.length && (
              <button className="more-btn" onClick={() => setExpanded((e) => ({ ...e, [section.id]: true }))}>
                {fmt(t.actions.showMore, { count: defs.length - visible.length })}
              </button>
            )}
          </section>
        );
      })}
    </section>
  );
}

