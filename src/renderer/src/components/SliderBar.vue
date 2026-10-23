<script setup>
import { ref } from 'vue';

defineProps({
  value: { type: Number, default: 0 },
  small: { type: Boolean, default: false },
});

const emit = defineEmits(['update:value', 'change']);

const barEl = ref(null);
let dragging = false;
let ratio = 0;

function ratioFrom(clientX) {
  const r = barEl.value.getBoundingClientRect();
  return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
}

function down(e) {
  dragging = true;
  barEl.value.classList.add('dragging');
  try {
    barEl.value.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  ratio = ratioFrom(e.clientX);
  emit('update:value', ratio);
}

function move(e) {
  if (!dragging) return;
  ratio = ratioFrom(e.clientX);
  emit('update:value', ratio);
}

function up(e) {
  if (!dragging) return;
  dragging = false;
  barEl.value.classList.remove('dragging');
  try {
    barEl.value.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  emit('change', ratio);
}
</script>

<template>
  <div
    ref="barEl"
    class="bar"
    :class="{ small }"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
  >
    <div class="bar-track">
      <div class="bar-fill" :style="{ width: Math.min(100, Math.max(0, value * 100)) + '%' }"></div>
    </div>
    <div class="bar-thumb" :style="{ left: Math.min(100, Math.max(0, value * 100)) + '%' }"></div>
  </div>
</template>
