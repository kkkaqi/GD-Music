<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, watch } from 'vue';
import Icon from './Icon.vue';
import { S, CURATED, searchCurated, coverUrl, openCollection, refreshQuota, ui } from '../store';
import { toast } from '../ui';
import { setQueue, loadAndPlay } from '../player';

const covers = reactive({});
const cards = ref([]);
let io = null;

const queue = [];
let working = false;
let generation = 0;
let disposed = false;
const pending = new Set();

function imageLoads(url) {
  return new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => finish(false), 5000);
    function finish(ok) {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      if (!ok) img.src = '';
      resolve(ok);
    }
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = url;
  });
}

function loadCover(kw) {
  if (covers[kw] || pending.has(kw) || disposed) return;
  pending.add(kw);
  queue.push(kw);
  pump();
}

async function pump() {
  if (working) return;
  working = true;
  while (queue.length) {
    const kw = queue.shift();
    const version = generation;
    const source = S.source;
    try {
      const tracks = await searchCurated(kw, source);
      for (const track of tracks.filter(t => t.pic || t.pic_id).slice(0, 3)) {
        if (disposed || version !== generation) break;
        const url = await coverUrl(track);
        if (url && await imageLoads(url)) {
          if (!disposed && version === generation) covers[kw] = url;
          break;
        }
      }
    } catch {
      /* 单张封面失败不影响整体 */
    } finally {
      if (version === generation) pending.delete(kw);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  working = false;
}

function observeAll() {
  if (!io) return;
  cards.value.forEach((c) => c && io.observe(c));
}

onMounted(() => {
  io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        loadCover(entry.target.dataset.kw);
      }
    },
    { rootMargin: '260px' }
  );
  observeAll();
  refreshQuota();
});

onBeforeUnmount(() => {
  disposed = true;
  generation++;
  queue.length = 0;
  if (io) io.disconnect();
});

watch(
  () => S.source,
  () => {
    generation++;
    pending.clear();
    Object.keys(covers).forEach((k) => delete covers[k]);
    queue.length = 0;
    observeAll();
  }
);

async function openCurated(c) {
  toast(`正在打开《${c.title}》…`);
  try {
    const tracks = await searchCurated(c.kw);
    if (!tracks.length) return toast('没有找到曲目', 'err');
    openCollection({
      type: 'list',
      title: c.title,
      subtitle: '推荐歌单 · ' + c.sub,
      tracks,
    });
    refreshQuota();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function surprise() {
  const pick = CURATED[Math.floor(Math.random() * CURATED.length)];
  try {
    const tracks = await searchCurated(pick.kw);
    if (!tracks.length) return toast('没有找到曲目', 'err');
    setQueue(tracks, Math.floor(Math.random() * Math.min(6, tracks.length)), true);
  } catch (err) {
    toast(err.message, 'err');
  }
}

function focusSearch() {
  const el = document.getElementById('searchInput');
  if (el) {
    el.focus();
    el.select();
  }
}

function playRecent(t) {
  const i = S.queue.findIndex((x) => x.source === t.source && x.id === t.id);
  if (i >= 0) {
    S.queueIndex = i;
    loadAndPlay(true);
  } else {
    setQueue([...S.recent], S.recent.indexOf(t), true);
  }
}

void ui;
</script>

<template>
  <section class="view">
    <div class="hero">
      <div class="hero-glow"></div>
      <div class="hero-inner">
        <div class="hero-text">
          <div class="hero-kicker">GD MUSIC · DESKTOP</div>
          <h1 class="hero-title">今天想听点什么？</h1>
          <p class="hero-sub">搜索任意歌曲，或从下面挑一个口味开始。</p>
          <div class="hero-actions">
            <button class="btn primary" @click="surprise">
              <Icon name="play" />随便听听
            </button>
            <button class="btn ghost" @click="focusSearch">
              <Icon name="search" />搜索歌曲
            </button>
          </div>
        </div>
        <div class="hero-art" aria-hidden="true">
          <div class="disc">
            <div class="disc-grooves"></div>
            <div class="disc-label"></div>
          </div>
          <div class="disc-shadow"></div>
        </div>
      </div>
    </div>

    <div class="section-head">
      <h2>为你推荐</h2>
      <span class="hint">{{ ui.quotaText }}</span>
    </div>

    <div class="cards">
      <button
        v-for="(c, index) in CURATED"
        :key="c.kw"
        ref="cards"
        class="card"
        :class="{ 'has-cover': !!covers[c.kw] }"
        :data-kw="c.kw"
        :style="{ '--card-hue': (index * 37 + 150) % 360 }"
        @click="openCurated(c)"
      >
        <div class="card-art">
          <img v-if="covers[c.kw]" :src="covers[c.kw]" alt="" @error="delete covers[c.kw]" />
          <div v-else class="card-ph card-fallback"><Icon name="music" /><strong>{{ c.title }}</strong><small>{{ c.sub }}</small></div>
          <span class="card-play"><Icon name="play" /></span>
        </div>
        <div class="card-title">{{ c.title }}</div>
        <div class="card-sub">{{ c.sub }}</div>
      </button>
    </div>

    <div class="section-head">
      <h2>最近在听</h2>
      <button class="link-btn" @click="openCollection({ type: 'recent' })">全部</button>
    </div>

    <div class="mini-grid">
      <div v-if="!S.recent.length" class="empty small">还没有播放记录，随便听点什么吧</div>
      <button v-for="t in S.recent.slice(0, 6)" :key="t.source + t.id" class="mini" @click="playRecent(t)">
        <div class="mini-art">
          <img v-if="t.pic" :src="t.pic" alt="" />
          <Icon v-else name="music" />
        </div>
        <div class="mini-meta">
          <div class="mini-name">{{ t.name }}</div>
          <div class="mini-artist">{{ t.artist.join(' / ') }}</div>
        </div>
      </button>
    </div>
  </section>
</template>
