'use strict';

const ORIGIN = 'https://music.gdstudio.org';

// 与官网菜单中的音源统一使用网站当前的请求流程。
// WebContentsView 不挂到任何窗口，因此不会产生任务栏或 Alt+Tab 项。
// 不向远程页面注入 preload、IPC 或 Node 权限。
class WebsiteApi {
  constructor({ WebContentsView, session }) {
    this.WebContentsView = WebContentsView;
    this.session = session;
    this.view = null;
    this.pending = null;
    this.tail = Promise.resolve();
    this.timer = null;
    this.closed = false;
    this.isolated = null;
  }

  async open() {
    if (this.view && !this.view.webContents.isDestroyed()) return;
    const isolated = this.session.fromPartition('gd-website-api');
    if (!this.isolated) {
      this.isolated = isolated;
      isolated.on('will-download', event => event.preventDefault());
    }
    isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      let allowed = false;
      if (url.origin === ORIGIN) {
        if (url.pathname === '/api.php') {
          const pending = this.pending;
          allowed = !!pending && !pending.sent && Object.entries(pending.params)
            .every(([key, value]) => url.searchParams.get(key) === String(value));
          if (allowed) pending.sent = true;
        } else {
          // 页面初始化的搜索、封面、媒体、第三方请求全部阻断；只加载脚本及签名所需时间接口。
          allowed = (details.resourceType === 'mainFrame' && url.pathname === '/') ||
            (details.resourceType === 'script' && url.pathname.startsWith('/js/')) || url.pathname === '/time';
        }
      }
      callback({ cancel: !allowed });
    });
    this.view = new this.WebContentsView({ webPreferences: {
      session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true,
      backgroundThrottling: false,
    } });
    const wc = this.view.webContents;
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', event => event.preventDefault());
    wc.on('will-attach-webview', event => event.preventDefault());
    await this.timeout(wc.loadURL(ORIGIN + '/'), 25000);
  }

  async timeout(task, ms) {
    let timer;
    try {
      return await Promise.race([task, new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(Error('网页版解析超时，请稍后重试')), ms);
      })]);
    } finally { clearTimeout(timer); }
  }

  request(params) {
    const run = async () => {
      if (this.closed) throw Error('网页版解析已关闭');
      clearTimeout(this.timer);
      try {
        await this.open();
        this.pending = { params, sent: false };
        // 仅传递数据；由官网当前脚本生成参数，避免复制易变的网页实现或写死临时音频链接。
        const result = await this.timeout(this.view.webContents.executeJavaScript(`(async () => {
          const params = ${JSON.stringify(params)};
          const value = params.types.startsWith('search') ? params.name : params.id;
          const encoded = encodeURIComponent(String(value)).replace(/[!'()*]/g,
            char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
          const s = crc32(encoded);
          const response = await fetch('/api.php?' + new URLSearchParams({ ...params, s }),
            { signal: AbortSignal.timeout(20000) });
          return { status: response.status, body: await response.text(),
            retryAfter: response.headers.get('retry-after') };
        })()`), 25000);
        return new Response(result.body, { status: result.status,
          headers: result.retryAfter ? { 'Retry-After': result.retryAfter } : {} });
      } catch (err) {
        this.release();
        throw err;
      } finally {
        this.pending = null;
        this.timer = setTimeout(() => this.release(), 30000);
        this.timer.unref?.();
      }
    };
    const task = this.tail.then(run, run);
    this.tail = task.catch(() => {});
    return task;
  }

  release() {
    clearTimeout(this.timer);
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
  }

  destroy() { this.closed = true; this.pending = null; this.release(); }
}

module.exports = { WebsiteApi };
