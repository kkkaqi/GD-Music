<script setup>
import { computed } from 'vue';
import Icon from './Icon.vue';
import { S, ui, SOURCES, keyOf, pad, isLiked, toggleLike, createPlaylist, addToPlaylist, removeFromPlaylist } from '../store';
import { openMenu, promptText, toast } from '../ui';
import { Api } from '../api';
import { enqueue, playNextAndGo, loadAndPlay, isCurrent } from '../player';
const props = defineProps({
  tracks: { type: Array, default: () => [] },
  removable: { type: Boolean, default: false },
  emptyText: { type: String, default: '这里还空着' },
});

const emit = defineEmits(['play', 'remove']);

const list = computed(() => props.tracks || []);

function playAt(i) {
  emit('play', i);
}

function playNow(track) {
  const i = S.queue.findIndex((t) => keyOf(t) === keyOf(track));
  if (i >= 0) {
    S.queueIndex = i;
    loadAndPlay(true);
  } else {
    playNextAndGo(track);
  }
}

function like(track) {
  toggleLike(track);
}

function copyTrack(track) {
  const text = `${track.name} - ${track.artist.join('/')}`;
  navigator.clipboard.writeText(text).then(
    () => toast('已复制到剪贴板', 'ok'),
    () => toast('复制失败', 'err')
  );
}

async function download(track) {
  toast('开始下载…');
  try {
    const res = await Api.file.downloadTrack({
      source: track.source,
      id: track.id,
      url_id: track.url_id,
      br: S.quality,
      name: track.name,
      artist: track.artist.join('/'),
    });
    if (res && res.saved) toast(`已保存：${res.filePath}`, 'ok');
  } catch (err) {
    toast(err.message || '下载失败', 'err');
  }
}

async function newPlaylistWith(track) {
  const name = await promptText({ title: '新建歌单', placeholder: '给歌单起个名字', okText: '创建' });
  if (!name) return;
  const pl = createPlaylist(name);
  if (!pl) return toast('名字不能为空', 'err');
  addToPlaylist(pl.id, track);
}

function playlistSubmenu(x, y, track) {
  const items = S.playlists.map((pl) => ({
    label: pl.name,
    icon: 'folder',
    action: () => addToPlaylist(pl.id, track),
  }));
  items.push({ separator: true });
  items.push({ label: '新建歌单…', icon: 'plus', action: () => newPlaylistWith(track) });
  openMenu(x, y, items);
}

function rowMenu(e, track) {
  e.preventDefault();
  e.stopPropagation();
  const x = e.clientX;
  const y = e.clientY;
  const items = [
    { label: '立即播放', icon: 'play', action: () => playNow(track) },
    { label: '下一首播放', icon: 'next', action: () => enqueue(track, true) },
    { label: '加入播放队列', icon: 'list', action: () => enqueue(track, false) },
    { separator: true },
    {
      label: isLiked(track) ? '取消喜欢' : '喜欢',
      icon: isLiked(track) ? 'heart-fill' : 'heart',
      action: () => toggleLike(track),
    },
    { label: '添加到歌单', icon: 'folder', action: () => playlistSubmenu(x, y, track) },
    ...(SOURCES.find(s => s.value === track.source)?.download === false ? [] :
      [{ label: '下载', icon: 'download', action: () => download(track) }]),
  ];
  if (props.removable) {
    items.push({ separator: true });
    items.push({
      label: '从当前歌单移除',
      icon: 'trash',
      danger: true,
      action: () => {
        if (ui.collection && ui.collection.type === 'playlist') {
          removeFromPlaylist(ui.collection.id, track);
          toast('已移除', 'ok');
        } else if (ui.collection && ui.collection.type === 'favorites') {
          if (isLiked(track)) toggleLike(track);
        } else {
          emit('remove', track);
        }
      },
    });
  }
  items.push({ separator: true });
  items.push({ label: '复制歌名', icon: 'external', action: () => copyTrack(track) });
  openMenu(x, y, items);
}

defineExpose({ playNow });
</script>

<template>
  <div class="track-list">
    <div v-if="!list.length" class="empty">{{ emptyText }}</div>
    <div
      v-for="(t, i) in list"
      :key="keyOf(t) + '-' + i"
      class="trow"
      :class="{ current: isCurrent(t) }"
      @click="playAt(i)"
      @contextmenu="rowMenu($event, t)"
    >
      <div class="c-idx">
        <span class="num">{{ pad(i + 1) }}</span>
        <span class="idx-play"><Icon name="play" /></span>
        <span class="bars"><i></i><i></i><i></i></span>
      </div>

      <div class="c-name">
        <span class="name">{{ t.name }}</span>
        <span v-if="t.album" class="album-inline">{{ t.album }}</span>
      </div>

      <div class="c-artist">{{ t.artist.join(' / ') || '未知' }}</div>
      <div class="c-album">{{ t.album || '—' }}</div>

      <div class="c-actions" @click.stop>
        <button
          class="icon-btn xs like"
          :class="{ liked: isLiked(t) }"
          title="喜欢"
          @click="like(t)"
        >
          <Icon :name="isLiked(t) ? 'heart-fill' : 'heart'" />
        </button>
        <button class="icon-btn xs more" title="更多" @click="rowMenu($event, t)">
          <Icon name="more" />
        </button>
      </div>
    </div>
  </div>
</template>
