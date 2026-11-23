'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('recognition', {
  mode: value => ipcRenderer.invoke('recognition:mode', value),
  reload: () => ipcRenderer.invoke('recognition:reload'),
  search: query => ipcRenderer.invoke('recognition:search', query),
  onDetected: callback => {
    const handler = (_event, title) => callback(title);
    ipcRenderer.on('recognition:detected', handler);
    return () => ipcRenderer.removeListener('recognition:detected', handler);
  },
  onStatus: callback => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on('recognition:status', handler);
    return () => ipcRenderer.removeListener('recognition:status', handler);
  },
});
