import { useEffect, useState } from 'react';
import { usePrefs } from '../state/prefs';
import { useApp } from '../state/app';
import { fmt, useT } from '../i18n';
import { Icon } from './Icon';
import { Swatch } from './LeftPanel';
import { formatDuration } from './PreviewSummary';
import type { PrinterStatus } from '@shared/types';

const STATUS_EVERY = 3000;
const CAMERA_EVERY = 2000;

/** Klipper names the toolheads extruder, extruder1, extruder2… */
const headIndex = (name: string) => (name === 'extruder' ? 0 : Number(name.replace('extruder', '')));

export function PrinterScreen() {
  const { t, lang } = useT();
  const host = usePrefs((s) => s.printerHost);
  const heads = useApp((s) => s.heads);
  const [draft, setDraft] = useState(host);
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Poll the printer while this screen is open.
  useEffect(() => {
    if (!host) return;
    let alive = true;
    const poll = async () => {
      const next = await window.sepia.printerStatus(host);
      if (alive) setStatus(next);
    };
    poll();
    const id = setInterval(poll, STATUS_EVERY);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [host]);

  const hasCamera = status?.ok && status.hasCamera;
  useEffect(() => {
    if (!host || !hasCamera) {
      setFrame(null);
      return;
    }
    let alive = true;
    const grab = async () => {
      const next = await window.sepia.printerSnapshot(host);
      if (alive && next) setFrame(next);
    };
    grab();
    const id = setInterval(grab, CAMERA_EVERY);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [host, hasCamera]);

  const connect = async () => {
    const value = draft.trim();
    if (!value) return;
    setBusy(true);
    usePrefs.getState().setPrinterHost(value);
    setStatus(await window.sepia.printerStatus(value));
    setBusy(false);
  };

  const stateLabel = (state?: string) => (state && state in t.printer.states ? t.printer.states[state as keyof typeof t.printer.states] : state ?? '—');
  const toolheads = status?.heaters?.filter((h) => h.name.startsWith('extruder')) ?? [];
  const bed = status?.heaters?.find((h) => h.name === 'heater_bed');
  const temp = (n: number) => `${Math.round(n)} °C`;

  return (
    <div className="printer-page">
      <div className="printer-grid">
        <form
          className="printer-card"
          onSubmit={(e) => {
            e.preventDefault();
            connect();
          }}
        >
          <h1>{t.printer.title}</h1>
          <div className="field">
            <label htmlFor="printer-host">{t.printer.host}</label>
            <div className="row">
              <input id="printer-host" type="text" value={draft} placeholder="192.168.1.40" style={{ flex: 1 }} onChange={(e) => setDraft(e.target.value)} />
              <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
                {t.printer.check}
              </button>
            </div>
            <span className="muted" style={{ fontSize: 13 }}>
              {t.printer.hostHelp}
            </span>
          </div>

          {status && !status.ok && (
            <p className="warn" style={{ margin: 0 }}>
              {fmt(t.printer.notConnected, { error: status.error ?? '' })}
            </p>
          )}

          {status?.ok && (
            <>
              <div className="stack">
                <div className="row between">
                  <span>{fmt(t.printer.connected, { name: status.hostname ?? host })}</span>
                  <span className="chip" data-state={status.state}>
                    <span className="dot" aria-hidden="true" style={{ background: status.state === 'error' ? '#c0392b' : 'var(--ok)' }} />
                    {stateLabel(status.state)}
                  </span>
                </div>
                {status.filename && (
                  <div className="stack" style={{ gap: 6 }}>
                    <div className="row between" style={{ fontSize: 13 }}>
                      <span className="muted">{t.printer.file}</span>
                      <span className="mono" title={status.filename} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                        {status.filename}
                      </span>
                    </div>
                    {typeof status.progress === 'number' && (
                      <>
                        <div
                          className="bar"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(status.progress * 100)}
                          aria-label={t.printer.progress}
                          style={{ height: 8 }}
                        >
                          <span style={{ width: `${status.progress * 100}%`, background: 'var(--accent)' }} />
                        </div>
                        <div className="row between muted" style={{ fontSize: 13 }}>
                          <span className="mono">{Math.round(status.progress * 100)} %</span>
                          {typeof status.printDuration === 'number' && (
                            <span>
                              {t.printer.elapsed} {formatDuration(status.printDuration, lang)}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="stack">
                <h2 className="eyebrow">{t.printer.temperatures}</h2>
                <ul className="temps">
                  {toolheads.map((h) => {
                    const i = headIndex(h.name);
                    return (
                      <li key={h.name} data-active={status.activeExtruder === h.name}>
                        <Swatch color={heads[i]?.color ?? '#999'} size={14} />
                        <span>
                          {fmt(t.heads.head, { n: i + 1 })}
                          {status.activeExtruder === h.name && <span className="muted"> · {t.printer.activeHead}</span>}
                        </span>
                        <span className="mono">
                          {temp(h.temperature)}
                          {h.target > 0 && <span className="muted"> / {temp(h.target)}</span>}
                        </span>
                      </li>
                    );
                  })}
                  {bed && (
                    <li>
                      <span className="muted" style={{ display: 'inline-flex' }}>
                        <Icon name="thermo" size={14} />
                      </span>
                      <span>{t.printer.bed}</span>
                      <span className="mono">
                        {temp(bed.temperature)}
                        {bed.target > 0 && <span className="muted"> / {temp(bed.target)}</span>}
                      </span>
                    </li>
                  )}
                </ul>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                {t.printer.lastUpdate}
              </p>
            </>
          )}
        </form>

        {status?.ok && (
          <section className="printer-card" aria-label={t.printer.camera}>
            <h2 className="eyebrow">{t.printer.camera}</h2>
            {hasCamera ? (
              frame ? (
                <img className="camera" src={frame} alt={t.printer.camera} />
              ) : (
                <div className="camera camera-empty">
                  <Icon name="camera" size={28} />
                </div>
              )
            ) : (
              <div className="camera camera-empty">
                <Icon name="camera" size={28} />
                <span>{t.printer.noCamera}</span>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
