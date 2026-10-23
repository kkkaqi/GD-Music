<script setup>
import { toasts } from '../ui';
</script>

<template>
  <div class="toasts">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast in" :class="t.kind">{{ t.msg }}</div>
    </TransitionGroup>
  </div>
</template>
