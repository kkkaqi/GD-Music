/* 全局状态 + 数据操作（不含播放逻辑，播放见 player.js） */
import { reactive, computed } from 'vue';
import { Api } from './api';
import { toast } from './ui';
import musicSources from '../../shared/music-sources.json';

/* ------------------------------ 常量 ------------------------------ */

export const SOURCES = musicSources;

export const QUALITIES = [
  { value: '128', label: '标准', desc: '128K' },
  { value: '192', label: '较高', desc: '192K' },
  { value: '320', label: '高品', desc: '320K' },
  { value: '740', label: '16bit 无损', desc: 'FLAC' },
  { value: '999', label: '24bit 无损', desc: 'FLAC' },
];

export const CURATED = [
  { title: '华语流行', kw: '华语流行', sub: '热歌精选' },
  { title: '欧美热歌', kw: 'top hits', sub: 'Billboard 风向' },
  { title: '粤语经典', kw: '粤语经典老歌', sub: '黄金年代' },
  { title: '日系治愈', kw: '日系治愈', sub: 'city pop' },
  { title: '中文说唱', kw: '中文说唱', sub: 'underground' },
  { title: '民谣时光', kw: '民谣', sub: '吉他与人声' },
  { title: '摇滚不死', kw: '摇滚', sub: '失真与现场' },
  { title: '电子律动', kw: 'electronic dance', sub: '深夜跳舞' },
  { title: '爵士小酌', kw: 'jazz', sub: '微醺时刻' },
  { title: '古典入梦', kw: '古典 钢琴', sub: '安静下来' },
  { title: '影视原声', kw: '电影原声', sub: '故事的声音' },
  { title: 'ACG 次元', kw: '动漫 主题曲', sub: '二次元' },
];

/* ------------------------------ 状态 ------------------------------ */

const DEFAULTS = {
  version: 1,
  quality: '320',
  volume: 0.75,
  mode: 'order',
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

export const S = reactive({ ...DEFAULTS });

export const ui = reactive({
  view: 'discover',
  collection: null,
  search: { q: '', source: 'netease', album: false, page: 0, tracks: [], done: true, ran: false, loading: false },
  history: [],
  historyPos: -1,
  queueOpen: false,
  npOpen: false,
  quotaText: '',
});

export const currentTrack = computed(() => S.queue[S.queueIndex] || null);
export const canBack = computed(() => ui.historyPos > 0);
export const canForward = computed(() => ui.historyPos < ui.history.length - 1);

/* ------------------------------ 工具 ------------------------------ */

export const keyOf = (t) => (t ? `${t.source}:${t.id}` : '');
export const pad = (n) => String(n).padStart(2, '0');
export const fmtTime = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const s = Math.floor(sec);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};

const picCache = new Map();
export const cardTracks = new Map();

export async function coverUrl(track, size = '500') {
  if (!track) return '';
  if (track.pic && size === '500') return track.pic;
  if (!track.pic_id) return '';
  const k = `${track.source}:${track.pic_id}:${size}`;
  if (picCache.has(k)) return picCache.get(k);
  try {
    const { url } = await Api.pic({ source: track.source, id: track.pic_id, size });
    if (url) picCache.set(k, url);
    if (size === '500' && url) track.pic = url;
    return url || '';
  } catch {
    return '';
  }
}

export async function searchCurated(kw, source = S.source) {
  const key = `${source}:${kw}`;
  if (cardTracks.has(key)) return cardTracks.get(key);
  const tracks = await Api.search({ source, name: kw, count: 20, pages: 1 });
  if (tracks.length) cardTracks.set(key, tracks);
  return tracks;
}

/* ------------------------------ 持久化 ------------------------------ */

export function serialize() {
  return {
    version: 1,
    quality: S.quality,
    volume: S.volume,
    mode: S.mode,
    source: S.source,
    favorites: S.favorites,
    recent: S.recent,
    playlists: S.playlists,
    queue: S.queue,
    queueIndex: S.queueIndex,
    lastTrack: currentTrack.value,
    lastTime: S.lastTime,
    showTranslation: S.showTranslation,
  };
}

let saveTimer = null;
export function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // IPC 走结构化克隆，reactive 代理必须先转成普通对象
    const plain = JSON.parse(JSON.stringify(serialize()));
    Api.state.save(plain);
  }, 400);
}

export async function loadState() {
  const saved = await Api.state.load();
  if (!saved) return;
  for (const k of [
    'quality',
    'mode',
    'source',
    'favorites',
    'recent',
    'playlists',
    'queue',
    'queueIndex',
    'showTranslation',
    'lastTime',
  ]) {
    if (saved[k] !== undefined && saved[k] !== null) S[k] = saved[k];
  }
  if (typeof saved.volume === 'number') S.volume = saved.volume;
  S.lastTrack = saved.lastTrack || null;
  if (!S.queue.length && S.lastTrack) S.queue = [{ ...S.lastTrack }];
  S.queueIndex = Math.min(Math.max(0, S.queueIndex), Math.max(0, S.queue.length - 1));
}

/* ------------------------------ 收藏 / 历史 ------------------------------ */

export function isLiked(track) {
  if (!track) return false;
  const k = keyOf(track);
  return S.favorites.some((t) => keyOf(t) === k);
}

export function toggleLike(track) {
  if (!track) return false;
  const k = keyOf(track);
  const i = S.favorites.findIndex((t) => keyOf(t) === k);
  if (i >= 0) {
    S.favorites.splice(i, 1);
    toast('已取消喜欢');
  } else {
    S.favorites.unshift({ ...track });
    toast('已加入我喜欢的音乐', 'ok');
  }
  persist();
  return isLiked(track);
}

export function pushRecent(track) {
  if (!track) return;
  const k = keyOf(track);
  const i = S.recent.findIndex((t) => keyOf(t) === k);
  if (i >= 0) S.recent.splice(i, 1);
  S.recent.unshift({ ...track, _at: Date.now() });
  if (S.recent.length > 120) S.recent.length = 120;
  persist();
}

/* ------------------------------ 歌单 ------------------------------ */

export function createPlaylist(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const baseId = 'pl_' + Date.now().toString(36);
  let id = baseId;
  let suffix = 1;
  while (S.playlists.some((p) => p.id === id)) id = `${baseId}_${suffix++}`;
  const pl = { id, name: clean, tracks: [] };
  S.playlists.push(pl);
  persist();
  return pl;
}

export function addToPlaylist(playlistId, track) {
  const pl = S.playlists.find((p) => p.id === playlistId);
  if (!pl) return;
  if (pl.tracks.some((t) => keyOf(t) === keyOf(track))) {
    toast(`《${pl.name}》里已经有这首歌了`);
    return;
  }
  pl.tracks.unshift({ ...track });
  persist();
  toast(`已添加到《${pl.name}》`, 'ok');
}

export function removeFromPlaylist(playlistId, track) {
  const pl = S.playlists.find((p) => p.id === playlistId);
  if (!pl) return;
  pl.tracks = pl.tracks.filter((t) => keyOf(t) !== keyOf(track));
  persist();
}

export function renamePlaylist(id, name) {
  const pl = S.playlists.find((p) => p.id === id);
  if (!pl) return;
  pl.name = String(name).trim() || pl.name;
  persist();
}

export function deletePlaylist(id) {
  S.playlists = S.playlists.filter((p) => p.id !== id);
  persist();
}

/* ------------------------------ 歌单导入 / 导出 ------------------------------ */

/** 从粘贴内容里提取歌单 ID：支持纯数字、music.163.com/playlist?id=xxx、/playlist/xxx */
function parsePlaylistId(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return s;
  const byQuery = /[?&]id=(\d+)/.exec(s);
  if (byQuery) return byQuery[1];
  const byPath = /playlist\/(\d+)/.exec(s);
  return byPath ? byPath[1] : '';
}

/** 在线歌单导入（走 GD types=playlist），展示为临时集合，可再存入本地 */
export async function importPlaylist(input) {
  const id = parsePlaylistId(input);
  if (!id) {
    toast('没认出歌单链接或 ID，请检查后重试', 'err');
    return;
  }
  toast('正在拉取歌单…');
  try {
    const data = await Api.playlist({ id, source: 'netease' });
    openCollection({
      type: 'import',
      id: 'imp_' + Date.now().toString(36),
      title: data.name || `网易云歌单 ${id}`,
      subtitle: '导入歌单',
      cover: data.cover || '',
      tracks: data.tracks,
    });
    toast(`已导入《${data.name || '歌单'}》，共 ${data.tracks.length} 首`, 'ok');
  } catch (err) {
    toast(err.message || '导入失败', 'err');
  }
}

/** 把导入的歌单保存为本地歌单 */
export function saveImportedAsPlaylist(name, tracks) {
  const pl = createPlaylist(name);
  if (!pl) return null;
  pl.tracks = tracks.map((t) => ({ ...t }));
  persist();
  return pl;
}

function uniquePlaylistName(base) {
  const names = new Set(S.playlists.map((p) => p.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

/** 导出本地歌单为 JSON 配置（可用于备份 / 分享 / 再导入） */
export async function exportPlaylistConfig(id) {
  const pl = S.playlists.find((p) => p.id === id);
  if (!pl) return;
  if (!pl.tracks.length) return toast('歌单是空的，没什么可导出', 'err');
  try {
    const res = await Api.file.exportJson({
      name: `${pl.name.replace(/[\\/:*?"<>|]/g, '_')}.json`,
      data: {
        app: 'gd-music',
        type: 'playlist',
        version: 1,
        exported_at: new Date().toISOString(),
        name: pl.name,
        tracks: JSON.parse(JSON.stringify(pl.tracks)),
      },
    });
    if (!res || !res.saved) return;
    toast('歌单配置已导出', 'ok');
  } catch (err) {
    toast(err.message || '导出失败', 'err');
  }
}

/** 从 JSON 配置文件还原歌单 */
function configArray(value) {
  if (typeof value === 'string' && value.trim()) value = JSON.parse(value);
  if (value == null || value === '') return [];
  if (!Array.isArray(value)) throw new Error('歌单配置中的列表格式不正确');
  return value;
}

function configTracks(value) {
  return configArray(value)
    .filter((t) => t && ['string', 'number'].includes(typeof t.id) && String(t.id).trim()
      && typeof t.name === 'string' && t.name.trim() && typeof t.source === 'string' && t.source.trim())
    .map((t) => ({
      ...t,
      id: String(t.id),
      artist: (Array.isArray(t.artist) ? t.artist : String(t.artist || '').split(/[,，、]/))
        .filter((a) => typeof a === 'string').map((a) => a.trim()).filter(Boolean),
      album: typeof t.album === 'string' ? t.album : '',
      pic: typeof t.pic === 'string' && /^https?:\/\//.test(t.pic) ? t.pic : '',
    }));
}

let importingConfig = false;
export async function importPlaylistConfig() {
  if (importingConfig) return;
  importingConfig = true;
  try {
    const res = await Api.file.importJson();
    if (!res || !res.picked) return;
    const d = res.data;
    const lists = [];
    let favorites = [];
    const failed = [];
    if (d && d.app === 'gd-music' && d.type === 'playlist' && Array.isArray(d.tracks)) {
      lists.push({ name: String(d.name || '导入的歌单'), tracks: configTracks(d.tracks) });
    } else if (d && typeof d === 'object' && !Array.isArray(d)
      && ['gdmusic_fav', 'gdmusic_his', 'gdmusic_playing', 'gdmusic_ulist'].some((k) => Object.hasOwn(d, k))) {
      favorites = configTracks(d.gdmusic_fav);
      for (const [key, name] of [['gdmusic_his', '网页播放历史'], ['gdmusic_playing', '网页正在播放']]) {
        const tracks = configTracks(d[key]);
        if (tracks.length) lists.push({ name, tracks });
      }
      // 先校验全部本地结构，再联网；解析失败不会修改已有数据。
      const remoteLists = configArray(d.gdmusic_ulist).map((p) => {
        if (!p || typeof p !== 'object') throw new Error('歌单配置中的歌单格式不正确');
        return { id: p.id, name: String(p.name || '导入的歌单'), tracks: configTracks(p.item) };
      });
      for (const p of remoteLists) {
        if (!p.tracks.length && p.id != null && /^\d+$/.test(String(p.id))) {
          toast(`正在读取《${p.name}》…`);
          try {
            const result = await Api.playlist({ id: String(p.id), source: 'netease' });
            p.tracks = configTracks(result.tracks);
          } catch {
            failed.push(p.name);
            continue;
          }
        }
        lists.push(p);
      }
    } else {
      throw new Error('请选择 GD 音乐台网页配置或桌面版歌单配置');
    }

    const keys = new Set(S.favorites.map(keyOf));
    let addedFavorites = 0;
    for (const t of favorites) {
      if (keys.has(keyOf(t))) continue;
      keys.add(keyOf(t));
      S.favorites.push(t);
      addedFavorites++;
    }
    let first = null;
    for (const list of lists) {
      const pl = createPlaylist(uniquePlaylistName(list.name.trim() || '导入的歌单'));
      pl.tracks = list.tracks;
      if (!first) first = pl;
    }
    if (first || addedFavorites) persist();
    if (first) openCollection({ type: 'playlist', id: first.id });
    else if (favorites.length) openCollection({ type: 'favorites' });
    if (lists.length || favorites.length) {
      toast(`已导入 ${lists.length} 个歌单，新增 ${addedFavorites} 首收藏`, 'ok');
    } else if (!failed.length) toast('配置里没有可导入的歌单或新收藏');
    if (failed.length) toast(`以下歌单读取失败，可联网后重试：${failed.join('、')}`, 'err', 10000);
  } catch (err) {
    toast(err.message || '读取歌单配置失败', 'err');
  } finally {
    importingConfig = false;
  }
}

/* ------------------------------ 集合 ------------------------------ */

export function collectionTracks(spec) {
  if (!spec) return [];
  if (spec.type === 'favorites') return S.favorites;
  if (spec.type === 'recent') return S.recent;
  if (spec.type === 'playlist') {
    const pl = S.playlists.find((p) => p.id === spec.id);
    return pl ? pl.tracks : [];
  }
  return spec.tracks || [];
}

export function collectionMeta(spec) {
  if (!spec) return { title: '歌单', kind: '歌单', meta: '' };
  const tracks = collectionTracks(spec);
  if (spec.type === 'favorites') {
    return { title: '我喜欢的音乐', kind: '我的收藏', meta: `${tracks.length} 首 · 本地保存` };
  }
  if (spec.type === 'recent') {
    return { title: '最近播放', kind: '播放记录', meta: `${tracks.length} 首` };
  }
  if (spec.type === 'playlist') {
    const pl = S.playlists.find((p) => p.id === spec.id);
    return {
      title: pl ? pl.name : '歌单',
      kind: '我的歌单',
      meta: `${tracks.length} 首 · 本地歌单`,
    };
  }
  const src = (SOURCES.find((s) => s.value === (tracks[0] && tracks[0].source)) || {}).label || '网络';
  return {
    title: spec.title || '歌单',
    kind: spec.subtitle || '推荐歌单',
    meta: `${tracks.length} 首 · 来源 ${src}`,
  };
}

/* ------------------------------ 导航 ------------------------------ */

function pushHistory(spec) {
  ui.history = ui.history.slice(0, ui.historyPos + 1);
  ui.history.push(spec);
  ui.historyPos = ui.history.length - 1;
}

function invalidateSearch() {
  ++searchSeq;
  ui.search.loading = false;
}

export function goDiscover() {
  invalidateSearch();
  ui.view = 'discover';
  pushHistory({ type: 'discover' });
  refreshQuota();
}

export function openCollection(spec) {
  invalidateSearch();
  ui.collection = spec;
  ui.view = 'collection';
  pushHistory({ type: 'collection', spec });
  ui.contentScroll = 0;
}

export function goBack() {
  const pos = ui.historyPos - 1;
  if (pos < 0) return;
  ui.historyPos = pos;
  applyHistory(ui.history[pos]);
}

export function goForward() {
  const pos = ui.historyPos + 1;
  if (pos >= ui.history.length) return;
  ui.historyPos = pos;
  applyHistory(ui.history[pos]);
}

function applyHistory(spec) {
  if (!spec) return;
  invalidateSearch();
  if (spec.type === 'discover') {
    ui.view = 'discover';
  } else if (spec.type === 'search') {
    Object.assign(ui.search, spec.search, { loading: false });
    ui.view = 'search';
  } else if (spec.type === 'collection') {
    ui.collection = spec.spec;
    ui.view = 'collection';
  }
}

export function goSearchView() {
  ui.view = 'search';
}

/* ------------------------------ 搜索 ------------------------------ */

let searchSeq = 0;

export async function runSearch(q, { append = false } = {}) {
  const query = String(q || '').trim();
  if (!query) return;
  if (append && (ui.search.loading || ui.search.done)) return;
  const seq = ++searchSeq;

  if (!append) {
    Object.assign(ui.search, {
      q: query,
      source: S.source,
      album: ui.search.album,
      page: 0,
      tracks: [],
      done: false,
      ran: true,
      loading: true,
    });
    ui.view = 'search';
    pushHistory({ type: 'search', search: { ...ui.search, loading: false } });
  }
  ui.search.loading = true;

  const page = ui.search.page + 1;
  const sourceConfig = SOURCES.find(s => s.value === ui.search.source);
  const pageSize = sourceConfig?.pageSize || 20;
  try {
    const tracks = await Api.search({
      source: ui.search.source,
      name: query,
      count: pageSize,
      pages: page,
      album: ui.search.album,
    });
    if (seq !== searchSeq) return;
    ui.search.page = page;
    ui.search.tracks = ui.search.tracks.concat(tracks);
    ui.search.done = sourceConfig?.pagination === false || tracks.length < pageSize;
    const top = ui.history[ui.historyPos];
    if (top && top.type === 'search') {
      top.search = { ...ui.search, loading: false };
    }
  } catch (err) {
    if (seq !== searchSeq) return;
    toast(err.message, 'err');
    // 追加失败不代表已到末页，保留按钮供重试。
    if (!append) ui.search.done = true;
  } finally {
    if (seq === searchSeq) {
      ui.search.loading = false;
      refreshQuota();
    }
  }
}

export function setSearchSource(value) {
  S.source = value;
  if (!SOURCES.find(s => s.value === value)?.album) ui.search.album = false;
  persist();
  cardTracks.clear();
  if (ui.search.q) runSearch(ui.search.q);
}

export function toggleAlbum() {
  if (!SOURCES.find(s => s.value === S.source)?.album) { ui.search.album = false; return; }
  ui.search.album = !ui.search.album;
  if (ui.search.q) runSearch(ui.search.q);
}

/* ------------------------------ 配额 ------------------------------ */

export async function refreshQuota() {
  const q = await Api.quota();
  if (!q) return;
  ui.quotaText = `本窗口已用 ${q.used}/${q.max} 次请求（5 分钟滚动限额）`;
}
