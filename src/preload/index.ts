import { contextBridge, ipcRenderer } from 'electron';
import type { MenuCommand, SepiaApi } from '@shared/types';

const api: SepiaApi = {
  engineInfo: () => ipcRenderer.invoke('engine-info'),
  catalog: () => ipcRenderer.invoke('catalog'),
  resolveProcess: (name) => ipcRenderer.invoke('resolve-process', name),
  resolveMachine: (name, processName) => ipcRenderer.invoke('resolve-machine', name, processName),
  resolveFilament: (name) => ipcRenderer.invoke('resolve-filament', name),
  openModels: () => ipcRenderer.invoke('open-models'),
  slice: (request) => ipcRenderer.invoke('slice', request),
  saveGcode: (gcode, suggestedName) => ipcRenderer.invoke('save-gcode', gcode, suggestedName),
  printerStatus: (host) => ipcRenderer.invoke('printer-status', host),
  printerUpload: (host, gcode, filename, start) => ipcRenderer.invoke('printer-upload', host, gcode, filename, start),
  printerSnapshot: (host) => ipcRenderer.invoke('printer-snapshot', host),
  setNativeTheme: (theme) => ipcRenderer.invoke('set-native-theme', theme),
  projectSave: (data, path, suggestedName) => ipcRenderer.invoke('project-save', data, path, suggestedName),
  projectOpen: () => ipcRenderer.invoke('project-open'),
  ask: (message, detail, buttons) => ipcRenderer.invoke('ask', message, detail, buttons),
  setDocument: (info) => ipcRenderer.invoke('set-document', info),
  onMenu: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, command: MenuCommand) => listener(command);
    ipcRenderer.on('menu', handler);
    return () => ipcRenderer.removeListener('menu', handler);
  },
};

contextBridge.exposeInMainWorld('sepia', api);
