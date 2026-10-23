const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DesktopLyrics } = require('../src/main/desktop-lyrics');
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-lyrics-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.skipTaskbar = options.skipTaskbar; this.webContents = new EventEmitter(); this.webContents.send = () => {}; this.visible = false; this.destroyed = false; }
    setAlwaysOnTop(...args) { this.top = args; }
    setIgnoreMouseEvents(value) { this.ignore = value; }
    setFocusable(value) { this.focusable = value; this.skipTaskbar = !value; }
    setResizable(value) { this.resizable = value; }
    setSkipTaskbar(value) { this.skipTaskbar = value; }
    loadURL() {}
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    moveTop() { this.raised = true; }
    isVisible() { return this.visible; }
    isDestroyed() { return this.destroyed; }
    getBounds() { return this.options; }
    setBounds(bounds) { this.resizeCalls = (this.resizeCalls || 0) + 1; Object.assign(this.options, bounds); this.emit('resized'); }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const lyrics = new DesktopLyrics({ BrowserWindow: Window,
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }), getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    file: path.join(dir, 'lyrics.json'), url: 'app://bundle/desktop-lyrics.html', onStatus() {}, onCommand() {} });
  t.after(() => lyrics.destroy());
  return lyrics;
}
test('桌面歌词是独立透明窗口，始终置顶且不抢应用焦点', t => {
  const lyrics = setup(t);
  lyrics.toggle();
  assert.equal(lyrics.win.options.transparent, true);
  assert.equal(lyrics.win.options.parent, undefined);
  assert.equal(lyrics.win.options.type, process.platform === 'win32' ? 'toolbar' : undefined);
  assert.deepEqual(lyrics.win.top, [true, 'screen-saver']);
  assert.equal(lyrics.win.visible, true);
  lyrics.raise();
  assert.ok(lyrics.win.raised);
});

test('主进程保留双语歌词快照，后续无翻译时清空旧翻译', t => {
  const lyrics = setup(t);
  lyrics.update({ current: 'First', currentTranslation: '第一句', next: 'Second', nextTranslation: '第二句' });
  assert.equal(lyrics.frame.currentTranslation, '第一句');
  assert.equal(lyrics.frame.nextTranslation, '第二句');
  lyrics.update({ current: '中文原词', next: '' });
  assert.equal(lyrics.frame.currentTranslation, '');
  assert.equal(lyrics.frame.nextTranslation, '');
});

test('字号变大扩大歌词窗口，字号变小收紧，保持在屏幕内', t => {
  const lyrics = setup(t);
  lyrics.show();
  lyrics.configure({ fontSize: 20 });
  lyrics.fitContent({ height: 130, fontSize: 20, width: lyrics.status().layoutWidth });
  lyrics.flushLayout();
  const small = { ...lyrics.win.getBounds() };
  lyrics.configure({ fontSize: 56 });
  lyrics.fitContent({ height: 510, fontSize: 56, width: lyrics.status().layoutWidth });
  lyrics.flushLayout();
  const large = { ...lyrics.win.getBounds() };
  assert.ok(large.width > small.width);
  assert.ok(large.height > small.height);
  assert.equal(large.height, 510, '允许超过原来的400px高度上限');
  assert.ok(large.x + large.width <= 1920 && large.y + large.height <= 1080);
  lyrics.configure({ fontSize: 20 });
  lyrics.fitContent({ height: 130, fontSize: 20, width: lyrics.status().layoutWidth });
  lyrics.flushLayout();
  assert.equal(lyrics.win.getBounds().width, small.width);
  assert.equal(lyrics.win.getBounds().height, small.height);
});

test('锁定时仍按内容改变尺寸，忽略旧字号及旧窗口宽度的测量', t => {
  const lyrics = setup(t);
  lyrics.show();
  lyrics.configure({ locked: true, fontSize: 40 });
  const width = lyrics.status().layoutWidth;
  lyrics.fitContent({ height: 300, fontSize: 40, width });
  lyrics.flushLayout();
  assert.equal(lyrics.win.getBounds().height, 300);
  assert.equal(lyrics.win.resizable, false);
  assert.equal(lyrics.win.ignore, true);
  lyrics.fitContent({ height: 100, fontSize: 20, width });
  lyrics.fitContent({ height: 100, fontSize: 40, width: width - 50 });
  lyrics.fitContent({ height: Infinity, fontSize: 40, width });
  lyrics.flushLayout();
  assert.equal(lyrics.win.getBounds().height, 300);
});

test('连续调字号先合并测量，再一次更新完整宽高，旧测量不能覆盖新字号', t => {
  const lyrics = setup(t);
  lyrics.show();
  const original = { ...lyrics.win.getBounds() };
  for (const fontSize of [20, 30, 40, 50, 56, 40, 30, 20]) {
    lyrics.configure({ fontSize });
    lyrics.fitContent({ width: lyrics.status().layoutWidth, height: 100 + fontSize * 4, fontSize });
  }
  assert.equal(lyrics.win.resizeCalls || 0, 0, '测量完成前不能只改宽度');
  lyrics.flushLayout();
  assert.equal(lyrics.win.resizeCalls, 1);
  assert.equal(lyrics.win.getBounds().height, 180);
  assert.ok(lyrics.win.getBounds().width < original.width);
  const right = lyrics.win.getBounds().x + lyrics.win.getBounds().width;
  assert.equal(right, original.x + original.width);
  lyrics.fitContent({ width: lyrics.status().layoutWidth, height: 181, fontSize: 20 });
  lyrics.flushLayout();
  assert.equal(lyrics.win.resizeCalls, 1, '忽略1px测量抖动');
});
test('锁定穿透后可从主界面重新解锁，隐藏清除置顶轮询', t => {
  const lyrics = setup(t);
  lyrics.toggle();
  lyrics.configure({ locked: true });
  assert.ok(lyrics.win.ignore);
  lyrics.toggle();
  assert.equal(lyrics.win.ignore, false);
  assert.ok(lyrics.status().visible);
  lyrics.hide();
  assert.equal(lyrics.timer, null);
});
test('歌词窗口只保存合法样式值并记住设置', t => {
  const lyrics = setup(t);
  lyrics.configure({ fontSize: 500, opacity: -1, color: '<img>', locked: false });
  assert.equal(lyrics.status().fontSize, 56);
  assert.equal(lyrics.status().opacity, 0);
  assert.equal(lyrics.status().color, '#a8f4ac');
  lyrics.configure({ fontSize: 32, opacity: 0.5, color: '#ffffff' });
  const saved = JSON.parse(fs.readFileSync(lyrics.file, 'utf8'));
  assert.equal(saved.fontSize, 32);
  assert.equal(saved.opacity, 0.5);
  lyrics.configure({ fontSize: 12 });
  assert.equal(lyrics.status().fontSize, 12);
});

test('锁定时仅右上角解锁按钮可点击，歌词区域仍穿透鼠标', t => {
  const lyrics = setup(t);
  lyrics.show();
  const bounds = lyrics.win.getBounds();
  let cursor = { x: bounds.x + bounds.width / 2, y: bounds.y + 120 };
  lyrics.screen.getCursorScreenPoint = () => cursor;
  lyrics.configure({ locked: true });
  lyrics.updatePointer();
  assert.equal(lyrics.win.ignore, true);
  cursor = { x: bounds.x + bounds.width - 85, y: bounds.y + 32 };
  lyrics.updatePointer();
  assert.equal(lyrics.win.ignore, false);
  assert.equal(lyrics.win.focusable, true);
  cursor = { x: bounds.x - 100, y: bounds.y };
  lyrics.updatePointer();
  assert.equal(lyrics.win.ignore, true);
  assert.equal(lyrics.win.focusable, false);
  lyrics.configure({ locked: false });
  assert.equal(lyrics.win.ignore, false);
  assert.ok(lyrics.pointerTimer);
  lyrics.hide();
  assert.equal(lyrics.pointerTimer, null);
});

test('锁定及未锁定均检测歌词区域悬停，离开后隐藏控制', t => {
  const lyrics = setup(t);
  let cursor = { x: -100, y: -100 };
  lyrics.screen.getCursorScreenPoint = () => cursor;
  lyrics.show();
  const bounds = lyrics.win.getBounds();
  assert.equal(lyrics.status().hovered, false);
  cursor = { x: bounds.x + 200, y: bounds.y + 120 };
  lyrics.updatePointer();
  assert.equal(lyrics.status().hovered, true);
  lyrics.configure({ locked: true });
  assert.equal(lyrics.status().hovered, true);
  assert.equal(lyrics.win.ignore, true);
  cursor = { x: bounds.x - 1, y: bounds.y - 1 };
  lyrics.updatePointer();
  assert.equal(lyrics.status().hovered, false);
});

test('解锁热区使用渲染层实际按钮位置', t => {
  const lyrics = setup(t);
  lyrics.show();
  const bounds = lyrics.win.getBounds();
  lyrics.setLockRegion({ x: 200, y: 30, width: 34, height: 36 });
  lyrics.screen.getCursorScreenPoint = () => ({ x: bounds.x + 215, y: bounds.y + 45 });
  lyrics.configure({ locked: true });
  lyrics.updatePointer();
  assert.equal(lyrics.win.ignore, false);
});

test('初次显示、锁定、解锁按钮悬停和再次显示均不产生任务栏窗口', t => {
  const lyrics = setup(t);
  lyrics.show();
  const bounds = lyrics.win.getBounds();
  let cursor = { x: bounds.x + 200, y: bounds.y + 120 };
  lyrics.screen.getCursorScreenPoint = () => cursor;
  assert.equal(lyrics.win.skipTaskbar, true);
  lyrics.configure({ locked: true });
  assert.equal(lyrics.win.skipTaskbar, true);
  cursor = { x: bounds.x + bounds.width - 85, y: bounds.y + 32 };
  lyrics.updatePointer();
  assert.equal(lyrics.win.focusable, true);
  assert.equal(lyrics.win.skipTaskbar, true);
  lyrics.configure({ locked: false });
  assert.equal(lyrics.win.skipTaskbar, true);
  lyrics.hide();
  lyrics.show();
  assert.equal(lyrics.win.skipTaskbar, true);
});
