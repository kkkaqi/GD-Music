<script setup>
import { ref, watch, nextTick } from 'vue';
import Icon from './Icon.vue';
import { menu, closeMenu } from '../ui';

const el = ref(null);
const pos = ref({ x: 0, y: 0 });

watch(
  () => menu.open,
  async (open) => {
    if (!open) return;
    pos.value = { x: menu.x, y: menu.y };
    await nextTick();
    if (!el.value) return;
    const rect = el.value.getBoundingClientRect();
    pos.value = {
      x: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
    };
  }
);

async function run(item) {
  if (item.disabled) return;
  closeMenu();
  if (typeof item.action === 'function') await item.action();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="menu.open"
      ref="el"
      class="context-menu in"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    >
      <template v-for="(item, i) in menu.items" :key="i">
        <div v-if="item.separator" class="menu-sep"></div>
        <button
          v-else
          class="menu-item"
          :class="{ danger: item.danger, disabled: item.disabled }"
          @click="run(item)"
        >
          <span class="mi-icon"><Icon v-if="item.icon" :name="item.icon" /></span>
          <span class="mi-label">{{ item.label }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>
