<script setup>
import Icon from './Icon.vue';
import {
  S,
  ui,
  goDiscover,
  goSearchView,
  openCollection,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  collectionTracks,
  importPlaylistConfig,
  exportPlaylistConfig,
} from '../store';
import { promptText, confirmModal, openMenu, toast, focusSearchEl } from '../ui';
import { setQueue } from '../player';

function isActive(kind) {
  if (kind === 'discover') return ui.view === 'discover';
  if (kind === 'search') return ui.view === 'search';
  return ui.view === 'collection' && ui.collection && ui.collection.type === kind;
}

function isPlaylistActive(id) {
  return ui.view === 'collection' && ui.collection && ui.collection.type === 'playlist' && ui.collection.id === id;
}

function openPlaylist(id) {
  openCollection({ type: 'playlist', id });
}

function clickSearch() {
  goSearchView();
  focusSearchEl();
}

async function newPlaylist() {
  const name = await promptText({
    title: '新建歌单',
    placeholder: '给歌单起个名字',
    okText: '创建',
  });
  if (!name) return;
  const pl = createPlaylist(name);
  if (!pl) {
    toast('名字不能为空', 'err');
    return;
  }
  toast(`歌单《${pl.name}》已创建`, 'ok');
  openPlaylist(pl.id);
}

async function playlistMenu(e, pl) {
  e.preventDefault();
  openMenu(e.clientX, e.clientY, [
    {
      label: '播放歌单',
      icon: 'play',
      action: () => {
        const tracks = collectionTracks({ type: 'playlist', id: pl.id });
        if (!tracks.length) return toast('歌单是空的');
        setQueue(tracks, 0, true);
      },
    },
    {
      label: '重命名',
      icon: 'external',
      action: async () => {
        const name = await promptText({ title: '重命名歌单', value: pl.name, okText: '保存' });
        if (!name) return;
        renamePlaylist(pl.id, name);
        toast('已重命名', 'ok');
      },
    },
    {
      label: '导出歌单配置',
      icon: 'upload',
      action: () => exportPlaylistConfig(pl.id),
    },
    { separator: true },
    {
      label: '删除歌单',
      icon: 'trash',
      danger: true,
      action: async () => {
        const ok = await confirmModal({
          title: '删除歌单',
          text: `确定删除《${pl.name}》吗？此操作不可撤销。`,
          okText: '删除',
        });
        if (!ok) return;
        deletePlaylist(pl.id);
        if (isPlaylistActive(pl.id)) goDiscover();
        toast('歌单已删除', 'ok');
      },
    },
  ]);
}
</script>

<template>
  <aside class="sidebar">
    <nav class="menu">
      <div class="menu-group">
        <div class="menu-title">在线音乐</div>
        <button class="menu-item" :class="{ active: isActive('discover') }" @click="goDiscover">
          <span class="mi-icon"><Icon name="compass" /></span><span>发现音乐</span>
        </button>
        <button class="menu-item" :class="{ active: isActive('search') }" @click="clickSearch">
          <span class="mi-icon"><Icon name="search" /></span><span>搜索</span>
        </button>
      </div>

      <div class="menu-group">
        <div class="menu-title">我的音乐</div>
        <button class="menu-item" :class="{ active: isActive('favorites') }" @click="openCollection({ type: 'favorites' })">
          <span class="mi-icon"><Icon name="heart" /></span><span>我喜欢的音乐</span>
          <span class="mi-count">{{ S.favorites.length || '' }}</span>
        </button>
        <button class="menu-item" :class="{ active: isActive('recent') }" @click="openCollection({ type: 'recent' })">
          <span class="mi-icon"><Icon name="clock" /></span><span>最近播放</span>
          <span class="mi-count">{{ S.recent.length || '' }}</span>
        </button>
      </div>

      <div class="menu-group">
        <div class="menu-title">
          <span>我的歌单</span>
          <span class="mt-actions">
            <button class="mini-btn" title="导入歌单配置" @click="importPlaylistConfig()"><Icon name="download" /></button>
            <button class="mini-btn" title="新建歌单" @click="newPlaylist"><Icon name="plus" /></button>
          </span>
        </div>
        <div class="playlist-nav">
          <div v-if="!S.playlists.length" class="nav-empty">还没有歌单</div>
          <button
            v-for="pl in S.playlists"
            :key="pl.id"
            class="menu-item sub"
            :class="{ active: isPlaylistActive(pl.id) }"
            @click="openPlaylist(pl.id)"
            @contextmenu="playlistMenu($event, pl)"
          >
            <span class="mi-icon"><Icon name="folder" /></span>
            <span class="pl-name">{{ pl.name }}</span>
            <span class="mi-count">{{ pl.tracks.length || '' }}</span>
          </button>
        </div>
      </div>
    </nav>

    <div class="side-foot">
      <div class="credit">
        <div class="credit-line">数据来源 <b>GD 音乐台</b></div>
        <div class="credit-sub">仅供学习 · 请勿商用（CC BY-NC 4.0）</div>
      </div>
    </div>
  </aside>
</template>
