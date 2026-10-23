'use strict';
const fs = require('node:fs');
const path = require('node:path');

class DesktopLyrics {
  constructor({ BrowserWindow, screen, file, url, onStatus, onCommand }) {
    Object.assign(this, { BrowserWindow, screen, file, url, onStatus, onCommand });
    this.win = null;
    this.timer = null;
    this.pointerTimer = null;
    this.ignoreMouse = null;
    this.focusable = null;
    this.hovered = false;
    this.lockRegion = null;
    this.disposing = false;
    this.pendingLayout = null;
    this.layoutTimer = null;
    this.saveTimer = null;
    this.resizable = null;
    this.layoutAnchor = null;
    this.frame = { current: 'GD Music', next: '播放歌曲后显示歌词', currentTranslation: '', nextTranslation: '', playing: false, liked: false };
    this.prefs = { visible: false, locked: false, fontSize: 32, opacity: 0.48, color: '#a8f4ac', baseWidth: 860 };
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.prefs.visible = data.visible === true;
      this.prefs.bounds = data.bounds;
      this.applyPrefs(data);
      // 保留用户选定的宽度比例，兼容旧版本保存的固定窗口尺寸。
      const base = data.baseWidth || (data.bounds?.width * 32 / this.prefs.fontSize);
      if (Number.isFinite(base)) this.prefs.baseWidth = Math.max(320, Math.min(4096, base));
    } catch {}
  }
  applyPrefs(data) {
    if (typeof data.locked === 'boolean') this.prefs.locked = data.locked;
    if (Number.isFinite(data.fontSize)) this.prefs.fontSize = Math.max(12, Math.min(56, data.fontSize));
    if (Number.isFinite(data.opacity)) this.prefs.opacity = Math.max(0, Math.min(0.85, data.opacity));
    if (/^#[a-f0-9]{6}$/i.test(data.color)) this.prefs.color = data.color;
  }
  status() {
    const { visible, locked, fontSize, opacity, color } = this.prefs;
    return { visible, locked, fontSize, opacity, color, hovered: this.hovered, layoutWidth: this.targetWidth() };
  }
  layoutArea() {
    const reference = this.layoutAnchor || this.prefs.bounds;
    return reference ? this.screen.getDisplayMatching(reference).workArea : this.screen.getPrimaryDisplay().workArea;
  }
  targetWidth() { return Math.round(Math.min(this.layoutArea().width, Math.max(480, this.prefs.baseWidth * this.prefs.fontSize / 32))); }
  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 150);
    this.saveTimer.unref?.();
  }
  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.win && !this.win.isDestroyed()) {
      const { x, y, width, height } = this.win.getBounds();
      this.prefs.bounds = { x, y, width, height };
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.prefs));
      fs.renameSync(this.file + '.tmp', this.file);
    } catch (err) { console.error('[desktop-lyrics] 保存失败:', err.message); }
  }
  bounds() {
    const saved = this.prefs.bounds;
    const valid = saved && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(saved[k]));
    const area = (valid ? this.screen.getDisplayMatching(saved) : this.screen.getPrimaryDisplay()).workArea;
    const width = Math.round(Math.min(area.width, Math.max(480, this.prefs.baseWidth * this.prefs.fontSize / 32)));
    const height = Math.round(Math.min(area.height, Math.max(120, valid ? saved.height : 240)));
    return { width, height,
      x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, valid ? saved.x : area.x + (area.width - width) / 2))),
      y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, valid ? saved.y : area.y + area.height - height - 60))) };
  }
  create() {
    if (this.win && !this.win.isDestroyed()) return;
    this.win = new this.BrowserWindow({ ...this.bounds(), minWidth: 480, minHeight: 120,
      title: 'GD Music 桌面歌词', frame: false, transparent: true, backgroundColor: '#00000000',
      show: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, fullscreenable: false,
      type: process.platform === 'win32' ? 'toolbar' : undefined,
      maximizable: false, minimizable: false,
      webPreferences: { preload: path.join(__dirname, 'lyrics-preload.js'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false } });
    this.ignoreMouse = null;
    this.focusable = null;
    this.lockRegion = null;
    this.layoutAnchor = { ...this.win.getBounds() };
    this.resizable = null;
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    this.win.webContents.on('will-navigate', event => event.preventDefault());
    this.win.webContents.on('did-finish-load', () => this.publish());
    // will-move / will-resize 只来自用户操作，不把程序缩放造成的DPI舍入当成用户改宽度。
    this.win.on('will-move', (_event, bounds) => { this.layoutAnchor = { ...bounds }; });
    this.win.on('will-resize', (_event, bounds) => {
      this.prefs.baseWidth = bounds.width * 32 / this.prefs.fontSize;
      this.layoutAnchor = { ...bounds };
      this.publish();
    });
    this.win.on('moved', () => this.scheduleSave());
    this.win.on('resized', () => {
      this.scheduleSave();
      this.updatePointer();
    });
    this.win.on('blur', () => this.raise());
    this.win.on('closed', () => {
      this.stopTimer();
      this.win = null;
      if (!this.disposing) { this.prefs.visible = false; this.save(); this.notify(); }
    });
    this.win.loadURL(this.url);
  }
  notify() { this.onStatus(this.status()); this.publish(); }
  publish() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('lyrics:settings', this.status());
      this.win.webContents.send('lyrics:frame', this.frame);
    }
  }
  update(frame) {
    // 只接收主播放器生成的短文本快照，不把曲目元数据当 HTML。
    const text = value => String(value || '').slice(0, 2000);
    this.frame = { current: text(frame.current), next: text(frame.next), title: text(frame.title),
      currentTranslation: text(frame.currentTranslation), nextTranslation: text(frame.nextTranslation),
      playing: !!frame.playing, liked: !!frame.liked };
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('lyrics:frame', this.frame);
  }
  raise() {
    if (!this.prefs.visible || !this.win || this.win.isDestroyed()) return;
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.moveTop(); // 不调用 focus，保持飞书等当前应用的输入焦点。
  }
  show() {
    this.create();
    this.prefs.visible = true;
    this.applyLock();
    this.win.showInactive();
    this.win.setSkipTaskbar(true);
    this.raise();
    if (!this.timer) { this.timer = setInterval(() => this.raise(), 1000); this.timer.unref?.(); }
    this.save(); this.notify();
    return this.status();
  }
  toggle() {
    if (!this.prefs.visible) return this.show();
    if (this.prefs.locked) return this.configure({ locked: false });
    return this.hide();
  }
  applyLock() {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.resizable !== !this.prefs.locked) {
      this.resizable = !this.prefs.locked;
      this.win.setResizable(this.resizable);
    }
    if (this.prefs.visible) {
      this.updatePointer();
      if (!this.pointerTimer) {
        this.pointerTimer = setInterval(() => this.updatePointer(), 40);
        this.pointerTimer.unref?.();
      }
    } else {
      this.stopPointerTimer();
      this.setWindowFocusable(!this.prefs.locked);
      this.setMouseIgnored(this.prefs.locked);
    }
  }
  setMouseIgnored(ignore) {
    if (this.ignoreMouse === ignore) return;
    this.ignoreMouse = ignore;
    this.win.setIgnoreMouseEvents(ignore, { forward: true });
  }
  setWindowFocusable(focusable) {
    if (this.focusable === focusable) return;
    this.focusable = focusable;
    this.win.setFocusable(focusable);
    // Windows 的焦点切换会重置任务栏状态，必须在切换后重新隐藏歌词入口。
    this.win.setSkipTaskbar(true);
  }
  setLockRegion(region) {
    if (!region || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(region[k]))) return;
    if (region.width <= 0 || region.width > 100 || region.height <= 0 || region.height > 100) return;
    this.lockRegion = { x: region.x, y: region.y, width: region.width, height: region.height };
    this.updatePointer();
  }
  resizeTo(width, height) {
    if (!this.win || this.win.isDestroyed()) return;
    const previous = this.win.getBounds();
    const anchor = this.layoutAnchor || previous;
    const area = this.layoutArea();
    width = Math.round(Math.min(area.width, Math.max(480, width)));
    height = Math.round(Math.min(area.height, Math.max(120, height)));
    // 工具栏和设置面板靠右，优先保持右边缘，缩放时字号控件不会随着左侧歌词宽度跑开。
    const x = Math.round(Math.max(area.x, Math.min(area.x + area.width - width, anchor.x + anchor.width - width)));
    const y = Math.round(Math.max(area.y, Math.min(area.y + area.height - height, anchor.y)));
    if (Math.abs(previous.width - width) <= 1 && Math.abs(previous.height - height) <= 1 && Math.abs(previous.x - x) <= 1 && Math.abs(previous.y - y) <= 1) return;
    this.win.setBounds({ x, y, width, height }, false);
    this.scheduleSave();
    this.updatePointer();
  }
  fitContent(measurement) {
    if (!this.win || this.win.isDestroyed() || !measurement) return;
    const { height, fontSize, width } = measurement;
    if (![height, fontSize, width].every(Number.isFinite) || height <= 0) return;
    // 页面先按目标宽度离屏排版，再提交完整尺寸；无需先改窗口宽度触发第二轮排版。
    if (fontSize !== this.prefs.fontSize || Math.abs(width - this.targetWidth()) > 1) return;
    this.pendingLayout = { width, height: Math.ceil(height), fontSize };
    if (!this.layoutTimer) this.layoutTimer = setTimeout(() => this.flushLayout(), 50);
  }
  flushLayout() {
    clearTimeout(this.layoutTimer);
    this.layoutTimer = null;
    const target = this.pendingLayout;
    this.pendingLayout = null;
    if (!target || !this.win || this.win.isDestroyed() || target.fontSize !== this.prefs.fontSize || Math.abs(target.width - this.targetWidth()) > 1) return;
    this.resizeTo(target.width, target.height);
    this.win.webContents.send('lyrics:layout', { fontSize: target.fontSize });
  }
  updatePointer() {
    if (!this.win || this.win.isDestroyed() || !this.prefs.visible) return;
    const point = this.screen.getCursorScreenPoint?.();
    const bounds = this.win.getBounds();
    const x = point ? point.x - bounds.x : -1;
    const y = point ? point.y - bounds.y : -1;
    const hovered = x >= 0 && x < bounds.width && y >= 0 && y < bounds.height;
    if (hovered !== this.hovered) {
      this.hovered = hovered;
      this.win.webContents.send('lyrics:hover', hovered);
    }
    // 使用共享按钮的真实 DOM 位置，缩放、窗口宽度变化时也与点击热区一致。
    const region = this.lockRegion || { x: bounds.width - (bounds.width <= 640 ? 85 : 102), y: 14, width: 34, height: 36 };
    const overUnlock = hovered && x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height;
    this.setWindowFocusable(!this.prefs.locked || overUnlock);
    this.setMouseIgnored(this.prefs.locked && !overUnlock);
  }
  stopPointerTimer() {
    if (this.pointerTimer) clearInterval(this.pointerTimer);
    this.pointerTimer = null;
  }
  configure(data) {
    const previousSize = this.prefs.fontSize;
    this.applyPrefs(data);
    this.applyLock();
    if (this.win && this.prefs.fontSize !== previousSize) this.scheduleSave();
    else this.save();
    this.notify();
    return this.status();
  }
  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopPointerTimer();
    clearTimeout(this.layoutTimer);
    this.layoutTimer = null;
    this.pendingLayout = null;
  }
  hide() {
    this.flushLayout();
    this.prefs.visible = false;
    this.stopTimer();
    this.win?.hide();
    this.save(); this.notify();
    return this.status();
  }
  restore() { if (this.prefs.visible) this.show(); }
  destroy() {
    this.disposing = true;
    this.flushLayout();
    this.save(); this.stopTimer();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}
module.exports = { DesktopLyrics };
