<script setup>
import { ref, watch, nextTick } from 'vue';
import { modal, resolveModal } from '../ui';

const inputEl = ref(null);

watch(
  () => modal.open,
  async (open) => {
    if (!open || !modal.input) return;
    await nextTick();
    if (inputEl.value) {
      inputEl.value.focus();
      inputEl.value.select();
    }
  }
);

function ok() {
  if (modal.input) {
    const v = String(modal.value || '').trim();
    resolveModal(v || null);
  } else {
    resolveModal('ok');
  }
}

function cancel() {
  resolveModal(modal.input ? null : 'cancel');
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modal.open" class="modal-layer" @click.self="cancel">
      <div class="modal in">
        <h3>{{ modal.title }}</h3>
        <div class="modal-body">
          <input
            v-if="modal.input"
            ref="inputEl"
            v-model="modal.value"
            class="modal-input"
            :placeholder="modal.placeholder"
            maxlength="60"
            @keydown.enter.prevent="ok"
            @keydown.esc.prevent="cancel"
          />
          <div v-else class="modal-text">{{ modal.text }}</div>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" @click="cancel">{{ modal.cancelText }}</button>
          <button class="btn primary" @click="ok">{{ modal.okText }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
