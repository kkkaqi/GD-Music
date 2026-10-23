const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');
const code = buildSync({
  stdin: { contents: "export * from './store'; export * from './player'; export * from './ui'; export {Api} from './api'; export {initDesktopLyrics} from './desktop-lyrics-sync';", resolveDir: path.resolve(__dirname, '../../src/renderer/src') },
  bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
}).outputFiles[0].text;
const ok = data => ({ ok: true, data });
const track = { id: '1', name: '测试歌曲', source: 'netease', artist: ['歌手'], album: '', pic_id: '', lyric_id: '' };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(api = {}) {
  const timers = new Map();
  let timerId = 0;
  class Audio {
    get src() { return this._src; }
    set src(value) { this._src = value; this.currentTime = 0; this.readyState = 0; }
    constructor() { this.src = ''; this.paused = true; this.currentTime = 0; this.duration = 200; this.readyState = 0; this.listeners = {}; this.plays = 0; }
    addEventListener(event, fn) { (this.listeners[event] ||= []).push(fn); }
    emit(event) { if (event === 'loadedmetadata') this.readyState = 1; for (const fn of this.listeners[event] || []) fn(); }
    play() { this.paused = false; this.plays++; this.emit('play'); return Promise.resolve(); }
    pause() { this.paused = true; this.emit('pause'); }
    removeAttribute() { this.src = ''; this.readyState = 0; }
    load() { this.currentTime = 0; this.readyState = 0; }
  }
  const bridge = {
    api: { url: async () => ok({ url: 'https://example.test/song.mp3' }), lyric: async () => ok({ lyric: '' }), quota: async () => ok(null), search: async () => ok([]), ...api },
    state: { save() {} },
    file: { exportJson: async payload => { structuredClone(payload); return ok({ saved: true }); } },
  };
  const context = { module: { exports: {} }, require, console, Audio, window: { bridge },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); } };
  vm.runInNewContext(code, context);
  return { a: context.module.exports, bridge, timers,
    fire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } } };
}
module.exports = { setup, deferred, ok, track };
