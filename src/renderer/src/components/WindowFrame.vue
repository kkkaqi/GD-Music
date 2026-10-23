<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { installWindowGestures } from '../window-gestures';
const maximized = ref(false);
const edges = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];
let dispose, offMaximized;
onMounted(async () => {
  dispose = installWindowGestures(window.bridge.win);
  offMaximized = window.bridge.win.onMaximized(value => { maximized.value = value; });
  maximized.value = await window.bridge.win.isMaximized();
});
onBeforeUnmount(() => { dispose?.(); offMaximized?.(); });
</script>

<template>
  <template v-if="!maximized">
    <div v-for="edge in edges" :key="edge" class="window-resize" :class="'window-resize-' + edge"
      :data-window-resize="edge" aria-hidden="true"></div>
  </template>
</template>
