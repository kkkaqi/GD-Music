<script setup>
import { computed } from 'vue';
import TrackList from './TrackList.vue';
import { ui, SOURCES, runSearch } from '../store';
import { setQueue } from '../player';

const st = computed(() => ui.search);

const sourceLabel = computed(
  () => (SOURCES.find((s) => s.value === st.value.source) || {}).label || st.value.source
);

const hint = computed(() => {
  if (st.value.loading && !st.value.tracks.length) return '搜索中…';
  return `${sourceLabel.value}${st.value.album ? ' · 专辑模式' : ''} · 共 ${st.value.tracks.length} 首${
    st.value.done ? '' : '+'
  }`;
});

function play(i) {
  setQueue(st.value.tracks, i, true);
}

function loadMore() {
  runSearch(st.value.q, { append: true });
}
</script>

<template>
  <section class="view">
    <div class="section-head">
      <h2>{{ st.q ? `“${st.q}” 的搜索结果` : '搜索结果' }}</h2>
      <span class="hint">{{ hint }}</span>
    </div>

    <div v-if="st.loading && !st.tracks.length" class="empty">搜索中…</div>
    <TrackList
      v-else
      :tracks="st.tracks"
      empty-text="没有找到相关歌曲，换个关键词试试"
      @play="play"
    />

    <div v-if="!st.done && st.tracks.length" class="load-more-wrap">
      <button class="btn ghost" :disabled="st.loading" @click="loadMore">
        {{ st.loading ? '加载中…' : '加载更多' }}
      </button>
    </div>
  </section>
</template>
