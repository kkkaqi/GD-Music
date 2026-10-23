'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { retryAfterMs } = require('./request-gate');
const { audioExtension, AUDIO_EXTENSIONS } = require('./audio-format');
const musicSources = require('../shared/music-sources.json');
const canDownload = source => musicSources.find(s => s.value === source)?.download !== false;

// 完整文件才发布；按音源、歌曲、请求音质隔离，重启后无需在线解析地址。
class AudioCache {
  constructor(dir, resolver, fetcher = fetch) {
    this.dir = dir;
    this.resolver = resolver;
    this.fetcher = fetcher;
    this.inflight = new Map();
    this.wanted = new Map();
    this.failures = new Map();
    this.worker = null;
    this.active = '';
    this.now = Date.now;
    this.sleep = ms => new Promise(r => setTimeout(r, ms));
    this.retries = new Map();
    this.nextAttemptAt = 0;
    this.pauseUntil = 0;
    this.waitUntil = 0;
    this.waitReason = '';
    this.streamOnly = 0;
    this.inactivityTimeoutMs = 120000;
  }
  key(p) {
    return crypto.createHash('sha256').update(JSON.stringify([p.source || 'netease', String(p.id), String(p.br || '320')])).digest('hex');
  }
  read(key) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(this.dir, key + '.json'), 'utf8'));
      const ext = AUDIO_EXTENSIONS.has(meta.ext) ? meta.ext : 'audio';
      const file = path.join(this.dir, key + '.' + ext);
      if (!meta.size || fs.statSync(file).size !== meta.size) return null;
      // 兼容之前被服务器错误 MIME 标成 MP3 的无损缓存，无需重新下载。
      if (ext === 'mp3' && Number(meta.br) > 320) {
        const prefix = Buffer.alloc(4);
        const fd = fs.openSync(file, 'r');
        try { fs.readSync(fd, prefix, 0, 4, 0); } finally { fs.closeSync(fd); }
        if (audioExtension('', meta.type, ext, prefix) === 'flac') {
          meta.ext = 'flac'; meta.type = 'audio/flac';
        }
      }
      return { ...meta, file, url: `app://bundle/audio-cache/${key}`, cached: true };
    } catch { return null; }
  }
  lookup(p) { return this.read(this.key(p)); }
  async resolve(p) { return this.lookup(p) || this.resolver(p); }
  ensure(p) {
    if (!canDownload(p.source)) return Promise.reject(Error('Embeat 仅支持在线播放，不提供音频下载'));
    const key = this.key(p);
    const found = this.lookup(p);
    if (found) return Promise.resolve(found);
    if (this.inflight.has(key)) return this.inflight.get(key);
    const task = this.download(p, key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }
  async download(p, key) {
    const meta = await this.resolver(p, { background: true, onWait: ms => {
      this.waitUntil = ms ? this.now() + ms : 0;
      this.waitReason = ms ? '等待请求额度，稍后自动继续' : '';
    } });
    if (!meta?.url || !/^https?:\/\//i.test(meta.url)) throw Error('暂无可用音源');
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = path.join(this.dir, key + '.part');
    const metaFile = path.join(this.dir, key + '.json');
    const controller = new AbortController();
    // 只在持续无数据时超时；大体积无损或较慢连接仍可继续流式下载。
    const timeout = setTimeout(() => controller.abort(new DOMException('音频下载长时间没有进度，请稍后重试', 'TimeoutError')),
      this.inactivityTimeoutMs);
    try {
      const res = await this.fetcher(meta.url, {
        signal: controller.signal,
        headers: { ...(new URL(meta.url).protocol === 'https:' ? { Referer: 'https://music.gdstudio.org/' } : {}), 'User-Agent': 'Mozilla/5.0',
          Range: 'bytes=0-' },
      }).catch(err => { throw Object.assign(err, { retryable: true }); });
      timeout.refresh();
      const type = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0];
      if (!res.ok || !res.body || /text|json|xml/i.test(type)) {
        throw Object.assign(Error(`音频下载失败（HTTP ${res.status}）`), {
          status: res.status, retryable: res.status === 429 || res.status >= 500,
          retryAfterMs: Math.max(retryAfterMs(res.headers.get('retry-after'), this.now()), res.status === 429 ? 300000 : 0),
        });
      }
      let expectedSize = Number(res.headers.get('content-length')) || 0;
      if (res.status === 206) {
        const range = /^bytes 0-(\d+)\/(\d+)$/.exec(res.headers.get('content-range') || '');
        if (!range || Number(range[1]) + 1 !== Number(range[2])) {
          await res.body.cancel().catch(() => {});
          throw Object.assign(Error('音频服务器未返回完整文件，请稍后重试'), { retryable: true });
        }
        expectedSize = Number(range[2]);
      }
      let size = 0;
      let prefix = Buffer.alloc(0);
      const limiter = new Transform({ transform(chunk, enc, cb) {
        timeout.refresh();
        if (prefix.length < 4) prefix = Buffer.concat([prefix, chunk.subarray(0, 4 - prefix.length)]);
        size += chunk.length;
        cb(null, chunk);
      } });
      try { await pipeline(Readable.fromWeb(res.body), limiter, fs.createWriteStream(tmp)); }
      catch (err) {
        if (['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(err.code || err.cause?.code) ||
          ['AbortError', 'TimeoutError'].includes(err.name)) err.retryable = true;
        throw err;
      }
      if (!size) throw Error('音频文件为空');
      if (expectedSize && size !== expectedSize) throw Object.assign(Error('音频文件下载不完整，请稍后重试'), { retryable: true });
      const ext = audioExtension(meta.url, type, 'audio', prefix);
      fs.renameSync(tmp, path.join(this.dir, key + '.' + ext));
      fs.writeFileSync(metaFile + '.part', JSON.stringify({ size, type: ext === 'flac' ? 'audio/flac' : type,
        ext, name: p.name, br: meta.br || p.br, source: p.source, id: p.id }));
      fs.renameSync(metaFile + '.part', metaFile);
      return this.lookup(p);
    } finally {
      clearTimeout(timeout);
      for (const partial of [tmp, metaFile + '.part']) {
        try { fs.unlinkSync(partial); } catch {}
      }
    }
  }
  syncFavorites(tracks, br = '320') {
    const valid = (Array.isArray(tracks) ? tracks : []).filter(t => t && t.id != null);
    this.streamOnly = valid.filter(t => !canDownload(t.source)).length;
    this.wanted = new Map(valid.filter(t => canDownload(t.source)).map(t => {
      const p = { source: t.source || 'netease', id: String(t.id), url_id: t.url_id, br, name: t.name };
      return [this.key(p), p];
    }));
    this.start();
  }
  start() {
    if (this.worker) return;
    this.worker = this.run().finally(() => {
      this.worker = null;
      if ([...this.wanted].some(([key, p]) => !this.failures.has(key) && !this.lookup(p))) this.start();
    });
  }
  async run() {
    for (;;) {
      const jobs = [...this.wanted].filter(([key, p]) => !this.failures.has(key) && !this.lookup(p));
      if (!jobs.length) break;
      const now = this.now();
      const earliest = Math.min(...jobs.map(([key]) => this.retries.get(key)?.nextAt || 0));
      const waitUntil = Math.max(this.nextAttemptAt, this.pauseUntil, earliest);
      if (waitUntil > now) {
        this.waitUntil = waitUntil;
        this.waitReason = this.pauseUntil > now ? '服务器繁忙或限流，等待后自动重试' : '慢速下载排队中';
        await this.sleep(Math.min(waitUntil - now, 1000));
        continue;
      }
      const job = jobs.filter(([key]) => (this.retries.get(key)?.nextAt || 0) <= now)
        .sort(([a], [b]) => (this.retries.get(a)?.attempts || 0) - (this.retries.get(b)?.attempts || 0))[0];
      const [key, p] = job;
      this.active = p.name || p.id;
      this.waitUntil = 0;
      this.waitReason = '';
      this.nextAttemptAt = now + 8000;
      try {
        await this.ensure(p);
        this.retries.delete(key);
      } catch (err) {
        if (err.retryable || err.status === 429 || (err.status >= 500 && err.status < 600)) {
          const attempts = (this.retries.get(key)?.attempts || 0) + 1;
          const delay = Math.max(err.retryAfterMs || 0, Math.min(300000, 30000 * 2 ** Math.min(attempts - 1, 4)));
          this.pauseUntil = this.now() + delay;
          this.retries.set(key, { attempts, nextAt: this.pauseUntil, message: err.message });
        } else this.failures.set(key, err.message);
      }
      this.nextAttemptAt = Math.max(this.nextAttemptAt, this.now() + 8000);
      this.active = '';
    }
    this.waitUntil = 0;
    this.waitReason = '';
  }
  async idle() { await this.worker; }
  retry() { this.failures.clear(); this.start(); }
  status() {
    let ready = 0, failed = 0, retrying = 0;
    for (const [key, p] of this.wanted) {
      if (this.lookup(p)) ready++;
      else if (this.failures.has(key)) failed++;
      else if (this.retries.has(key)) retrying++;
    }
    return { total: this.wanted.size, ready, failed, retrying, streamOnly: this.streamOnly, active: this.active, directory: this.dir,
      waitSeconds: Math.max(0, Math.ceil((this.waitUntil - this.now()) / 1000)), waitReason: this.waitReason };
  }
  async serve(request) {
    const key = new URL(request.url).pathname.split('/').pop();
    if (!/^[a-f0-9]{64}$/.test(key)) return new Response('Not found', { status: 404 });
    const meta = this.read(key);
    if (!meta) return new Response('Not found', { status: 404 });
    let start = 0, end = meta.size - 1;
    const range = request.headers.get('range');
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2])) return new Response(null, { status: 416 });
      if (!m[1]) start = Math.max(0, meta.size - Number(m[2]));
      else { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), end); }
      if (start > end || start >= meta.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${meta.size}` } });
    }
    const headers = { 'Content-Type': meta.type, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${meta.size}`;
    return new Response(request.method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(meta.file, { start, end })), { status: range ? 206 : 200, headers });
  }
}
module.exports = { AudioCache };
