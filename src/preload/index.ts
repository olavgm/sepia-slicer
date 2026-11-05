import { contextBridge, ipcRenderer } from 'electron';
import type { MenuCommand, SepiaApi } from '@shared/types';

const api: SepiaApi = {
  engineInfo: () => ipcRenderer.invoke('engine-info'),
  catalog: () => ipcRenderer.invoke('catalog'),
  resolveProcess: (name) => ipcRenderer.invoke('resolve-process', name),
  resolveMachine: (name, processName) => ipcRenderer.invoke('resolve-machine', name, processName),
  resolveFilament: (name) => ipcRenderer.invoke('resolve-filament', name),
  openModels: () => ipcRenderer.invoke('open-models'),
  convertModel: (name, ext, data) => ipcRenderer.invoke('convert-model', name, ext, data),
  slice: (request) => ipcRenderer.invoke('slice', request),
  saveGcode: (gcode, suggestedName) => ipcRenderer.invoke('save-gcode', gcode, suggestedName),
  printerStatus: (host) => ipcRenderer.invoke('printer-status', host),
  printerUpload: (host, gcode, filename, start) => ipcRenderer.invoke('printer-upload', host, gcode, filename, start),
  printerSnapshot: (host) => ipcRenderer.invoke('printer-snapshot', host),
  setNativeTheme: (theme) => ipcRenderer.invoke('set-native-theme', theme),
  projectSave: (data, settings, path, suggestedName) => ipcRenderer.invoke('project-save', data, settings, path, suggestedName),
  projectOpen: () => ipcRenderer.invoke('project-open'),
  ask: (message, detail, buttons) => ipcRenderer.invoke('ask', message, detail, buttons),
  setDocument: (info) => ipcRenderer.invoke('set-document', info),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  setRecent: (paths) => ipcRenderer.invoke('set-recent', paths),
  nativeEdit: (command) => ipcRenderer.invoke('native-edit', command),
  onOpenFile: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, file: { path: string; name: string; ext: string; data: Uint8Array }) => listener(file);
    ipcRenderer.on('open-file', handler);
    // Tell the main process the page is listening, so files opened before it loaded can be delivered.
    ipcRenderer.send('open-file-ready');
    return () => ipcRenderer.removeListener('open-file', handler);
  },
  onMenu: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, command: MenuCommand) => listener(command);
    ipcRenderer.on('menu', handler);
    return () => ipcRenderer.removeListener('menu', handler);
  },
};

contextBridge.exposeInMainWorld('sepia', api);
