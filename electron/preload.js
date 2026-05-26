/**
 * electron/preload.js
 * Security bridge between the renderer (frontend) and the main process.
 * contextBridge exposes only what the frontend actually needs.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // App information
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => process.platform,

  // Window controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  // File system (open save dialog for exports)
  showSaveDialog: options => ipcRenderer.invoke('dialog:showSave', options),
  showOpenDialog: options => ipcRenderer.invoke('dialog:showOpen', options),

  // Open a path in the OS file explorer
  openInExplorer: filePath => ipcRenderer.invoke('shell:openPath', filePath),

  // Listen for menu events dispatched from main process
  onMenuEvent: (event, callback) => {
    ipcRenderer.on(`menu:${event}`, (_evt, ...args) => callback(...args));
    // Return cleanup function
    return () => ipcRenderer.removeAllListeners(`menu:${event}`);
  },
});
