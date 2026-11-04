import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SECTIONS, SETTINGS } from '@shared/settings-schema';
import { useApp, plateValue } from '../state/app';
import { usePrefs } from '../state/prefs';
import { fmt, useT } from '../i18n';
import { describeValue } from '../settings/format';
import { exportGcode, openModelsDialog, sliceNow } from '../actions';
import { Icon, type IconName } from './Icon';

interface Item {
  id: string;
  group: 'settings' | 'objects' | 'actions';
  title: string;
  crumb?: string;
  sub?: string;
  value?: string;
  chip?: string;
  icon?: IconName;
  run(): void;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function score(query: string, fields: string[]): number {
  if (!query) return 1;
  const words = norm(query).split(/\s+/).filter(Boolean);
  let total = 0;
  for (const w of words) {
    let best = 0;
    for (const [i, f] of fields.entries()) {
      const n = norm(f);
      const at = n.indexOf(w);
      if (at === -1) continue;
      const s = (at === 0 ? 3 : n[at - 1] === ' ' ? 2 : 1) * (i === 0 ? 2 : 1);
      best = Math.max(best, s);
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

export function CommandPalette() {
  const { t, L, lang } = useT();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const state = useApp();
  const close = () => useApp.setState({ paletteOpen: false });

  useEffect(() => inputRef.current?.focus(), []);

  const items = useMemo(() => {
    const out: (Item & { score: number })[] = [];
    const sectionLabel = (id: string) => L(SECTIONS.find((s) => s.id === id)!.label);
    if (Object.keys(state.processBase).length) {
      for (const def of SETTINGS) {
        const sc = score(query, [def.label[lang], def.label.en, def.label.es, ...(def.keywords ?? []), def.key, sectionLabel(def.section)]);
        if (!sc) continue;
        out.push({
          id: `s:${def.key}`,
          group: 'settings',
          crumb: sectionLabel(def.section),
          title: L(def.label),
          value: describeValue(def, plateValue(state, def.key), lang, t.settings.layers),
          chip: def.scope === 'machine' ? 'Snapmaker U1' : fmt(t.left.plate, { n: 1 }),
          run: () => {
            close();
            useApp.setState({ selectedId: null });
            state.focusSetting(def.key);
          },
          score: sc,
        });
      }
    }
    for (const o of state.objects) {
      const sc = score(query, [o.name]);
      if (!sc) continue;
      out.push({
        id: `o:${o.id}`,
        group: 'objects',
        title: o.name,
        sub: `${fmt(t.left.plate, { n: 1 })} · ${t.heads.head.replace('{n}', String(o.head + 1))}`,
        icon: 'cube',
        run: () => {
          close();
          useApp.setState({ selectedId: o.id, tab: 'prepare' });
        },
        score: sc + 1,
      });
    }
    const prefs = usePrefs.getState();
    const actions: [string, IconName, () => void][] = [
      [t.commands.addModel, 'plus', () => openModelsDialog()],
      [t.commands.slice, 'layers', () => sliceNow()],
      [t.commands.prepare, 'cube', () => useApp.setState({ tab: 'prepare' })],
      [t.commands.preview, 'eye', () => useApp.setState({ tab: 'preview' })],
      [t.commands.printer, 'printer', () => useApp.setState({ tab: 'printer' })],
      [t.commands.editHeads, 'paint', () => useApp.setState({ headsOpen: true })],
      [t.commands.toggleLeft, 'prev', () => prefs.togglePanel('left')],
      [t.commands.toggleRight, 'next', () => prefs.togglePanel('right')],
      [t.commands.viewIso, 'cube', () => state.setView('iso')],
      [t.commands.viewTop, 'cube', () => state.setView('top')],
      [t.commands.viewFront, 'cube', () => state.setView('front')],
      [t.commands.themeSystem, 'monitor', () => prefs.setTheme('system')],
      [t.commands.themeLight, 'sun', () => prefs.setTheme('light')],
      [t.commands.themeDark, 'moon', () => prefs.setTheme('dark')],
      [t.commands.langEn, 'globe', () => prefs.setLang('en')],
      [t.commands.langEs, 'globe', () => prefs.setLang('es')],
    ];
    if (state.gcode) actions.push([t.commands.exportGcode, 'download', () => exportGcode()]);
    if (state.selectedId) actions.push([t.commands.deleteSelected, 'trash', () => state.removeObject(state.selectedId!)]);
    for (const [title, icon, run] of actions) {
      const sc = score(query, [title]);
      if (!sc || !query) continue;
      out.push({ id: `a:${title}`, group: 'actions', title, icon, run: () => (close(), run()), score: sc });
    }
    if (!query) {
      // With nothing typed, offer the most useful actions first.
      for (const [title, icon, run] of actions.slice(0, 6)) {
        out.push({ id: `a:${title}`, group: 'actions', title, icon, run: () => (close(), run()), score: 1 });
      }
    }
    const order = { settings: 0, objects: 1, actions: 2 };
    const groups = (['settings', 'objects', 'actions'] as const).map((g) =>
      out
        .filter((i) => i.group === g)
        .sort((a, b) => b.score - a.score)
        .slice(0, query ? (g === 'settings' ? 8 : 5) : g === 'settings' ? 0 : 6),
    );
    return groups.flat().sort((a, b) => order[a.group] - order[b.group]);
  }, [query, lang, state, t, L]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[active]?.run();
    }
  };

  const groupTitle: Record<Item['group'], string> = { settings: t.palette.settings, objects: t.palette.objects, actions: t.palette.actions };
  const rendered: ReactNode[] = [];
  items.forEach((item, i) => {
    if (i === 0 || items[i - 1].group !== item.group) {
      rendered.push(
        <h2 key={`g-${item.group}`} className="eyebrow palette-group">
          {groupTitle[item.group]}
        </h2>,
      );
    }
    rendered.push(
      <button
        key={item.id}
        data-index={i}
        role="option"
        aria-selected={i === active}
        className="palette-item"
        onMouseEnter={() => setActive(i)}
        onClick={() => item.run()}
      >
        {item.icon && (
          <span className="lead-icon">
            <Icon name={item.icon} />
          </span>
        )}
        <span className="texts">
          {item.crumb && <span className="crumb">{item.crumb}</span>}
          <span className="title">{item.title}</span>
          {item.sub && <span className="sub">{item.sub}</span>}
        </span>
        {item.value && <span className="value">{item.value}</span>}
        {item.chip && <span className="scope-chip">{item.chip}</span>}
      </button>,
    );
  });

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t.search.placeholder} onKeyDown={onKey}>
        <div className="palette-input">
          <span className="muted" style={{ display: 'inline-flex' }}>
            <Icon name="search" size={18} />
          </span>
          <input
            ref={inputRef}
            aria-label={t.search.placeholder}
            placeholder={t.search.placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
          />
          <kbd>Esc</kbd>
        </div>
        <div id="palette-results" ref={listRef} className="palette-results" role="listbox">
          {items.length === 0 ? <p className="note">{fmt(t.palette.noResults, { q: query })}</p> : rendered}
        </div>
        <div className="palette-foot">
          <span>
            <kbd>↑ ↓</kbd> {t.palette.hintMove}
          </span>
          <span>
            <kbd>Enter</kbd> {t.palette.hintEdit}
          </span>
          <span>
            <kbd>Esc</kbd> {t.palette.hintClose}
          </span>
        </div>
      </div>
    </div>
  );
}
