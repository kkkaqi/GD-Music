<script setup>
import { computed } from 'vue';
import { ICONS } from '../icons';

const props = defineProps({
  name: { type: String, required: true },
});

const svg = computed(() => ICONS[props.name] || '');
</script>

<template>
  <span class="ic" v-html="svg"></span>
</template>
