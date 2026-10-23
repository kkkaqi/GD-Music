'use strict';
const fs = require('node:fs');
const path = require('node:path');
const WINDOW_MS = 300000;
const MAX = 48;
const BACKGROUND_MAX = 36;
const GAP_MS = 6500;

// 所有真实 API 请求共享时间窗；后台留出额度给播放和搜索。
class RequestGate {
  constructor({ now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    this.now = now;
    this.sleep = sleep;
    this.stamps = [];
    this.cooldownUntil = 0;
    this.file = null;
  }
  init(file) {
    this.file = file;
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.stamps = (saved.stamps || []).filter(t => Number.isFinite(t) && t <= this.now() && t > this.now() - WINDOW_MS).sort((a, b) => a - b);
      this.cooldownUntil = Number.isFinite(saved.cooldownUntil) ? saved.cooldownUntil : 0;
    } catch {}
  }
  save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify({ stamps: this.stamps, cooldownUntil: this.cooldownUntil }));
      fs.renameSync(this.file + '.tmp', this.file);
    } catch {}
  }
  trim() {
    const now = this.now();
    while (this.stamps.length && now - this.stamps[0] >= WINDOW_MS) this.stamps.shift();
  }
  waitMs(background = false) {
    this.trim();
    const now = this.now();
    const max = background ? BACKGROUND_MAX : MAX;
    const budgetWait = this.stamps.length >= max ? this.stamps[this.stamps.length - max] + WINDOW_MS + 80 - now : 0;
    const gapWait = this.stamps.length ? this.stamps.at(-1) + GAP_MS - now : 0;
    return Math.max(0, budgetWait, gapWait, this.cooldownUntil - now);
  }
  async acquire({ background = false, onWait = () => {} } = {}) {
    for (;;) {
      const wait = this.waitMs(background);
      if (!wait) {
        this.stamps.push(this.now());
        this.save();
        onWait(0);
        return;
      }
      onWait(wait);
      await this.sleep(Math.min(wait, 1000));
    }
  }
  defer(ms) {
    this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + ms);
    this.save();
  }
}

function retryAfterMs(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

module.exports = { RequestGate, retryAfterMs };
