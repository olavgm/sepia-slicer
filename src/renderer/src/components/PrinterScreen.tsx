import { useState } from 'react';
import { usePrefs } from '../state/prefs';
import { fmt, useT } from '../i18n';
import type { PrinterStatus } from '@shared/types';

export function PrinterScreen() {
  const { t } = useT();
  const host = usePrefs((s) => s.printerHost);
  const [draft, setDraft] = useState(host);
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    const value = draft.trim();
    usePrefs.getState().setPrinterHost(value);
    if (!value) return;
    setBusy(true);
    setStatus(await window.sepia.printerStatus(value));
    setBusy(false);
  };

  return (
    <div className="printer-page">
      <form
        className="printer-card"
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
      >
        <h1>{t.printer.title}</h1>
        <div className="field">
          <label htmlFor="printer-host">{t.printer.host}</label>
          <input id="printer-host" type="text" value={draft} placeholder="192.168.1.40" onChange={(e) => setDraft(e.target.value)} />
          <span className="muted" style={{ fontSize: 13 }}>
            {t.printer.hostHelp}
          </span>
        </div>
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
            {t.printer.check}
          </button>
        </div>
        {status &&
          (status.ok ? (
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px' }}>
              <dt className="muted">{t.printer.state}</dt>
              <dd style={{ margin: 0 }}>
                {fmt(t.printer.connected, { name: status.hostname ?? draft })} · {status.state}
              </dd>
              {typeof status.progress === 'number' && (
                <>
                  <dt className="muted">{t.printer.progress}</dt>
                  <dd style={{ margin: 0 }} className="mono">
                    {Math.round(status.progress * 100)} %
                  </dd>
                </>
              )}
            </dl>
          ) : (
            <p className="warn" style={{ margin: 0 }}>
              {fmt(t.printer.notConnected, { error: status.error ?? '' })}
            </p>
          ))}
      </form>
    </div>
  );
}
