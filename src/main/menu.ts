// The app's native menu bar. Commands go to the window, which decides what to do with them.
import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import type { Lang } from '@shared/settings-types';
import type { MenuCommand } from '@shared/types';

const LABELS: Record<Lang, Record<string, string>> = {
  en: {
    file: 'File',
    new: 'New project',
    open: 'Open…',
    save: 'Save',
    saveAs: 'Save as…',
    addModel: 'Add model…',
    openRecent: 'Open recent',
    clearRecent: 'Clear the list',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    duplicate: 'Duplicate',
    selectAll: 'Select all',
    addPlate: 'New plate',
    exportGcode: 'Export G-code…',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    arrange: 'Arrange objects',
    delete: 'Delete object',
    view: 'View',
    palette: 'Search…',
    toggleLeft: 'Show or hide the left panel',
    toggleRight: 'Show or hide the settings',
    slice: 'Slice plate',
    window: 'Window',
  },
  es: {
    file: 'Archivo',
    new: 'Proyecto nuevo',
    open: 'Abrir…',
    save: 'Guardar',
    saveAs: 'Guardar como…',
    addModel: 'Añadir modelo…',
    openRecent: 'Abrir reciente',
    clearRecent: 'Borrar la lista',
    cut: 'Cortar',
    copy: 'Copiar',
    paste: 'Pegar',
    duplicate: 'Duplicar',
    selectAll: 'Seleccionar todo',
    addPlate: 'Placa nueva',
    exportGcode: 'Exportar G-code…',
    edit: 'Edición',
    undo: 'Deshacer',
    redo: 'Rehacer',
    arrange: 'Colocar objetos',
    delete: 'Borrar objeto',
    view: 'Visualización',
    palette: 'Buscar…',
    toggleLeft: 'Mostrar u ocultar el panel izquierdo',
    toggleRight: 'Mostrar u ocultar los ajustes',
    slice: 'Laminar placa',
    window: 'Ventana',
  },
};

export function buildMenu(win: BrowserWindow, lang: Lang, recent: string[], openRecent: (path: string) => void): void {
  const l = LABELS[lang];
  const send = (command: MenuCommand) => () => win.webContents.send('menu', command);
  // Shortcuts the page handles itself are shown in the menu but not registered, so they keep reaching the page.
  const shown = (accelerator: string) => ({ accelerator, registerAccelerator: false });

  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: l.file,
      submenu: [
        { label: l.new, accelerator: 'CmdOrCtrl+N', click: send('new') },
        { label: l.open, accelerator: 'CmdOrCtrl+O', click: send('open') },
        {
          label: l.openRecent,
          enabled: recent.length > 0,
          submenu: [
            ...recent.map((path) => ({ label: path.split(/[\\/]/).pop()!, toolTip: path, click: () => openRecent(path) })),
            { type: 'separator' as const },
            { label: l.clearRecent, click: send('clearRecent') },
          ],
        },
        { type: 'separator' },
        { label: l.save, accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: l.saveAs, accelerator: 'Shift+CmdOrCtrl+S', click: send('saveAs') },
        { type: 'separator' },
        { label: l.addModel, accelerator: 'CmdOrCtrl+I', click: send('addModel') },
        { label: l.addPlate, accelerator: 'Shift+CmdOrCtrl+N', click: send('addPlate') },
        { label: l.exportGcode, accelerator: 'CmdOrCtrl+E', click: send('exportGcode') },
        ...(process.platform === 'darwin' ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    {
      label: l.edit,
      submenu: [
        { label: l.undo, accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: l.redo, accelerator: 'Shift+CmdOrCtrl+Z', click: send('redo') },
        { type: 'separator' },
        // Text fields get the native commands; elsewhere they act on the selected objects.
        { label: l.cut, accelerator: 'CmdOrCtrl+X', click: send('cut') },
        { label: l.copy, accelerator: 'CmdOrCtrl+C', click: send('copy') },
        { label: l.paste, accelerator: 'CmdOrCtrl+V', click: send('paste') },
        { label: l.duplicate, accelerator: 'CmdOrCtrl+D', click: send('duplicate') },
        { label: l.selectAll, accelerator: 'CmdOrCtrl+A', click: send('selectAll') },
        { type: 'separator' },
        { label: l.arrange, ...shown('A'), click: send('arrange') },
        { label: l.delete, ...shown('Backspace'), click: send('delete') },
      ],
    },
    {
      label: l.view,
      submenu: [
        { label: l.palette, ...shown('CmdOrCtrl+K'), click: send('palette') },
        { type: 'separator' },
        { label: l.toggleLeft, accelerator: 'CmdOrCtrl+Alt+Left', click: send('toggleLeft') },
        { label: l.toggleRight, accelerator: 'CmdOrCtrl+Alt+Right', click: send('toggleRight') },
        { type: 'separator' },
        { label: l.slice, accelerator: 'CmdOrCtrl+R', click: send('slice') },
        ...(app.isPackaged ? [] : [{ type: 'separator' as const }, { role: 'toggleDevTools' as const }]),
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: l.window, role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
