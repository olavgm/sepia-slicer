import { useEffect, useState } from 'react';
import { useApp, type Tab } from '../state/app';
import { usePrefs } from '../state/prefs';
import { fmt, useT } from '../i18n';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { exportGcode, sendToPrinter, sliceNow } from '../actions';

export function TopBar() {
  const { t } = useT();
  const tab = useApp((s) => s.tab);
  const slicing = useApp((s) => s.slicing);
  const gcode = useApp((s) => s.gcode);
  const objects = useApp((s) => s.objects);
  const host = usePrefs((s) => s.printerHost);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    if (!host) {
      setOnline(null);
      return;
    }
    let alive = true;
    const check = () => window.sepia.printerStatus(host).then((r) => alive && setOnline(r.ok));
    check();
    const id = setInterval(check, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [host]);

  const tabs: Tab[] = ['prepare', 'preview', 'printer'];
  const fileName = objects.length ? objects.map((o) => o.name).join(', ') : t.untitled;

  return (
    <header className="topbar">
      <div className="brand">
        <strong>Sepia</strong>
        <span title={fileName}>{fileName}</span>
      </div>
      <nav className="tabs" aria-label="Sections">
        {tabs.map((id) => (
          <button key={id} className="tab" aria-current={tab === id ? 'page' : undefined} onClick={() => useApp.setState({ tab: id })}>
            {t.tabs[id]}
          </button>
        ))}
      </nav>
      <button className="search-trigger" onClick={() => useApp.setState({ paletteOpen: true })}>
        <Icon name="search" />
        <span>{t.search.placeholder}</span>
        <kbd>⌘K</kbd>
      </button>
      <div className="top-actions">
        <button className="chip" onClick={() => useApp.setState({ tab: 'printer' })}>
          <span className="dot" style={{ background: online ? 'var(--ok)' : 'var(--switch-off)' }} aria-hidden="true" />
          {online === null ? t.printerChip.unknown : online ? t.printerChip.ready : t.printerChip.offline}
        </button>
        <div style={{ position: 'relative' }}>
          <button className="icon-btn" aria-label={t.actions.preferences} aria-expanded={prefsOpen} onClick={() => setPrefsOpen((v) => !v)}>
            <Icon name="gear" size={18} />
          </button>
          {prefsOpen && <PrefsMenu onClose={() => setPrefsOpen(false)} />}
        </div>
        {tab === 'preview' && gcode ? (
          <>
            <button className="btn btn-big" onClick={() => exportGcode()}>
              <Icon name="download" />
              {t.actions.export}
            </button>
            <div style={{ position: 'relative' }}>
              <button
                className="btn btn-primary btn-big"
                onClick={() => (host ? setSendOpen(true) : useApp.setState({ tab: 'printer' }))}
              >
                {t.actions.send}
              </button>
              {sendOpen && <SendMenu onClose={() => setSendOpen(false)} />}
            </div>
          </>
        ) : (
          <button className="btn btn-primary btn-big" disabled={slicing} onClick={() => sliceNow()}>
            {slicing ? t.actions.slicing : t.actions.slice}
          </button>
        )}
      </div>
    </header>
  );
}

function PrefsMenu({ onClose }: { onClose(): void }) {
  const { t } = useT();
  const theme = usePrefs((s) => s.theme);
  const lang = usePrefs((s) => s.lang);
  const engine = useApp((s) => s.engine);
  return (
    <Popover onClose={onClose} label={t.prefs.title} style={{ right: 0, top: 44, width: 280, padding: 14 }}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="stack">
          <p className="eyebrow">{t.prefs.theme}</p>
          <div className="seg" role="radiogroup" aria-label={t.prefs.theme}>
            {(['system', 'light', 'dark'] as const).map((v) => (
              <button key={v} role="radio" aria-checked={theme === v} aria-pressed={theme === v} onClick={() => usePrefs.getState().setTheme(v)}>
                {t.prefs[v]}
              </button>
            ))}
          </div>
        </div>
        <div className="stack">
          <p className="eyebrow">{t.prefs.language}</p>
          <div className="seg" role="radiogroup" aria-label={t.prefs.language}>
            {(
              [
                ['en', 'English'],
                ['es', 'Español'],
              ] as const
            ).map(([v, label]) => (
              <button key={v} role="radio" aria-checked={lang === v} aria-pressed={lang === v} onClick={() => usePrefs.getState().setLang(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="stack">
          <p className="eyebrow">{t.prefs.engine}</p>
          <p style={{ margin: 0, fontSize: 13 }} className={engine?.found ? '' : 'muted'}>
            {engine?.found ? fmt(t.prefs.engineFound, { app: engine.appName ?? '', version: engine.version ?? '' }) : t.prefs.engineMissing}
          </p>
        </div>
      </div>
    </Popover>
  );
}

function SendMenu({ onClose }: { onClose(): void }) {
  const { t } = useT();
  const [state, setState] = useState<string | null>(null);
  const send = async (start: boolean) => {
    setState('…');
    const r = await sendToPrinter(start);
    setState(r.ok ? t.printer.sent : fmt(t.printer.notConnected, { error: r.error ?? '' }));
  };
  return (
    <Popover onClose={onClose} label={t.actions.send} style={{ right: 0, top: 50, width: 300, padding: 14 }}>
      <div className="stack" style={{ gap: 12 }}>
        <p style={{ margin: 0 }}>{t.printer.confirmSend}</p>
        <div className="row">
          <button className="btn btn-primary" onClick={() => send(true)}>
            {t.printer.sendAndPrint}
          </button>
          <button className="btn" onClick={() => send(false)}>
            {t.printer.uploadOnly}
          </button>
        </div>
        {state && <p style={{ margin: 0, fontSize: 13 }}>{state}</p>}
      </div>
    </Popover>
  );
}
