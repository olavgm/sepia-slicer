import { useState } from 'react';
import { useApp } from '../state/app';
import { useT } from '../i18n';

export function SaveAsDialog() {
  const { t } = useT();
  const process = useApp((s) => s.process);
  const [name, setName] = useState(() => `${process.replace(' @Snapmaker U1 (0.4 nozzle)', '')} (Sepia)`);
  const close = () => useApp.setState({ saveAsOpen: false });
  const save = () => {
    const clean = name.trim();
    if (!clean) return;
    useApp.getState().saveUserProfile(clean);
    close();
  };
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <form
        className="dialog"
        style={{ maxWidth: 440 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-title"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="dialog-body">
          <h2 id="save-title">{t.settings.saveAs}</h2>
          <div className="field">
            <label htmlFor="profile-name">{t.settings.profileName}</label>
            <input id="profile-name" type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={close}>
            {t.actions.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            {t.actions.save}
          </button>
        </div>
      </form>
    </div>
  );
}
