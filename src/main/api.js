'use strict';

/**
 * GD 音乐台 API 客户端（主进程）
 * 文档：https://music-api.gdstudio.xyz
 * 许可：CC BY-NC 4.0 —— 仅供学习，禁止商用
 *
 * 职责：
 *  1. 统一发起请求（渲染进程不直接联网，规避 file:// 的跨域限制）
 *  2. 遵守平台频率限制：5 分钟内不超过 50 次
 *  3. 内存 + 磁盘两级缓存，减少重复请求
 *  4. 同一请求合并（in-flight dedupe）
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { RequestGate, retryAfterMs } = require('./request-gate');
const musicSources = require('../shared/music-sources.json');
const websiteSources = new Set([...musicSources.map(s => s.value), 'spotify']);
const gate = new RequestGate();

const BASE = 'https://music-api.gdstudio.xyz/api.php';
const SITE = 'https://music.gdstudio.xyz';
const WEBSITE = 'https://music.gdstudio.org/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// 官方限制 50 次 / 5 分钟。自己留 2 次余量，避免边界抖动。
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 48;

const TTL = {
  search: 6 * 60 * 60 * 1000,
  album: 6 * 60 * 60 * 1000,
  url: 20 * 60 * 1000,
  pic: 7 * 24 * 60 * 60 * 1000,
  lyric: 3 * 24 * 60 * 60 * 1000,
};

const mem = new Map(); // key -> { exp, value }
const inflight = new Map(); // key -> Promise

let cacheDir = null;
let websiteRequester = null;
let stats = { requests: 0, cacheHits: 0, errors: 0 };

function setWebsiteRequester(requester) { websiteRequester = requester; }

function initCache(dir) {
  cacheDir = dir;
  gate.init(path.join(dir, 'rate-state.json'));
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {
    /* 缓存不可用不影响主流程 */
  }
}

function cacheFile(key) {
  if (!cacheDir) return null;
  const hash = crypto.createHash('sha1').update(key).digest('hex');
  return path.join(cacheDir, hash.slice(0, 2), hash + '.json');
}

function readDisk(key) {
  const file = cacheFile(key);
  if (!file) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw.exp !== 'number') return null;
    if (raw.exp < Date.now()) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeDisk(key, exp, value) {
  const file = cacheFile(key);
  if (!file) return null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ exp, value }));
  } catch {
    /* 磁盘写入失败时静默降级为纯内存缓存 */
  }
}

function buildQuery(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  return usp.toString();
}

// 空链接只代表这次解析失败，不能把它缓存成歌曲长期不可用。
function cacheable(params, data) {
  if (params.types !== 'url') return true;
  if (typeof data?.url !== 'string' || !/^https?:\/\//i.test(data.url) || Number(data.br) < 0) return false;
  try {
    const url = new URL(data.url);
    return !(url.hostname === 'music-proxy.gdstudio.org' && url.pathname === '/');
  } catch { return false; }
}

function remember(key, ttl, data) {
  const exp = Date.now() + ttl;
  mem.set(key, { exp, value: data });
  writeDisk(key, exp, data);
  if (mem.size > 400) mem.delete(mem.keys().next().value);
}

async function request(params, ttl, options = {}, transport = null) {
  if (!transport && websiteSources.has(String(params.source).replace(/_album$/, ''))) {
    if (websiteRequester) transport = websiteRequester;
    else if (!['netease', 'joox', 'bilibili'].includes(params.source)) throw Error('官网音源接口尚未初始化，请重启应用后重试');
  }
  const query = buildQuery(params);
  const key = transport ? `website:${query}` : query;

  const hit = mem.get(key);
  if (hit && hit.exp > Date.now() && cacheable(params, hit.value)) {
    stats.cacheHits++;
    return hit.value;
  }
  const disk = readDisk(key);
  if (disk !== null && cacheable(params, disk.value)) {
    stats.cacheHits++;
    mem.set(key, disk);
    return disk.value;
  }
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    await gate.acquire(options);
    stats.requests++;
    const url = `${BASE}?${query}`;
    let res;
    try {
      res = transport ? await transport(params) : await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json, text/plain, */*',
          Referer: SITE + '/',
        },
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      stats.errors++;
      throw Object.assign(new Error('网络连接失败，请检查网络或稍后重试'), { retryable: true });
    }
    if (!res.ok) {
      stats.errors++;
      const retryDelay = Math.max(retryAfterMs(res.headers.get('retry-after')), res.status === 429 ? RATE_WINDOW_MS : 30000);
      if (res.status === 429 || res.status >= 500) gate.defer(retryDelay);
      throw Object.assign(new Error(
        res.status === 429
          ? '访问过于频繁，已触发平台限流，请稍等片刻'
          : `接口返回异常（HTTP ${res.status}）`
      ), { status: res.status, retryable: res.status === 429 || res.status >= 500, retryAfterMs: retryDelay });
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      stats.errors++;
      throw new Error('接口返回内容无法解析');
    }
    if (data && data.code && data.code !== 200) {
      const status = Number(data.code);
      const transient = status === 429 || (status >= 500 && status < 600);
      const delay = status === 429 ? RATE_WINDOW_MS : 30000;
      if (transient) gate.defer(delay);
      throw Object.assign(new Error(data.msg || data.message || `接口错误（code ${data.code}）`), {
        status, retryable: transient, retryAfterMs: delay,
      });
    }
    if (transport && typeof data?.url === 'string' && data.url) {
      try { data.url = new URL(data.url, WEBSITE).href; } catch { /* 无效链接交给业务接口处理 */ }
    }
    if (cacheable(params, data)) remember(key, ttl, data);
    return data;
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

/* ------------------------------ 业务接口 ------------------------------ */

function normalizeTrack(item, source) {
  if (!item || item.id === undefined || item.id === null) return null;
  const artist = Array.isArray(item.artist)
    ? item.artist.filter(Boolean)
    : String(item.artist || '')
        .split(/[\/、,&]/)
        .map((s) => s.trim())
        .filter(Boolean);
  return {
    id: String(item.id),
    url_id: String(item.url_id || item.id),
    name: String(item.name || '未知曲目'),
    artist,
    album: String(item.album || ''),
    pic_id: item.pic_id ? String(item.pic_id) : '',
    lyric_id: item.lyric_id ? String(item.lyric_id) : '',
    source: String(item.source || source || ''),
  };
}

async function search({ source = 'netease', name, count = 20, pages = 1, album = false }) {
  if (!name || !String(name).trim()) throw new Error('请输入搜索关键词');
  const src = album && !websiteRequester ? `${source}_album` : source;
  const data = await request(
    { types: album && websiteRequester ? 'search_album' : 'search', source: src, name: String(name).trim(), count, pages },
    album ? TTL.album : TTL.search
  );
  if (!Array.isArray(data)) {
    if (data && data.error) throw new Error(String(data.error));
    throw new Error('搜索没有返回结果');
  }
  return data.map(item => normalizeTrack(item, source)).filter(Boolean);
}

async function trackUrl({ source = 'netease', id, url_id, br = '320' }, options = {}) {
  const params = { types: 'url', source, id: url_id || id, br };
  let data = await request(params, TTL.url, options);
  // 网页导出可能保留换源前的解析 ID。仅空结果时尝试同源原始 ID，限流/服务错误继续由请求队列处理。
  if (!cacheable(params, data) && url_id && id != null && String(url_id) !== String(id)) {
    data = await request({ ...params, id }, TTL.url, options);
  }
  if (!cacheable(params, data)) throw new Error('未能获取该歌曲的音频地址，请稍后重试');
  return { url: data.url, br: Number(data.br) || Number(br), size: Number(data.size) || 0 };
}

async function pic({ source = 'netease', id, size = '500' }) {
  if (!id) return { url: '' };
  const data = await request({ types: 'pic', source, id, size }, TTL.pic);
  return { url: (data && data.url) || '' };
}

async function lyric({ source = 'netease', id }) {
  const data = await request({ types: 'lyric', source, id }, TTL.lyric);
  return {
    lyric: (data && data.lyric) || '',
    tlyric: (data && data.tlyric) || '',
  };
}

/* ------------------------------ 在线歌单导入 ------------------------------ */

/** types=playlist 返回的是平台原生结构（网易：ar/al），单独做归一化 */
function normalizePlaylistTrack(t, source) {
  if (!t || !t.id || !t.name) return null;
  const al = t.al || {};
  return {
    id: String(t.id),
    name: String(t.name),
    artist: (t.ar || []).map((a) => a && a.name).filter(Boolean),
    album: al.name || '',
    pic_id: al.pic_str || (al.pic ? String(al.pic) : ''),
    lyric_id: '',
    source,
  };
}

async function playlist({ source = 'netease', id }) {
  const clean = String(id || '').trim();
  if (!/^\d+$/.test(clean)) throw new Error('歌单 ID 无效');
  const data = await request({ types: 'playlist', source, id: clean }, TTL.search);
  const p = data && data.playlist;
  if (!p || !Array.isArray(p.tracks)) throw new Error('歌单不存在或暂不可访问');
  const tracks = p.tracks.map((t) => normalizePlaylistTrack(t, source)).filter(Boolean);
  if (!tracks.length) throw new Error('这个歌单是空的');
  return { name: p.name || '', cover: p.coverImgUrl || '', tracks };
}

/** 供 UI 展示的配额信息 */
function quota() {
  const now = Date.now();
  const used = gate.stamps.filter((t) => now - t < RATE_WINDOW_MS).length;
  return { used, max: RATE_MAX, windowMinutes: RATE_WINDOW_MS / 60000, stats: { ...stats } };
}

module.exports = { initCache, setWebsiteRequester, search, trackUrl, pic, lyric, quota, playlist };
