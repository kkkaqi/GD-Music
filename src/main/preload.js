'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** 渲染进程唯一可用的桥：全部走 IPC，不暴露 Node 能力 */

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('bridge', {
  lyrics: {
    toggle: () => invoke('lyrics:toggle'),
    status: () => invoke('lyrics:status'),
    update: frame => ipcRenderer.send('lyrics:update', frame),
    onSettings: callback => {
      const handler = (_event, settings) => callback(settings);
      ipcRenderer.on('lyrics:settings', handler);
      return () => ipcRenderer.removeListener('lyrics:settings', handler);
    },
  },
  audio: {
    status: () => invoke('audio:status'),
    retry: () => invoke('audio:retry'),
    folder: () => invoke('audio:folder'),
  },
  api: {
    search: (params) => invoke('api:search', params),
    url: (params) => invoke('api:url', params),
    pic: (params) => invoke('api:pic', params),
    lyric: (params) => invoke('api:lyric', params),
    quota: () => invoke('api:quota'),
    playlist: (params) => invoke('api:playlist', params),
  },
  state: {
    load: () => invoke('state:load'),
    save: (state) => invoke('state:save', state),
  },
  win: {
    beginGesture: params => invoke('win:begin-gesture', params),
    updateGesture: () => ipcRenderer.send('win:update-gesture'),
    endGesture: () => ipcRenderer.send('win:end-gesture'),
    minimize: () => invoke('win:minimize'),
    toggleMaximize: () => invoke('win:toggle-maximize'),
    close: () => invoke('win:close'),
    isMaximized: () => invoke('win:is-maximized'),
    onMaximized: (cb) => {
      const handler = (_e, value) => cb(value);
      ipcRenderer.on('win:maximized', handler);
      return () => ipcRenderer.removeListener('win:maximized', handler);
    },
  },
  media: {
    onCommand: (cb) => {
      ipcRenderer.on('media:command', (_e, cmd) => cb(cmd));
    },
  },
  app: {
    onBeforeQuit: callback => {
      const handler = async () => {
        try { await callback(); }
        finally { ipcRenderer.send('app:ready-quit'); }
      };
      ipcRenderer.on('app:before-quit', handler);
      return () => ipcRenderer.removeListener('app:before-quit', handler);
    },
    info: () => invoke('app:info'),
    openExternal: (url) => invoke('shell:open', { url }),
    showUserData: () => invoke('shell:show-userdata'),
  },
  file: {
    exportText: (payload) => invoke('file:export-text', payload),
    exportJson: (payload) => invoke('file:export-json', payload),
    importJson: () => invoke('file:import-json'),
    downloadTrack: (payload) => invoke('file:download-track', payload),
  },
});
