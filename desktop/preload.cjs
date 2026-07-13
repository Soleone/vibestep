const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('beatFiendCompanion', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  onStatus: (callback) => ipcRenderer.on('companion-status', (_event, status) => callback(status)),
  openApp: () => ipcRenderer.invoke('open-app'),
  pair: () => ipcRenderer.invoke('pair'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  quit: () => ipcRenderer.invoke('quit'),
})
