import { contextBridge, ipcRenderer } from 'electron';
import type { SepiaApi } from '@shared/types';

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
  setNativeTheme: (theme) => ipcRenderer.invoke('set-native-theme', theme),
};

contextBridge.exposeInMainWorld('sepia', api);
