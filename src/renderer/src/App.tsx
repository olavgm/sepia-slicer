import { useEffect, useState } from 'react';
import { useApp } from './state/app';
import { usePrefs } from './state/prefs';
import { useResolvedTheme } from './theme';
import { addModels, arrangeObjects, copySelection, deleteSelection, duplicateSelection, exportGcode, filesToModels, loadProfiles, openModelsDialog, paste, sliceNow } from './actions';
import { clearRecent, newProject, openProject, openProjectFile, projectName, recentProjects, saveProject } from './project';
import { objectsOnPlate } from './state/app';
import { fmt } from './i18n';
import type { MenuCommand } from '@shared/types';
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
import { PanelHandle } from './components/PanelHandle';

export function App() {
  const theme = useResolvedTheme();
  const lang = usePrefs((s) => s.lang);
  const panels = usePrefs((s) => s.panels);
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

  // Window title, the "edited" dot on macOS and the question asked before closing with unsaved changes.
  const dirty = useApp((s) => s.dirty);
  const projectPath = useApp((s) => s.projectPath);
  useEffect(() => {
    const name = projectName(projectPath);
    window.sepia.setDocument({
      title: `${name} — Sepia`,
      dirty,
      path: projectPath,
      lang,
      closePrompt: {
        message: t.project.closeMessage,
        detail: fmt(t.project.closeDetail, { name }),
        close: t.project.closeAnyway,
        cancel: t.actions.cancel,
      },
    });
  }, [dirty, projectPath, lang, t]);

  useEffect(() => window.sepia.onMenu(runMenuCommand), []);

  // Files opened from Finder, the Dock or "Open recent": a 3MF is a project, anything else is added to the plate.
  useEffect(() => {
    window.sepia.setRecent(recentProjects());
    return window.sepia.onOpenFile(async (file) => {
      if (file.ext === '3mf' && useApp.getState().objects.length === 0) await openProjectFile(file.path, file.data);
      else if (file.ext === '3mf') {
        const choice = await window.sepia.ask(fmt(t.project.openOrAdd, { name: file.name }), '', [t.project.addToPlate, t.project.openAsProject]);
        if (choice === 1) await openProjectFile(file.path, file.data);
        else addModels([{ name: file.name, ext: file.ext, data: file.data.slice().buffer }]);
      } else addModels([{ name: file.name, ext: file.ext, data: file.data.slice().buffer }]);
    });
  }, [t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useApp.setState((s) => ({ paletteOpen: !s.paletteOpen }));
        return;
      }
      const s = useApp.getState();
      if (e.key.toLowerCase() === 'a' && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditing() && s.tab === 'prepare' && !s.paletteOpen) {
        arrangeObjects();
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
        <div className="body" data-left={panels.left ? 'open' : 'closed'} data-right={panels.right ? 'open' : 'closed'}>
          {tab === 'prepare' ? <LeftPanel /> : <PreviewSummary />}
          <main className="center" aria-label={tab === 'prepare' ? t.tabs.prepare : t.tabs.preview}>
            {tab === 'prepare' ? <PrepareViewport /> : <PreviewViewport />}
            <PanelHandle side="left" />
            <PanelHandle side="right" />
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

/** True while the user is typing in a field, where shortcuts like ⌘Z belong to the field. */
function isEditing(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

function runMenuCommand(command: MenuCommand): void {
  const s = useApp.getState();
  switch (command) {
    case 'new':
      newProject();
      break;
    case 'open':
      openProject();
      break;
    case 'save':
      saveProject();
      break;
    case 'saveAs':
      saveProject(true);
      break;
    case 'addModel':
      openModelsDialog();
      break;
    case 'exportGcode':
      exportGcode();
      break;
    case 'undo':
      if (isEditing()) document.execCommand('undo');
      else s.undo();
      break;
    case 'redo':
      if (isEditing()) document.execCommand('redo');
      else s.redo();
      break;
    case 'arrange':
      arrangeObjects();
      break;
    case 'delete':
      if (!isEditing()) deleteSelection();
      break;
    case 'cut':
      if (isEditing()) window.sepia.nativeEdit('cut');
      else {
        copySelection();
        deleteSelection();
      }
      break;
    case 'copy':
      if (isEditing()) window.sepia.nativeEdit('copy');
      else copySelection();
      break;
    case 'paste':
      if (isEditing()) window.sepia.nativeEdit('paste');
      else paste();
      break;
    case 'duplicate':
      // Text fields have no "duplicate", so ⌘D always means the objects, even right after typing a value.
      duplicateSelection();
      break;
    case 'selectAll':
      if (isEditing()) window.sepia.nativeEdit('selectAll');
      else s.select(objectsOnPlate(s).map((o) => o.id));
      break;
    case 'clearRecent':
      clearRecent();
      break;
    case 'addPlate':
      s.addPlate();
      break;
    case 'palette':
      useApp.setState({ paletteOpen: !s.paletteOpen });
      break;
    case 'toggleLeft':
      usePrefs.getState().togglePanel('left');
      break;
    case 'toggleRight':
      usePrefs.getState().togglePanel('right');
      break;
    case 'slice':
      sliceNow();
      break;
  }
}

