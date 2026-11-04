import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { catalog, findEngine, resolve, resolveMachineForUi, resolveProcessForUi, slice } from './orca';
import { snapshot, status, upload } from './printer';
import { buildMenu } from './menu';
import type { DocumentInfo, OpenedModel, SliceRequest } from '@shared/types';

// Tests run with their own data folder so they never touch the user's preferences and profiles.
if (process.env.SEPIA_USER_DATA) app.setPath('userData', process.env.SEPIA_USER_DATA);

/** What the window last told us about its project, to ask before closing with unsaved changes. */
const documents = new WeakMap<BrowserWindow, DocumentInfo>();

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Sepia Slicer',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16191E' : '#EEF0F2',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
    },
  });
  buildMenu(win, app.getLocale().startsWith('es') ? 'es' : 'en');

  win.on('close', (event) => {
    const doc = documents.get(win);
    if (!doc?.dirty || process.env.SEPIA_USER_DATA) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      message: doc.closePrompt.message,
      detail: doc.closePrompt.detail,
      buttons: [doc.closePrompt.cancel, doc.closePrompt.close],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 0) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

const toArrayBuffer = (buffer: Buffer): ArrayBuffer => new Uint8Array(buffer).buffer;

ipcMain.handle('engine-info', () => findEngine());
ipcMain.handle('catalog', () => catalog());
ipcMain.handle('resolve-process', (_e, name: string) => resolveProcessForUi(name));
ipcMain.handle('resolve-machine', (_e, name: string, processName: string) => resolveMachineForUi(name, processName));
ipcMain.handle('resolve-filament', (_e, name: string) => resolve('filament', name));
ipcMain.handle('slice', (_e, request: SliceRequest) => slice(request));
ipcMain.handle('printer-status', (_e, host: string) => status(host));
ipcMain.handle('printer-snapshot', (_e, host: string) => snapshot(host));
ipcMain.handle('printer-upload', (_e, host: string, gcode: string, filename: string, start: boolean) => upload(host, gcode, filename, start));
ipcMain.handle('set-native-theme', (_e, theme: 'system' | 'light' | 'dark') => {
  nativeTheme.themeSource = theme;
});

ipcMain.handle('open-models', async (event): Promise<OpenedModel[]> => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '3D models', extensions: ['stl', '3mf'] }],
  });
  if (result.canceled) return [];
  return result.filePaths.map((path) => ({
    name: basename(path, extname(path)),
    ext: extname(path).slice(1).toLowerCase(),
    data: toArrayBuffer(readFileSync(path)),
  }));
});

ipcMain.handle('save-gcode', async (event, gcode: string, suggestedName: string) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win!, {
    defaultPath: suggestedName,
    filters: [{ name: 'G-code', extensions: ['gcode'] }],
  });
  if (result.canceled || !result.filePath) return null;
  writeFileSync(result.filePath, gcode);
  return result.filePath;
});

ipcMain.handle('project-save', async (event, data: Uint8Array, path: string | null, suggestedName: string) => {
  let target = path;
  if (!target) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: suggestedName,
      filters: [{ name: 'Sepia', extensions: ['sepia'] }],
    });
    if (result.canceled || !result.filePath) return null;
    target = result.filePath;
  }
  writeFileSync(target, data);
  return target;
});

ipcMain.handle('project-open', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [{ name: 'Sepia', extensions: ['sepia'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const path = result.filePaths[0];
  return { path, data: new Uint8Array(readFileSync(path)) };
});

ipcMain.handle('ask', async (event, message: string, detail: string, buttons: string[]) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showMessageBox(win!, { type: 'question', message, detail, buttons, defaultId: 0, cancelId: 0 });
  return result.response;
});

ipcMain.handle('set-document', (event, info: DocumentInfo) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const previous = documents.get(win);
  documents.set(win, info);
  win.setTitle(info.title);
  if (process.platform === 'darwin') {
    win.setDocumentEdited(info.dirty);
    win.setRepresentedFilename(info.path ?? '');
  }
  if (previous?.lang !== info.lang) buildMenu(win, info.lang);
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
