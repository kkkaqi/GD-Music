'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** 极简 JSON 状态存储：原子写入 + 去抖动，避免频繁落盘 */

const DEFAULTS = {
  version: 1,
  quality: '320',
  volume: 0.75,
  mode: 'order', // order | single | shuffle
  source: 'netease',
  favorites: [],
  recent: [],
  playlists: [],
  queue: [],
  queueIndex: 0,
  lastTrack: null,
  lastTime: 0,
  showTranslation: true,
};

let file = null;
let timer = null;
let pending = null;

function init(dir) {
  file = path.join(dir, 'state.json');
}

function load() {
  if (!file) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

function flush() {
  if (!pending || !file) return;
  const data = pending;
  pending = null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('[store] 写入失败', err.message);
  }
}

function save(state) {
  pending = state;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

function close() {
  if (timer) clearTimeout(timer);
  timer = null;
  flush();
}

module.exports = { init, load, save, close, DEFAULTS };
