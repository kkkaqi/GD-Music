<script setup>
import { ref, watch, computed } from 'vue';
import Icon from './Icon.vue';
import SliderBar from './SliderBar.vue';
import { S, ui, currentTrack, QUALITIES, isLiked, toggleLike, fmtTime } from '../store';
import { player, seekSeconds, cycleQuality, togglePlay, next, prev, cycleMode, seekRatio } from '../player';

const scrollEl = ref(null);
const dragRatio = ref(null);

const bgStyle = computed(() =>
  player.cover ? { backgroundImage: `url("${player.cover}")` } : {}
);

const qualityLabel = computed(
  () => (QUALITIES.find((q) => q.value === S.quality) || QUALITIES.find((q) => q.value === '320')).label
);

const ratio = computed(() => {
  if (dragRatio.value !== null) return dragRatio.value;
  if (!player.duration) return 0;
  return Math.min(1, player.position / player.duration);
});

const curTime = computed(() =>
  dragRatio.value !== null && player.duration ? dragRatio.value * player.duration : player.position
);

const modeIcon = computed(() =>
  S.mode === 'single' ? 'repeat-one' : S.mode === 'shuffle' ? 'shuffle' : 'repeat'
);

function onProgressChange(v) {
  seekRatio(v);
  dragRatio.value = null;
}

watch(
  () => player.active,
  (idx) => {
    const box = scrollEl.value;
    if (!box || idx < 0) return;
    const node = box.children[idx];
    if (!node) return;
    const top = node.offsetTop - box.clientHeight * 0.42 + node.clientHeight / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
);

function likeCurrent() {
  if (currentTrack.value) toggleLike(currentTrack.value);
}

function distance(i) {
  return Math.abs(i - player.active);
}
</script>

<template>
  <div v-show="ui.npOpen" class="np-page" :class="{ in: ui.npOpen }">
    <div class="np-bg" :style="bgStyle"></div>
    <div class="np-veil"></div>

    <button class="np-close" title="收起" @click="ui.npOpen = false">
      <Icon name="chevron-down" />
    </button>

    <div class="np-body">
      <div class="np-left">
        <div class="np-disc" :class="{ spin: player.playing }" @click="togglePlay">
          <img v-if="player.cover" :src="player.cover" class="ready" alt="" />
          <div class="np-disc-hole"></div>
        </div>
        <div class="np-info">
          <h1>{{ currentTrack ? currentTrack.name : '未在播放' }}</h1>
          <div class="np-artist">
            {{
              currentTrack
                ? currentTrack.artist.join(' / ') + (currentTrack.album ? ' · ' + currentTrack.album : '')
                : ''
            }}
          </div>
          <div class="np-tools">
            <button
              class="icon-btn lg"
              :class="{ liked: isLiked(currentTrack) }"
              title="喜欢"
              @click="likeCurrent"
            >
              <Icon :name="isLiked(currentTrack) ? 'heart-fill' : 'heart'" />
            </button>
            <button class="icon-btn lg" title="音质" @click="cycleQuality">{{ qualityLabel }}</button>
          </div>
        </div>
      </div>

      <div class="np-right">
        <div class="lyrics">
          <div v-if="!player.lines.length" class="lyrics-empty">
            {{ player.lyricLoading ? '歌词加载中…' : '暂无歌词' }}
          </div>
          <div ref="scrollEl" class="lyrics-scroll">
            <div
              v-for="(l, i) in player.lines"
              :key="i"
              class="ly-line"
              :class="{
                active: i === player.active,
                near: distance(i) === 1,
                far: distance(i) > 3,
              }"
              @click="seekSeconds(l.t)"
            >
              <span class="ly-text">{{ l.text }}</span>
              <span v-if="l.tr && S.showTranslation" class="ly-tr">{{ l.tr }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="np-controls">
      <div class="np-progress">
        <span class="time">{{ fmtTime(curTime) }}</span>
        <SliderBar :value="ratio" @update:value="dragRatio = $event" @change="onProgressChange" />
        <span class="time">{{ fmtTime(player.duration) }}</span>
      </div>
      <div class="np-btns">
        <button
          class="icon-btn"
          :class="{ active: S.mode !== 'order' }"
          :title="S.mode === 'single' ? '单曲循环' : S.mode === 'shuffle' ? '随机播放' : '列表循环'"
          @click="cycleMode"
        >
          <Icon :name="modeIcon" />
        </button>
        <button class="icon-btn lg" title="上一首" @click="prev"><Icon name="prev" /></button>
        <button class="play-btn lg" :title="player.playing ? '暂停' : '播放'" @click="togglePlay">
          <Icon :name="player.playing ? 'pause' : 'play'" />
        </button>
        <button class="icon-btn lg" title="下一首" @click="next(false)"><Icon name="next" /></button>
        <button class="icon-btn" title="播放队列" @click="ui.queueOpen = !ui.queueOpen">
          <Icon name="list" />
        </button>
      </div>
    </div>
  </div>
</template>
