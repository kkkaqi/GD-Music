<script setup>
import { ref, computed } from 'vue';
import Icon from './Icon.vue';
import SliderBar from './SliderBar.vue';
import { desktopLyrics, toggleDesktopLyrics } from '../desktop-lyrics-sync';
import { S, ui, fmtTime, QUALITIES, isLiked, toggleLike, currentTrack } from '../store';
import {
  player,
  audio,
  togglePlay,
  next,
  prev,
  cycleMode,
  setQuality,
  seekRatio,
  setVolume,
  toggleMute,
} from '../player';

const dragRatio = ref(null);

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

const muted = ref(false);
const volDrag = ref(null);

const volRatio = computed(() => (volDrag.value !== null ? volDrag.value : S.volume));

function onProgressInput(v) {
  dragRatio.value = v;
}

function onProgressChange(v) {
  seekRatio(v);
  dragRatio.value = null;
}

function onVolumeInput(v) {
  volDrag.value = v;
  audio.volume = v;
  audio.muted = false;
  muted.value = false;
}

function onVolumeChange(v) {
  volDrag.value = null;
  setVolume(v);
}

function doMute() {
  toggleMute();
  muted.value = audio.muted;
}

function likeCurrent() {
  if (currentTrack.value) toggleLike(currentTrack.value);
}
</script>

<template>
  <footer class="player">
    <div class="pl-left">
      <div class="cover" :class="{ 'has-cover': !!player.cover, loading: player.buffering }">
        <img :src="player.cover" :class="{ ready: !!player.cover }" alt="" />
        <span class="cover-ph"><Icon name="music" /></span>
        <button class="cover-expand" title="播放页" @click="ui.npOpen = true">
          <Icon name="expand" />
        </button>
      </div>
      <div class="pl-meta">
        <div class="pl-title">{{ currentTrack ? currentTrack.name : '未在播放' }}</div>
        <div class="pl-artist">
          {{ currentTrack ? currentTrack.artist.join(' / ') || '未知歌手' : '挑一首歌开始吧' }}
        </div>
      </div>
      <button
        class="icon-btn"
        :class="{ liked: isLiked(currentTrack) }"
        title="喜欢"
        @click="likeCurrent"
      >
        <Icon :name="isLiked(currentTrack) ? 'heart-fill' : 'heart'" />
      </button>
    </div>

    <div class="pl-center">
      <div class="controls">
        <button class="icon-btn" :class="{ active: S.mode !== 'order' }" :title="S.mode === 'single' ? '单曲循环' : S.mode === 'shuffle' ? '随机播放' : '列表循环'" @click="cycleMode">
          <Icon :name="modeIcon" />
        </button>
        <button class="icon-btn" title="上一首" @click="prev">
          <Icon name="prev" />
        </button>
        <button class="play-btn" :title="player.playing ? '暂停' : '播放'" @click="togglePlay">
          <Icon :name="player.playing ? 'pause' : 'play'" />
        </button>
        <button class="icon-btn" title="下一首" @click="next(false)">
          <Icon name="next" />
        </button>
        <select class="quality-btn" aria-label="选择音质" title="选择音质" :value="S.quality" @change="setQuality($event.target.value)">
          <option v-for="quality in QUALITIES" :key="quality.value" :value="quality.value">{{ quality.label }} · {{ quality.desc }}</option>
        </select>
      </div>

      <div class="progress-row">
        <span class="time">{{ fmtTime(curTime) }}</span>
        <SliderBar
          :value="ratio"
          @update:value="onProgressInput"
          @change="onProgressChange"
        />
        <span class="time">{{ fmtTime(player.duration) }}</span>
      </div>
    </div>

    <div class="pl-right">
      <button class="icon-btn desktop-lyrics-toggle" :class="{ active: desktopLyrics.visible }"
        :title="desktopLyrics.locked && desktopLyrics.visible ? '解锁桌面歌词' : '桌面歌词'"
        :aria-pressed="desktopLyrics.visible" @click="toggleDesktopLyrics">词</button>
      <button class="icon-btn" :class="{ active: ui.queueOpen }" title="播放队列" @click="ui.queueOpen = !ui.queueOpen">
        <Icon name="list" />
      </button>
      <div class="volume">
        <button class="icon-btn" title="静音" @click="doMute">
          <Icon :name="muted || S.volume === 0 ? 'volume-mute' : 'volume'" />
        </button>
        <SliderBar :value="volRatio" small @update:value="onVolumeInput" @change="onVolumeChange" />
      </div>
    </div>
  </footer>
</template>
