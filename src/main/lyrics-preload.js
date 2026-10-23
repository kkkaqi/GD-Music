'use strict';
const { contextBridge, ipcRenderer } = require('electron');
function listen(channel, callback) {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
contextBridge.exposeInMainWorld('desktopLyrics', {
  status: () => ipcRenderer.invoke('lyrics:status'),
  configure: settings => ipcRenderer.invoke('lyrics:configure', settings),
  hide: () => ipcRenderer.invoke('lyrics:hide'),
  command: command => ipcRenderer.invoke('lyrics:command', command),
  onFrame: callback => listen('lyrics:frame', callback),
  onSettings: callback => listen('lyrics:settings', callback),
  onHover: callback => listen('lyrics:hover', callback),
  onLayout: callback => listen('lyrics:layout', callback),
  setLockRegion: region => ipcRenderer.send('lyrics:lock-region', region),
  fitContent: measurement => ipcRenderer.send('lyrics:fit-content', measurement),
});
