/* 播放核心：audio 元素 + 队列 + 歌词 */
import { reactive } from 'vue';
import { Api } from './api';
import { mergeLrc } from './lrc';
import { toast } from './ui';
import { S, currentTrack, keyOf, persist, pushRecent, toggleLike, QUALITIES, SOURCES, coverUrl } from './store';

export const audio = new Audio();
audio.preload = 'auto';

export const player = reactive({
  playing: false,
  buffering: false,
  duration: 0,
  position: 0,
  lines: [],
  active: -1,
  cover: '',
  lyricLoading: false,
});

let playToken = 0;
let lyricToken = 0;
let skipTimer = null;
let pendingSeek = null;
let playback = null;

function cancelPendingPlayback() {
  ++playToken;
  ++lyricToken;
  clearTimeout(skipTimer);
  skipTimer = null;
  pendingSeek = null;
  playback = null;
}

function scheduleErrorSkip(token, delay) {
  clearTimeout(skipTimer);
  skipTimer = setTimeout(() => {
    skipTimer = null;
    if (token === playToken) next(false);
  }, delay);
}

function sameRecording(a, b) {
  const clean = (s) => String(s || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const artists = new Set((a.artist || []).map(clean).filter(Boolean));
  return clean(a.name) === clean(b.name) && artists.size > 0
    && (b.artist || []).some((name) => artists.has(clean(name)));
}

function restorePosition() {
  if (!pendingSeek || pendingSeek.token !== playToken || audio.readyState < 1) return;
  const position = Math.max(0, Math.min(pendingSeek.position, Number.isFinite(audio.duration) ? audio.duration : pendingSeek.position));
  audio.currentTime = position;
  player.position = position;
  S.lastTime = position;
  pendingSeek = null;
}

async function useSource(url, token, autoPlay, position) {
  if (token !== playToken) return;
  if (playback) playback.mediaFailed = false;
  pendingSeek = { token, position };
  audio.src = url;
  audio.load();
  restorePosition();
  if (autoPlay) {
    try { await audio.play(); }
    catch (err) {
      if (token === playToken) {
        if (err.name === 'NotAllowedError') {
          toast('播放被拦截，请再点一次播放');
          player.playing = false;
          if (playback) playback.autoPlay = false;
        } else if (err.name !== 'AbortError') throw err;
      }
    }
  }
  if (token === playToken && playback?.mediaFailed) throw Error('音频加载失败');
}

export const isCurrent = (track) => !!track && keyOf(track) === keyOf(currentTrack.value);

/* ------------------------------ 内部 ------------------------------ */

function applyCover(url) {
  player.cover = url || '';
  const t = currentTrack.value;
  if (t && url) t.pic = url;
}

async function loadLyrics(track, token) {
  const my = ++lyricToken;
  player.lines = [];
  player.active = -1;
  player.lyricLoading = true;
  try {
    const res = await Api.lyric({ source: track.source, id: track.lyric_id || track.id });
    if (my !== lyricToken || token !== playToken) return;
    player.lines = mergeLrc(res.lyric, res.tlyric);
  } catch {
    if (my !== lyricToken) return;
    player.lines = [];
  } finally {
    if (my === lyricToken) player.lyricLoading = false;
  }
}

/* ------------------------------ 播放 ------------------------------ */

/** 当前源拿不到播放地址时，用「歌名+歌手」去其他开放源找同曲目替补 */
async function tryAltSources(context) {
  const { original: track, token } = context;
  const query = `${track.name} ${track.artist[0] || ''}`.trim();
  const alts = SOURCES.filter((s) => s.open && s.value !== track.source);
  for (const alt of alts) {
    if (context.triedSources.has(alt.value)) continue;
    context.triedSources.add(alt.value);
    try {
      const list = await Api.search({ source: alt.value, name: query, count: 5 });
      if (token !== playToken) return false;
      const cand = (list || []).find((t) => sameRecording(track, t));
      if (!cand) continue;
      await loadTrackSource(cand, context);
      if (token !== playToken) return false;
      const idx = S.queueIndex;
      if (idx >= 0) {
        S.queue.splice(idx, 1, cand);
        persist();
      }
      loadLyrics(cand, token);
      coverUrl(cand).then((url) => {
        if (token === playToken) applyCover(url);
      });
      toast(`已自动切换到「${alt.label}」源播放`, 'ok');
      return true;
    } catch {
      if (token !== playToken) return false;
    }
  }
  return false;
}

async function loadTrackSource(track, context, refresh = false) {
  const { token } = context;
  if (refresh) context.refreshedSources.add(track.source);
  const res = await Api.url({ source: track.source, id: track.id, url_id: track.url_id, br: S.quality, refresh });
  if (token !== playToken) return;
  context.track = track;
  try {
    await useSource(res.url, token, context.autoPlay, context.position);
  } catch (err) {
    if (token !== playToken) return;
    if (context.mediaFailed && !context.refreshedSources.has(track.source)) {
      return loadTrackSource(track, context, true);
    }
    throw err;
  }
}

function failPlayback(context, error, delay) {
  if (context.token !== playToken) return;
  context.failed = true;
  audio.removeAttribute('src');
  player.buffering = false;
  player.playing = false;
  toast(error?.message || '这首歌暂时无法播放', 'err');
  if (context.autoPlay) scheduleErrorSkip(context.token, delay);
}

async function recoverMedia(context) {
  if (context.recovering || context.failed || context.token !== playToken) return;
  context.recovering = true;
  context.position = pendingSeek?.position ?? audio.currentTime ?? player.position;
  player.buffering = true;
  audio.pause();
  player.playing = context.autoPlay;
  try {
    if (!context.refreshedSources.has(context.track.source)) {
      try {
        await loadTrackSource(context.track, context, true);
        return;
      } catch { if (context.token !== playToken) return; }
    }
    const switched = await tryAltSources(context);
    if (!switched) failPlayback(context, Error('音频加载失败，所有匹配音源均不可用'), 900);
  } finally {
    context.recovering = false;
    if (context.token === playToken) {
      player.buffering = false;
    }
  }
}

export async function loadAndPlay(autoPlay = true, { position = 0 } = {}) {
  const track = currentTrack.value;
  if (!track) return;
  cancelPendingPlayback();
  const token = playToken;
  const context = playback = { token, original: track, track, autoPlay, position,
    triedSources: new Set([track.source]), refreshedSources: new Set(), recovering: true,
    mediaFailed: false, failed: false };
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  player.position = position;
  S.lastTime = position;
  player.duration = 0;
  player.buffering = true;
  player.playing = context.autoPlay;
  pushRecent(track);

  coverUrl(track).then((url) => {
    if (token !== playToken) return;
    applyCover(url);
  });
  loadLyrics(track, token);

  try {
    await loadTrackSource(track, context);
    if (token !== playToken) return;
    player.buffering = false;
  } catch (err) {
    if (token !== playToken) return;
    audio.pause();
    const switched = await tryAltSources(context);
    if (token !== playToken) return;
    player.buffering = false;
    if (switched) return;
    failPlayback(context, err, 1500);
  } finally {
    context.recovering = false;
  }
}

export function setQueue(tracks, index = 0, autoplay = true) {
  S.queue = tracks.map((t) => ({ ...t }));
  S.queueIndex = Math.min(Math.max(0, index), Math.max(0, S.queue.length - 1));
  persist();
  if (autoplay) loadAndPlay(true);
}

export function enqueue(track, next = false) {
  if (!track) return;
  if (next) {
    S.queue.splice(S.queueIndex + 1, 0, { ...track });
    toast('已设为下一首播放', 'ok');
  } else {
    S.queue.push({ ...track });
    toast('已加入播放队列', 'ok');
  }
  persist();
}

export function playNextAndGo(track) {
  if (!track) return;
  const index = Math.min(S.queueIndex + 1, S.queue.length);
  S.queue.splice(index, 0, { ...track });
  S.queueIndex = index;
  persist();
  loadAndPlay(true);
}

export function clearQueue() {
  cancelPendingPlayback();
  S.queue = [];
  S.queueIndex = 0;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  player.playing = false;
  player.buffering = false;
  player.lyricLoading = false;
  S.lastTime = 0;
  player.position = 0;
  player.duration = 0;
  player.lines = [];
  player.active = -1;
  player.cover = '';
  persist();
}

export function removeFromQueue(index) {
  if (index < 0 || index >= S.queue.length) return;
  S.queue.splice(index, 1);
  if (S.queueIndex > index) S.queueIndex -= 1;
  else if (S.queueIndex === index) {
    S.queueIndex = Math.min(S.queueIndex, S.queue.length - 1);
    if (!S.queue.length) {
      clearQueue();
      return;
    }
    loadAndPlay(true);
  }
  persist();
}

export function next(auto = false) {
  if (!S.queue.length) return;
  if (auto && S.mode === 'single') {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  if (S.mode === 'shuffle' && S.queue.length > 1) {
    let i = S.queueIndex;
    while (i === S.queueIndex) i = Math.floor(Math.random() * S.queue.length);
    S.queueIndex = i;
  } else {
    S.queueIndex = (S.queueIndex + 1) % S.queue.length;
  }
  persist();
  loadAndPlay(true);
}

export function prev() {
  if (!S.queue.length) return;
  if (audio.currentTime > 4) {
    audio.currentTime = 0;
    return;
  }
  S.queueIndex = (S.queueIndex - 1 + S.queue.length) % S.queue.length;
  persist();
  loadAndPlay(true);
}

export function togglePlay() {
  if (!currentTrack.value) {
    if (S.recent.length) {
      setQueue(S.recent, 0, true);
      return;
    }
    toast('先搜一首歌吧');
    return;
  }
  if (playback && player.buffering && !playback.failed) {
    playback.autoPlay = !playback.autoPlay;
    player.playing = playback.autoPlay;
    if (!playback.autoPlay) audio.pause();
    else if (audio.src) audio.play().catch(() => {});
    return;
  }
  if (!audio.src) {
    loadAndPlay(true, { position: player.position || 0 });
    return;
  }
  if (playback) playback.autoPlay = audio.paused;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

export function seekRatio(ratio) {
  if (!Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.min(Math.max(0, ratio), 1) * audio.duration;
  player.position = audio.currentTime;
}

export function seekSeconds(sec) {
  audio.currentTime = Math.min(Math.max(0, sec), audio.duration || 0);
  player.position = audio.currentTime;
}

export function nudge(seconds) {
  seekSeconds((audio.currentTime || 0) + seconds);
}

export function setVolume(v) {
  const vol = Math.min(Math.max(v, 0), 1);
  audio.volume = vol;
  audio.muted = false;
  S.volume = vol;
  persist();
}

export function toggleMute() {
  audio.muted = !audio.muted;
}

export function cycleMode() {
  S.mode = S.mode === 'order' ? 'single' : S.mode === 'single' ? 'shuffle' : 'order';
  persist();
  toast(S.mode === 'single' ? '单曲循环' : S.mode === 'shuffle' ? '随机播放' : '列表循环');
}

export async function cycleQuality() {
  const i = QUALITIES.findIndex((q) => q.value === S.quality);
  return setQuality(QUALITIES[(i + 1) % QUALITIES.length].value);
}

export async function setQuality(value) {
  if (!QUALITIES.some((q) => q.value === value) || value === S.quality) return;
  const autoPlay = playback?.recovering ? playback.autoPlay : !audio.paused;
  const position = pendingSeek?.position ?? (audio.src ? audio.currentTime : player.position);
  S.quality = value;
  persist();
  if (currentTrack.value) await loadAndPlay(autoPlay, { position });
  else toast(`音质切换为 ${QUALITIES.find((q) => q.value === S.quality).desc}`);
}

export function toggleLikeCurrent() {
  if (!currentTrack.value) return;
  toggleLike(currentTrack.value);
}

export function syncLyricIndex(time) {
  if (!player.lines.length) return;
  let idx = -1;
  for (let i = 0; i < player.lines.length; i++) {
    if (player.lines[i].t <= time + 0.2) idx = i;
    else break;
  }
  if (idx !== player.active) player.active = idx;
}

/* ------------------------------ 事件 ------------------------------ */

audio.addEventListener('play', () => {
  if (playback) playback.autoPlay = true;
  player.playing = true;
});

audio.addEventListener('pause', () => {
  player.playing = false;
  persist();
});

audio.addEventListener('playing', () => {
  player.buffering = false;
  player.playing = true;
});

audio.addEventListener('waiting', () => {
  player.buffering = true;
});

audio.addEventListener('canplay', () => {
  player.buffering = false;
});

audio.addEventListener('loadedmetadata', () => {
  player.duration = audio.duration || 0;
  restorePosition();
});

audio.addEventListener('durationchange', () => {
  player.duration = audio.duration || 0;
});

audio.addEventListener('timeupdate', () => {
  player.position = audio.currentTime || 0;
  S.lastTime = player.position;
  syncLyricIndex(player.position);
});

audio.addEventListener('ended', () => next(true));

audio.addEventListener('error', () => {
  if (!audio.src || !playback || playback.failed) return;
  const context = playback;
  context.mediaFailed = true;
  recoverMedia(context).catch(err => failPlayback(context, err, 900));
});

if (window.bridge && window.bridge.media) {
  window.bridge.media.onCommand((cmd) => {
    if (cmd === 'toggle') togglePlay();
    else if (cmd === 'next') next(false);
    else if (cmd === 'prev') prev();
    else if (cmd === 'like') toggleLikeCurrent();
    else if (cmd === 'stop') {
      clearTimeout(skipTimer);
      if (playback) { playback.autoPlay = false; playback.position = 0; }
      if (pendingSeek) pendingSeek.position = 0;
      audio.pause();
      audio.currentTime = 0;
      player.position = S.lastTime = 0;
    }
  });
}
