'use strict';

const {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  ipcMain,
  shell,
  globalShortcut,
  nativeTheme,
  dialog,
  protocol,
  net,
  screen,
  Tray,
  Menu,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const api = require('./api');
const store = require('./store');
const { AudioCache } = require('./audio-cache');
let audioCache;
const { WebsiteApi } = require('./website-api');
let websiteApi;
const { DesktopLyrics } = require('./desktop-lyrics');
const { gestureBounds, EDGES } = require('./window-geometry');
let desktopLyrics;
const { SystemTray } = require('./system-tray');
let systemTray;
let quitPending = false;
let quitReady = false;
let quitTimer;

const APP_NAME = 'GD Music';
const RENDERER_DIST = path.join(__dirname, '..', 'renderer', 'dist');
const DEV_MODE = process.argv.includes('--dev');
const DEV_URL = 'http://localhost:5199';

// 开发辅助：--shot[=home|search|play] 自动截图后退出
const shotArg = process.argv.find((a) => a === '--shot' || a.startsWith('--shot='));
const SHOT_TARGET = shotArg ? (shotArg.includes('=') ? shotArg.split('=')[1] : 'home') : null;

app.setName(APP_NAME);
nativeTheme.themeSource = 'dark';

// 用自定义 scheme 承载打包后的页面：file:// 下 ES module 会被 CORS 拦截
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

/** @type {BrowserWindow | null} */
let win = null;
let windowGesture = null;

function serveRenderer() {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname === 'bundle' && url.pathname.startsWith('/audio-cache/')) return audioCache.serve(request);
      let pathname = decodeURIComponent(url.pathname);
      if (!pathname || pathname === '/') pathname = '/index.html';
      const filePath = path.normalize(path.join(RENDERER_DIST, pathname));
      if (!filePath.startsWith(RENDERER_DIST)) {
        return new Response('forbidden', { status: 403 });
      }
      if (!fs.existsSync(filePath)) {
        return new Response('not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      return new Response('error: ' + err.message, { status: 500 });
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    frame: false,
    resizable: true,
    thickFrame: true,
    backgroundColor: '#07090d',
    title: APP_NAME,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    if (DEV_MODE) win.webContents.openDevTools({ mode: 'detach' });
    if (SHOT_TARGET) captureAndExit(SHOT_TARGET);
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[load-fail]', code, desc, url);
  });
  win.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    if (level === 'warning' || level === 'error') console.error('[renderer]', message, `(${sourceId}:${lineNumber})`);
  });

  if (DEV_MODE) {
    win.loadURL(DEV_URL);
  } else {
    win.loadURL('app://bundle/index.html');
  }

  const emit = () => win && win.webContents.send('win:maximized', win.isMaximized());
  win.on('maximize', emit);
  win.on('unmaximize', emit);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !url.startsWith('http://localhost:5199')) e.preventDefault();
  });

  win.on('closed', () => {
    windowGesture = null;
    desktopLyrics?.destroy();
    win = null;
  });
}

function showMainWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function captureAndExit(target) {
  const wc = win.webContents;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const save = async (name) => {
    // capturePage 偶尔返回上一帧，先抓一帧丢掉再拍
    await wc.capturePage();
    await wait(350);
    const image = await wc.capturePage();
    const out = path.join(app.getAppPath(), name);
    fs.writeFileSync(out, image.toPNG());
    console.log('screenshot saved:', out);
  };

  const fakeSearch = `(() => {
    const el = document.querySelector('#searchInput');
    if (!el) return false;
    el.value = '周杰伦';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`;

  try {
    await wait(3800);

    const scroll = await wc.executeJavaScript(
      `(() => { const c = document.querySelector('.content'); return c ? c.scrollTop : -1; })()`,
      true
    );
    console.log('[shot] content scrollTop =', scroll);

    if (target === 'search' || target === 'play') {
      await wc.executeJavaScript(fakeSearch, true);
      await wait(5500);
      if (target === 'search') {
        await save('preview-search.png');
        return;
      }
      await wc.executeJavaScript(
        `(() => { const r = document.querySelector('.trow'); if (!r) return false; r.click(); return true; })()`,
        true
      );
      await wait(8000);
      await save('preview-play.png');
      const clicked = await wc.executeJavaScript(
        `(() => {
          const b = document.querySelector('.cover-expand');
          if (!b) return 'no-button';
          b.click();
          return 'clicked';
        })()`,
        true
      );
      await wait(2200);
      const state = await wc.executeJavaScript(
        `(() => {
          const el = document.querySelector('.np-page');
          if (!el) return 'no-el';
          const cs = getComputedStyle(el);
          return cs.display + '|' + cs.opacity + '|' + el.className;
        })()`,
        true
      );
      console.log('now-playing click:', clicked, 'state:', state);
      await save('preview-np.png');
      return;
    }

    await save('preview.png');
  } catch (err) {
    console.error('screenshot failed:', err);
  } finally {
    app.quit();
  }
}

/* ------------------------------- IPC ------------------------------- */

const mainSender = event => !!win && event.sender === win.webContents;
function finishQuit() {
  if (quitReady) return;
  clearTimeout(quitTimer);
  quitReady = true;
  store.close();
  app.quit();
}
ipcMain.on('app:ready-quit', event => {
  if (quitPending && mainSender(event)) finishQuit();
});
const lyricsSender = event => mainSender(event) || (!!desktopLyrics?.win && event.sender === desktopLyrics.win.webContents);
ipcMain.handle('lyrics:toggle', event => mainSender(event) ? desktopLyrics.toggle() : null);
ipcMain.handle('lyrics:status', event => lyricsSender(event) ? desktopLyrics.status() : null);
ipcMain.handle('lyrics:configure', (event, data) => lyricsSender(event) ? desktopLyrics.configure(data || {}) : null);
ipcMain.handle('lyrics:hide', event => lyricsSender(event) ? desktopLyrics.hide() : null);
ipcMain.handle('lyrics:command', (event, command) => {
  if (lyricsSender(event) && ['toggle', 'next', 'prev', 'like'].includes(command)) {
    win?.webContents.send('media:command', command);
    return true;
  }
  return false;
});
ipcMain.on('lyrics:update', (event, frame) => { if (mainSender(event) && frame) desktopLyrics?.update(frame); });
ipcMain.on('lyrics:fit-content', (event, measurement) => {
  if (desktopLyrics?.win && event.sender === desktopLyrics.win.webContents) desktopLyrics.fitContent(measurement);
});
ipcMain.on('lyrics:lock-region', (event, region) => {
  if (desktopLyrics?.win && event.sender === desktopLyrics.win.webContents) desktopLyrics.setLockRegion(region);
});

function wrap(fn) {
  return async (_event, payload) => {
    try {
      return { ok: true, data: await fn(payload || {}) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  };
}

ipcMain.handle('api:search', wrap(api.search));
ipcMain.handle('api:url', wrap((params) => audioCache.resolve(params)));
ipcMain.handle('audio:status', wrap(async () => audioCache.status()));
ipcMain.handle('audio:retry', wrap(async () => { audioCache.retry(); return audioCache.status(); }));
ipcMain.handle('audio:folder', wrap(async () => {
  fs.mkdirSync(audioCache.dir, { recursive: true });
  await shell.openPath(audioCache.dir);
  return true;
}));
ipcMain.handle('api:pic', wrap(api.pic));
ipcMain.handle('api:lyric', wrap(api.lyric));
ipcMain.handle('api:quota', wrap(async () => api.quota()));
ipcMain.handle('api:playlist', wrap(api.playlist));

ipcMain.handle('state:load', wrap(async () => store.load()));
ipcMain.handle(
  'state:save',
  wrap(async (state) => {
    store.save(state);
    audioCache.syncFavorites(state.favorites, state.quality);
    return true;
  })
);

ipcMain.handle('win:minimize', () => win && win.minimize());
ipcMain.handle('win:begin-gesture', (event, params = {}) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents || win.isFullScreen()) return false;
  const { mode, edge } = params || {};
  if (mode !== 'move' && (mode !== 'resize' || !EDGES.has(edge))) return false;
  if (mode === 'resize' && win.isMaximized()) return false;
  const cursor = screen.getCursorScreenPoint();
  windowGesture = { mode, edge, bounds: win.getBounds(), contentBounds: win.getContentBounds(), cursor,
    maximized: win.isMaximized() };
  return true;
});
ipcMain.on('win:update-gesture', event => {
  if (!windowGesture || !win || win.isDestroyed() || event.sender !== win.webContents) return;
  const cursor = screen.getCursorScreenPoint(), start = windowGesture;
  const dx = cursor.x - start.cursor.x, dy = cursor.y - start.cursor.y;
  if (start.mode === 'move' && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
  if (start.mode === 'move' && start.maximized) {
    const normal = win.getNormalBounds();
    const ratio = Math.max(0, Math.min(1, (start.cursor.x - start.bounds.x) / start.bounds.width));
    win.unmaximize();
    win.setContentBounds({ ...win.getContentBounds(), x: Math.round(cursor.x - normal.width * ratio),
      y: Math.round(cursor.y - 26) }, false);
    windowGesture = { ...start, maximized: false, bounds: win.getBounds(), contentBounds: win.getContentBounds(), cursor };
    return;
  }
  const bounds = gestureBounds(start.bounds, start.mode, start.edge, dx, dy, win.getMinimumSize());
  if (bounds) {
    // 保持客户区尺寸；Windows 150% 缩放下 setPosition 会反复取整外框，导致宽度逐次增长。
    if (start.mode === 'move') win.setContentBounds({ ...start.contentBounds,
      x: Math.round(start.contentBounds.x + dx), y: Math.round(start.contentBounds.y + dy) }, false);
    else win.setBounds(bounds, false);
  }
});
ipcMain.on('win:end-gesture', event => { if (win && event.sender === win.webContents) windowGesture = null; });
ipcMain.handle('win:toggle-maximize', () => {
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});
ipcMain.handle('win:close', () => win && win.close());
ipcMain.handle('win:is-maximized', () => (win ? win.isMaximized() : false));

ipcMain.handle('app:info', wrap(async () => ({
  name: APP_NAME,
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  userData: app.getPath('userData'),
})));

ipcMain.handle(
  'shell:open',
  wrap(async ({ url }) => {
    if (/^https?:/.test(url)) await shell.openExternal(url);
    return true;
  })
);

ipcMain.handle(
  'shell:show-userdata',
  wrap(async () => {
    await shell.openPath(app.getPath('userData'));
    return true;
  })
);

ipcMain.handle(
  'file:export-text',
  wrap(async ({ name = 'playlist.txt', text = '' }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '导出歌单',
      defaultPath: name,
      filters: [{ name: '文本文件', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, text, 'utf8');
    return { saved: true, filePath };
  })
);

ipcMain.handle(
  'file:export-json',
  wrap(async ({ name = 'playlist.json', data = null }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '导出歌单配置',
      defaultPath: name,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { saved: true, filePath };
  })
);

ipcMain.handle(
  'file:import-json',
  wrap(async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '导入歌单配置',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return { picked: false };
    const raw = fs.readFileSync(filePaths[0], 'utf8');
    try {
      return { picked: true, data: JSON.parse(raw.replace(/^\uFEFF/, '')) };
    } catch {
      throw new Error('文件不是有效的 JSON');
    }
  })
);

ipcMain.handle(
  'file:download-track',
  wrap(async ({ source, id, url_id, br = '320', name = 'track', artist = '' }) => {
    const meta = await audioCache.ensure({ source, id, url_id, br, name });
    const ext = meta.ext;
    const safe = (s) =>
      String(s || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim();
    const base = [safe(artist), safe(name)].filter(Boolean).join(' - ') || 'track';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '下载歌曲',
      defaultPath: `${base}.${ext}`,
      filters: [{ name: '音频文件', extensions: [ext] }],
    });
    if (canceled || !filePath) return { saved: false };
    if (path.resolve(filePath) !== path.resolve(meta.file)) fs.copyFileSync(meta.file, filePath);
    return { saved: true, filePath };
  })
);

/* ------------------------------ 生命周期 ------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);

  app.whenReady().then(() => {
    const userData = app.getPath('userData');
    api.initCache(path.join(userData, 'api-cache'));
    websiteApi = new WebsiteApi({ WebContentsView, session });
    api.setWebsiteRequester(params => websiteApi.request(params));
    // 与实际网页播放器使用相同来源。酷我等 CDN 会拒绝旧域名或 app:// 来源。
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      if (details.webContentsId === win?.webContents.id && details.resourceType === 'media') {
        for (const key of Object.keys(requestHeaders)) if (key.toLowerCase() === 'referer') delete requestHeaders[key];
        requestHeaders.Referer = 'https://music.gdstudio.org/';
      }
      callback({ requestHeaders });
    });
    store.init(userData);
    audioCache = new AudioCache(path.join(userData, 'audio-cache'), api.trackUrl, (url, options) => net.fetch(url, options));
    const saved = store.load();
    audioCache.syncFavorites(saved.favorites, saved.quality);

    serveRenderer();
    createWindow();
    desktopLyrics = new DesktopLyrics({ BrowserWindow, screen,
      file: path.join(userData, 'desktop-lyrics.json'),
      url: DEV_MODE ? DEV_URL + '/desktop-lyrics.html' : 'app://bundle/desktop-lyrics.html',
      onStatus: settings => { if (win && !win.isDestroyed()) win.webContents.send('lyrics:settings', settings); } });
    desktopLyrics.restore();
    systemTray = new SystemTray({ Tray, Menu,
      icon: path.join(__dirname, '..', '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
      onOpen: showMainWindow, onQuit: () => app.quit() });
    systemTray.create();

    const media = {
      MediaPlayPause: 'toggle',
      MediaNextTrack: 'next',
      MediaPreviousTrack: 'prev',
      MediaStop: 'stop',
    };
    for (const [accel, cmd] of Object.entries(media)) {
      try {
        globalShortcut.register(accel, () => {
          if (win && !win.isDestroyed()) win.webContents.send('media:command', cmd);
        });
      } catch {
        /* 媒体键被其他播放器占用时忽略 */
      }
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    store.close();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', event => {
    if (!quitReady && win && !win.isDestroyed()) {
      event.preventDefault();
      if (!quitPending) {
        quitPending = true;
        // 界面先把未去抖落盘的最新状态交回主进程；崩溃或无响应时仍可退出。
        quitTimer = setTimeout(finishQuit, 2000);
        win.webContents.send('app:before-quit');
      }
      return;
    }
    clearTimeout(quitTimer);
    systemTray?.destroy();
    websiteApi?.destroy();
    desktopLyrics?.destroy();
    store.close();
    globalShortcut.unregisterAll();
  });
}
