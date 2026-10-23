<script setup>
import Icon from './Icon.vue';
import { S, ui, pad, keyOf } from '../store';
import { loadAndPlay, removeFromQueue, clearQueue, isCurrent } from '../player';
import { toast } from '../ui';

function play(i) {
  S.queueIndex = i;
  loadAndPlay(true);
}

function remove(i) {
  removeFromQueue(i);
}

function clearAll() {
  if (!S.queue.length) return;
  clearQueue();
  toast('队列已清空');
}
</script>

<template>
  <aside v-show="ui.queueOpen" class="queue-panel" :class="{ in: ui.queueOpen }">
    <div class="queue-head">
      <h3>播放队列 <span class="count">{{ S.queue.length }}</span></h3>
      <div class="queue-head-actions">
        <button class="link-btn" @click="clearAll">清空</button>
        <button class="icon-btn sm" title="关闭" @click="ui.queueOpen = false">
          <Icon name="x" />
        </button>
      </div>
    </div>

    <div class="queue-list">
      <div v-if="!S.queue.length" class="empty small">队列是空的</div>
      <div
        v-for="(t, i) in S.queue"
        :key="keyOf(t) + '-' + i"
        class="qrow"
        :class="{ current: isCurrent(t) }"
        @click="play(i)"
      >
        <span class="q-idx">{{ pad(i + 1) }}</span>
        <div class="q-meta">
          <div class="q-name">{{ t.name }}</div>
          <div class="q-artist">{{ t.artist.join(' / ') }}</div>
        </div>
        <button class="icon-btn xs q-del" title="移出队列" @click.stop="remove(i)">
          <Icon name="x" />
        </button>
      </div>
    </div>
  </aside>
</template>
