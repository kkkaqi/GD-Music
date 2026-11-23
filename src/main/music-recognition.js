'use strict';

const SITE = 'https://aha-music.com';
const PAGE = SITE + '/song-finder';
function siteURL(address) {
  try { return new URL(address).origin === SITE; } catch { return false; }
}
function searchText(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240) : '';
}
function captureAllowed(permission, mediaTypes, mode) {
  if (permission === 'display-capture') return mode === 'computer';
  return permission === 'media' && mediaTypes?.length === 1 && mediaTypes[0] === 'audio';
}

class MusicRecognition {
  constructor({ BrowserWindow, WebContentsView, Menu, desktopCapturer, preload, rendererURL, onSearch }) {
    Object.assign(this, { BrowserWindow, WebContentsView, Menu, desktopCapturer, preload, rendererURL, onSearch });
    this.win = null;
    this.view = null;
    this.mode = 'microphone';
    this.resultTimer = null;
    this.lastResult = '';
  }
  owns(event) {
    return !!this.win && event.sender === this.win.webContents && event.senderFrame === this.win.webContents.mainFrame;
  }
  open(parent) {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      return;
    }
    this.mode = 'microphone';
    const win = this.win = new this.BrowserWindow({
      width: 760, height: 860, minWidth: 620, minHeight: 650, parent,
      title: '听歌识曲 · GD Music', backgroundColor: '#f5f8f7', show: false,
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setMenu(null);
    const view = this.view = new this.WebContentsView({
      webPreferences: {
        partition: 'persist:gd-free-recognition', contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    view.webContents.setAudioMuted(true);
    const trusted = (contents, origin) => contents === view.webContents && siteURL(origin);
    const ses = view.webContents.session;
    ses.setPermissionCheckHandler((contents, permission, origin, details) =>
      trusted(contents, origin) && captureAllowed(permission, [details.mediaType], this.mode));
    ses.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(trusted(contents, details.requestingUrl) && captureAllowed(permission, details.mediaTypes, this.mode));
    });
    ses.setDisplayMediaRequestHandler(async (request, callback) => {
      if (this.mode !== 'computer' || request.frame !== view.webContents.mainFrame || !siteURL(request.securityOrigin)) {
        callback({});
        return;
      }
      try {
        const sources = await this.desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        if (this.view !== view || this.mode !== 'computer' || !sources.length) callback({});
        else callback({ video: sources[0], audio: 'loopback' });
      } catch { callback({}); }
    });
    win.contentView.addChildView(view);
    const resize = () => {
      const [width, height] = win.getContentSize();
      view.setBounds({ x: 0, y: 166, width, height: Math.max(0, height - 268) });
    };
    resize();
    win.on('resize', resize);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.on('will-navigate', (event, address) => {
      if (!siteURL(address)) event.preventDefault();
    });
    view.webContents.on('context-menu', (_event, params) => {
      const query = searchText(params.selectionText);
      if (query) this.Menu.buildFromTemplate([
        { label: '在 GD Music 中搜索选中的歌名', click: () => this.search(query) },
        { role: 'copy', label: '复制' },
      ]).popup({ window: win });
    });
    view.webContents.on('did-finish-load', () => {
      this.configureCapture(view);
      this.readResults(view);
    });
    view.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) this.status('识曲页面加载失败，请点重新加载。');
    });
    view.webContents.on('render-process-gone', () => this.status('识曲页面已关闭，请重新加载。'));
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      clearInterval(this.resultTimer);
      if (!view.webContents.isDestroyed()) view.webContents.close();
      this.win = null;
      this.view = null;
    });
    win.loadURL(this.rendererURL);
    this.load();
  }
  status(message) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('recognition:status', message);
  }
  load() {
    if (!this.view || this.view.webContents.isDestroyed()) return;
    this.status('正在加载免费识曲页面…');
    clearInterval(this.resultTimer);
    this.lastResult = '';
    this.view.webContents.loadURL(PAGE).catch(() => this.status('识曲页面加载失败，请点重新加载。'));
  }
  readResults(view) {
    clearInterval(this.resultTimer);
    let reading = false;
    this.resultTimer = setInterval(async () => {
      if (reading || view !== this.view || view.webContents.isDestroyed() || !siteURL(view.webContents.getURL())) return;
      reading = true;
      try {
        const title = searchText(await view.webContents.executeJavaScript(
          "document.querySelector('.rf-result-title')?.textContent || ''"));
        if (view === this.view && title && title !== this.lastResult) {
          this.lastResult = title;
          this.win.webContents.send('recognition:detected', title);
        }
      } catch {
        // The page may be navigating. The next poll can read the result.
      } finally { reading = false; }
    }, 1200);
    this.resultTimer.unref?.();
  }
  setMode(mode) {
    if (!['microphone', 'computer'].includes(mode)) throw Error('请选择麦克风或电脑声音');
    if (mode === 'computer' && process.platform !== 'win32') throw Error('电脑声音识别目前支持 Windows');
    this.mode = mode;
    this.load();
  }
  async configureCapture(view) {
    if (view !== this.view || view.webContents.isDestroyed() || !siteURL(view.webContents.getURL())) return;
    try {
      if (this.mode === 'computer') {
        await view.webContents.executeJavaScript(`(() => {
          navigator.mediaDevices.getUserMedia = async constraints => {
            if (!constraints?.audio || constraints.video) throw new DOMException('仅支持声音识别', 'NotAllowedError');
            const stream = await navigator.mediaDevices.getDisplayMedia({
              audio: true, video: { width: 1, height: 1, frameRate: 1 }
            });
            stream.getVideoTracks().forEach(track => track.stop());
            if (!stream.getAudioTracks().length) {
              stream.getTracks().forEach(track => track.stop());
              throw new DOMException('没有可用的电脑声音', 'NotFoundError');
            }
            return new MediaStream(stream.getAudioTracks());
          };
        })()`);
      }
      this.status(this.mode === 'computer'
        ? '播放要识别的音乐，然后点网页中的录音按钮。'
        : '点网页中的录音按钮，让麦克风听到要识别的音乐。');
    } catch { this.status('声音来源设置失败，请重新加载。'); }
  }
  search(value) {
    const query = searchText(value);
    if (!query) throw Error('请输入或选中识别出的歌名');
    this.onSearch(query);
    this.destroy();
  }
  destroy() {
    clearInterval(this.resultTimer);
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.view = null;
    this.win = null;
  }
}
module.exports = { MusicRecognition, siteURL, searchText, captureAllowed };
