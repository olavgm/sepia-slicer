import { useEffect, useState } from 'react';
import { useApp } from './state/app';
import { usePrefs } from './state/prefs';
import { useResolvedTheme } from './theme';
import { addModels, filesToModels, loadProfiles } from './actions';
import { useT } from './i18n';
import { TopBar } from './components/TopBar';
import { LeftPanel } from './components/LeftPanel';
import { PrepareViewport } from './components/PrepareViewport';
import { SettingsPanel } from './components/SettingsPanel';
import { CommandPalette } from './components/CommandPalette';
import { HeadsDialog } from './components/HeadsDialog';
import { SaveAsDialog } from './components/SaveAsDialog';
import { PreviewSummary } from './components/PreviewSummary';
import { PreviewViewport } from './components/PreviewViewport';
import { PrinterScreen } from './components/PrinterScreen';

export function App() {
  const theme = useResolvedTheme();
  const lang = usePrefs((s) => s.lang);
  const tab = useApp((s) => s.tab);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const headsOpen = useApp((s) => s.headsOpen);
  const saveAsOpen = useApp((s) => s.saveAsOpen);
  const [dragging, setDragging] = useState(false);
  const { t } = useT();

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    loadProfiles().catch(() => useApp.setState({ engine: { found: false } }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useApp.setState((s) => ({ paletteOpen: !s.paletteOpen }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const models = await filesToModels(e.dataTransfer.files);
    if (models.length) {
      addModels(models);
      useApp.setState({ tab: 'prepare' });
    }
  };

  return (
    <div
      className="app"
      data-theme={theme}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <TopBar />
      {tab === 'printer' ? (
        <div className="body">
          <PrinterScreen />
        </div>
      ) : (
        <div className="body">
          {tab === 'prepare' ? <LeftPanel /> : <PreviewSummary />}
          <main className="center" aria-label={tab === 'prepare' ? t.tabs.prepare : t.tabs.preview}>
            {tab === 'prepare' ? <PrepareViewport /> : <PreviewViewport />}
            {dragging && <div className="drop-overlay">{t.scene.dropHere}</div>}
          </main>
          <SettingsPanel />
        </div>
      )}
      {paletteOpen && <CommandPalette />}
      {headsOpen && <HeadsDialog />}
      {saveAsOpen && <SaveAsDialog />}
    </div>
  );
}
