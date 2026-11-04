import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { catalog, findEngine, resolve, resolveMachineForUi, resolveProcessForUi, slice } from './orca';
import { status, upload } from './printer';
import type { OpenedModel, SliceRequest } from '@shared/types';

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
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

ipcMain.handle('engine-info', () => findEngine());
ipcMain.handle('catalog', () => catalog());
ipcMain.handle('resolve-process', (_e, name: string) => resolveProcessForUi(name));
ipcMain.handle('resolve-machine', (_e, name: string, processName: string) => resolveMachineForUi(name, processName));
ipcMain.handle('resolve-filament', (_e, name: string) => resolve('filament', name));
ipcMain.handle('slice', (_e, request: SliceRequest) => slice(request));
ipcMain.handle('printer-status', (_e, host: string) => status(host));
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
  return result.filePaths.map((path) => {
    const buffer = readFileSync(path);
    return {
      name: basename(path, extname(path)),
      ext: extname(path).slice(1).toLowerCase(),
      data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    };
  });
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
