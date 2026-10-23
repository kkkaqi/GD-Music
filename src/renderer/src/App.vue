<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import TitleBar from './components/TitleBar.vue';
import Sidebar from './components/Sidebar.vue';
import DiscoverView from './components/DiscoverView.vue';
import SearchView from './components/SearchView.vue';
import CollectionView from './components/CollectionView.vue';
import PlayerBar from './components/PlayerBar.vue';
import NowPlaying from './components/NowPlaying.vue';
import QueuePanel from './components/QueuePanel.vue';
import ContextMenu from './components/ContextMenu.vue';
import ModalHost from './components/ModalHost.vue';
import ToastHost from './components/ToastHost.vue';
import WindowFrame from './components/WindowFrame.vue';

import { S, ui, loadState, goDiscover, refreshQuota, currentTrack, coverUrl, serialize } from './store';
import { player, audio, togglePlay, nudge, setVolume } from './player';
import { menu, modal, closeMenu, resolveModal, focusSearchEl } from './ui';
import { Api } from './api';
import { initDesktopLyrics } from './desktop-lyrics-sync';
let stopDesktopLyrics;
let stopBeforeQuit;

const contentEl = ref(null);

watch(
  () => ui.view,
  () => {
    if (contentEl.value) contentEl.value.scrollTop = 0;
  }
);

watch(
  () => player.playing,
  (v) => document.body.classList.toggle('playing', !!v),
  { immediate: true }
);

function onKey(e) {
  const tag = (e.target.tagName || '').toUpperCase();
  const typing =
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;

  if (e.key === 'Escape') {
    if (modal.open) {
      resolveModal(modal.input ? null : 'cancel');
      return;
    }
    if (menu.open) return closeMenu();
    if (ui.npOpen) {
      ui.npOpen = false;
      return;
    }
    if (ui.queueOpen) {
      ui.queueOpen = false;
      return;
    }
    return;
  }
  if (typing) return;

  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    nudge(5);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    nudge(-5);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setVolume(S.volume + 0.05);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    setVolume(S.volume - 0.05);
  } else if (e.key === '/') {
    e.preventDefault();
    focusSearchEl();
  }
}

function onDocClick(e) {
  if (menu.open && !e.target.closest('.context-menu')) closeMenu();
}

function onCtx(e) {
  if (
    !e.target.closest('.trow') &&
    !e.target.closest('.qrow') &&
    !e.target.closest('.menu-item') &&
    !e.target.closest('input')
  ) {
    e.preventDefault();
  }
}

function onUnload() {
  return Api.state.save(JSON.parse(JSON.stringify(serialize())));
}

async function boot() {
  await loadState();
  audio.volume = Math.min(Math.max(S.volume, 0), 1);
  if (S.queue.length) {
    const t = currentTrack.value;
    if (t) {
      coverUrl(t).then((u) => {
        if (u) player.cover = u;
      });
    }
    player.position = S.lastTime || 0;
  }
  goDiscover();
  refreshQuota();
}

onMounted(() => {
  stopDesktopLyrics = initDesktopLyrics();
  stopBeforeQuit = window.bridge.app.onBeforeQuit(onUnload);
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onDocClick);
  document.addEventListener('contextmenu', onCtx);
  window.addEventListener('beforeunload', onUnload);
  boot();
});

onBeforeUnmount(() => {
  stopDesktopLyrics?.();
  stopBeforeQuit?.();
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('contextmenu', onCtx);
  window.removeEventListener('beforeunload', onUnload);
});
</script>

<template>
  <div class="app">
    <TitleBar />
    <div class="body">
      <Sidebar />
      <main ref="contentEl" class="content">
        <DiscoverView v-if="ui.view === 'discover'" />
        <SearchView v-else-if="ui.view === 'search'" />
        <CollectionView v-else-if="ui.view === 'collection'" />
      </main>
    </div>
    <PlayerBar />
  </div>

  <NowPlaying />
  <QueuePanel />
  <ContextMenu />
  <ModalHost />
  <ToastHost />
  <WindowFrame />
</template>
