<script setup>
import { ref, onMounted } from 'vue';
import Icon from './Icon.vue';
import {
  S,
  ui,
  SOURCES,
  canBack,
  canForward,
  goBack,
  goForward,
  runSearch,
  setSearchSource,
  toggleAlbum,
  goSearchView,
} from '../store';
import { showModal, focusSearchEl } from '../ui';
import { Api } from '../api';

const q = ref(ui.search.q || '');
const maximized = ref(false);
const win = window.bridge.win;

onMounted(async () => {
  try {
    maximized.value = await win.isMaximized();
  } catch {
    /* ignore */
  }
  win.onMaximized((v) => {
    maximized.value = v;
  });
});

function minimize() {
  win.minimize();
}
function toggleMax() {
  win.toggleMaximize();
}
function closeWin() {
  win.close();
}

function onEnter() {
  if (!q.value.trim()) {
    goSearchView();
    return;
  }
  runSearch(q.value);
}

function clearInput() {
  q.value = '';
  focusSearchEl();
}

function onSource(e) {
  setSearchSource(e.target.value);
}

async function showAbout() {
  const info = await Api.app.info().catch(() => null);
  const r = await showModal({
    title: '关于 GD Music',
    okText: '关闭',
    cancelText: '打开数据目录',
    text: `GD Music 是一个基于 Electron + Vue 3 的桌面音乐播放器。

本软件仅供学习交流，请勿商用。音乐数据来自第三方接口，版权归原作者所有。
数据来源：GD 音乐台（music.gdstudio.xyz），许可 CC BY-NC 4.0。

版本：${info ? info.version : '—'}
Electron：${info ? info.electron : '—'}
Vue：3.x
Chromium：${info ? info.chrome : '—'}
数据目录：${info ? info.userData : '—'}`,
  });
  if (r === 'cancel') Api.app.showUserData();
}
</script>

<template>
  <header class="titlebar">
    <div class="tb-left">
      <div class="brand">
        <span class="brand-mark"></span>
        <span class="brand-name">GD Music</span>
      </div>
      <div class="nav-btns">
        <button class="icon-btn sm" :disabled="!canBack" title="后退" @click="goBack">
          <Icon name="chevron-left" />
        </button>
        <button class="icon-btn sm" :disabled="!canForward" title="前进" @click="goForward">
          <Icon name="chevron-right" />
        </button>
      </div>
    </div>

    <div class="tb-center">
      <div class="searchbox">
        <span class="searchbox-icon"><Icon name="search" /></span>
        <input
          id="searchInput"
          v-model="q"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="搜索歌曲、歌手、专辑"
          @keydown.enter.prevent="onEnter"
          @keydown.esc="$event.target.blur()"
        />
        <button v-show="q" class="searchbox-clear" title="清空" @click="clearInput">
          <Icon name="x" />
        </button>
        <div class="search-opts">
          <label class="chk" title="按专辑聚合搜索">
            <input type="checkbox" :checked="ui.search.album" :disabled="!SOURCES.find(s => s.value === S.source)?.album" @change="toggleAlbum" />
            <span>专辑</span>
          </label>
          <select :value="S.source" title="音乐源" @change="onSource">
            <option v-for="s in SOURCES" :key="s.value" :value="s.value">
              {{ s.label }}{{ s.open ? '' : '（未开放）' }}
            </option>
          </select>
        </div>
      </div>
    </div>

    <div class="tb-right">
      <button class="icon-btn sm" title="关于" @click="showAbout">
        <Icon name="info" />
      </button>
      <div class="win-controls">
        <button class="win-btn" title="最小化" @click="minimize">
          <Icon name="win-min" />
        </button>
        <button class="win-btn" :title="maximized ? '还原' : '最大化'" @click="toggleMax">
          <Icon :name="maximized ? 'win-restore' : 'win-max'" />
        </button>
        <button class="win-btn close" title="关闭" @click="closeWin">
          <Icon name="win-close" />
        </button>
      </div>
    </div>
  </header>
</template>
