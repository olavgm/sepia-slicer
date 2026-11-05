import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { catalog, findEngine, finishProject, resolve, resolveMachineForUi, resolveProcessForUi, slice } from './orca';
import { snapshot, status, upload } from './printer';
import { buildMenu } from './menu';
import { stepToStl } from './step';
import type { DocumentInfo, OpenedModel, SettingsRequest, SliceRequest } from '@shared/types';

// Tests run with their own data folder so they never touch the user's preferences and profiles.
if (process.env.SEPIA_USER_DATA) app.setPath('userData', process.env.SEPIA_USER_DATA);

/** What the window last told us about its project, to ask before closing with unsaved changes. */
const documents = new WeakMap<BrowserWindow, DocumentInfo>();
let recent: string[] = [];
let menuLang: 'en' | 'es' = app.getLocale().startsWith('es') ? 'es' : 'en';

const MODEL_EXTENSIONS = ['3mf', 'stl', 'obj', 'step', 'stp'];
/** Files asked for before the window was ready to receive them. */
const pendingFiles: string[] = [];
let pageReady = false;

function sendFile(path: string): void {
  const win = BrowserWindow.getAllWindows()[0];
  const ext = extname(path).slice(1).toLowerCase();
  if (!MODEL_EXTENSIONS.includes(ext)) return;
  if (!win || !pageReady) {
    pendingFiles.push(path);
    return;
  }
  try {
    const name = basename(path, extname(path));
    const bytes = new Uint8Array(readFileSync(path));
    if (ext === 'step' || ext === 'stp') {
      modelFromBytes(name, ext, bytes).then((m) => win.webContents.send('open-file', { path, name, ext: m.ext, data: new Uint8Array(m.data) }));
    } else win.webContents.send('open-file', { path, name, ext, data: bytes });
  } catch {
    // The file vanished between the click and now: nothing to open.
  }
}

function rebuildMenu(win: BrowserWindow) {
  buildMenu(win, menuLang, recent, sendFile);
}

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
  rebuildMenu(win);

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

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

/** A model as the renderer reads it. STEP becomes STL here, since only the main process loads OpenCascade. */
async function modelFromBytes(name: string, ext: string, data: Uint8Array): Promise<OpenedModel> {
  if (ext !== 'step' && ext !== 'stp') return { name, ext, data: toArrayBuffer(data) };
  try {
    return { name, ext: 'stl', data: await stepToStl(data) };
  } catch (error) {
    console.error(`Could not convert ${name}.${ext}:`, error);
    return { name, ext, data: new ArrayBuffer(0), error: String(error) };
  }
}

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
    filters: [{ name: '3D models', extensions: ['stl', '3mf', 'obj', 'step', 'stp'] }],
  });
  if (result.canceled) return [];
  const models: OpenedModel[] = [];
  for (const path of result.filePaths) {
    models.push(await modelFromBytes(basename(path, extname(path)), extname(path).slice(1).toLowerCase(), readFileSync(path)));
  }
  return models;
});

// Files dropped on the window arrive as bytes; the renderer sends the ones it cannot read itself (STEP).
ipcMain.handle('convert-model', (_e, name: string, ext: string, data: ArrayBuffer) => modelFromBytes(name, ext, new Uint8Array(data)));

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

ipcMain.handle('project-save', async (event, data: Uint8Array, settings: SettingsRequest, path: string | null, suggestedName: string) => {
  let target = path;
  if (!target) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: suggestedName,
      filters: [{ name: '3MF', extensions: ['3mf'] }],
    });
    if (result.canceled || !result.filePath) return null;
    target = result.filePath;
  }
  writeFileSync(target, await finishProject(data, settings));
  return target;
});

ipcMain.handle('project-open', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [{ name: '3MF', extensions: ['3mf'] }],
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
  if (previous?.lang !== info.lang) {
    menuLang = info.lang;
    rebuildMenu(win);
  }
});

ipcMain.handle('read-file', (_e, path: string) => {
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    return null;
  }
});

ipcMain.handle('set-recent', (event, paths: string[]) => {
  recent = paths;
  if (paths[0]) app.addRecentDocument(paths[0]);
  else app.clearRecentDocuments();
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) rebuildMenu(win);
});

ipcMain.handle('native-edit', (event, command: 'cut' | 'copy' | 'paste' | 'selectAll') => {
  event.sender[command]();
});

ipcMain.on('open-file-ready', () => {
  pageReady = true;
  for (const path of pendingFiles.splice(0)) sendFile(path);
});

// Double-clicking a file in Finder, dropping it on the Dock icon, or "Open with".
app.on('open-file', (event, path) => {
  event.preventDefault();
  sendFile(path);
});
// Windows and Linux pass files on the command line.
for (const arg of process.argv.slice(1)) if (MODEL_EXTENSIONS.includes(extname(arg).slice(1).toLowerCase())) pendingFiles.push(arg);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
