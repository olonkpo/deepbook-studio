/**
 * electron/menu.js
 * Native application menu for macOS and Windows.
 */

const { Menu, app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');

function buildMenu() {
  // Prevent double-registration errors (e.g. during hot-reload)
  ipcMain.removeHandler('app:getVersion');
  ipcMain.removeHandler('dialog:showSave');
  ipcMain.removeHandler('dialog:showOpen');
  ipcMain.removeHandler('shell:openPath');
  ipcMain.removeAllListeners('window:minimize');
  ipcMain.removeAllListeners('window:maximize');
  ipcMain.removeAllListeners('window:close');

  // ── IPC handlers for preload-exposed functions ──────────────────────────
  ipcMain.handle('app:getVersion', () => app.getVersion());

  ipcMain.on('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
  ipcMain.on('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.on('window:close', () => BrowserWindow.getFocusedWindow()?.close());

  ipcMain.handle('dialog:showSave', (_evt, options) =>
    dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), options),
  );
  ipcMain.handle('dialog:showOpen', (_evt, options) =>
    dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), options),
  );
  ipcMain.handle('shell:openPath', (_evt, filePath) => shell.openPath(filePath));

  // ── Menu template ─────────────────────────────────────────────────────────
  const isMac = process.platform === 'darwin';

  const template = [
    // macOS app menu (shows app name)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),

    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New Book',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToRenderer('menu:newBook'),
        },
        { type: 'separator' },
        {
          label: 'Export Book',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendToRenderer('menu:exportBook'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },

    // Workspace menu
    {
      label: 'Workspace',
      submenu: [
        {
          label: 'New Workspace',
          click: () => sendToRenderer('menu:newWorkspace'),
        },
        {
          label: 'Switch Workspace',
          click: () => sendToRenderer('menu:switchWorkspace'),
        },
        { type: 'separator' },
        {
          label: 'Workspace Settings',
          click: () => sendToRenderer('menu:workspaceSettings'),
        },
      ],
    },

    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'DeepBook Studio Documentation',
          click: () => shell.openExternal('https://github.com/olonkpo/deepbook-studio'),
        },
        { type: 'separator' },
        {
          label: 'Check for Updates',
          click: () => sendToRenderer('menu:checkUpdates'),
        },
        { type: 'separator' },
        {
          label: `Version ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Helper: send an IPC message to the focused renderer window
function sendToRenderer(channel, ...args) {
  BrowserWindow.getFocusedWindow()?.webContents.send(channel, ...args);
}

module.exports = { buildMenu };
