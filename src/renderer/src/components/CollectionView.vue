<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { Api } from '../api';
import Icon from './Icon.vue';
import TrackList from './TrackList.vue';
import {
  S,
  ui,
  collectionTracks,
  collectionMeta,
  coverUrl,
  deletePlaylist,
  goDiscover,
  openCollection,
  refreshQuota,
  saveImportedAsPlaylist,
} from '../store';
import { setQueue } from '../player';
import { toast, confirmModal, promptText } from '../ui';

const cover = ref('');
const downloads = ref(null);
let downloadTimer;
async function refreshDownloads() {
  if (spec.value?.type !== 'favorites') return;
  try { downloads.value = await Api.audio.status(); } catch {}
}
async function retryDownloads() {
  try { downloads.value = await Api.audio.retry(); } catch (err) { toast(err.message, 'err'); }
}
onMounted(() => { refreshDownloads(); downloadTimer = setInterval(refreshDownloads, 1500); });
onBeforeUnmount(() => clearInterval(downloadTimer));

const spec = computed(() => ui.collection);
const meta = computed(() => collectionMeta(spec.value));
const tracks = computed(() => collectionTracks(spec.value));
const canDelete = computed(() => !!spec.value && spec.value.type === 'playlist');
const isImport = computed(() => !!spec.value && spec.value.type === 'import');
const removable = computed(
  () => !!spec.value && (spec.value.type === 'playlist' || spec.value.type === 'favorites')
);

const emptyText = computed(() => {
  const t = spec.value && spec.value.type;
  if (t === 'favorites') return '点歌曲右侧的 ♡ 收藏，就会出现在这里';
  if (t === 'recent') return '还没有播放记录';
  return '歌单是空的，去搜索页加几首歌吧';
});

async function refreshCover() {
  if (spec.value && spec.value.cover) {
    cover.value = spec.value.cover;
    return;
  }
  const first = tracks.value.find((t) => t.pic_id || t.pic);
  cover.value = first ? await coverUrl(first) : '';
}

watch(() => (spec.value ? spec.value.id + ':' + spec.value.type : ''), refreshCover, {
  immediate: true,
});

onMounted(refreshQuota);

function playAll() {
  if (!tracks.value.length) {
    toast('这里还没有歌曲');
    return;
  }
  setQueue(tracks.value, 0, true);
}

function queueAll() {
  if (!tracks.value.length) return;
  S.queue.push(...tracks.value.map((t) => ({ ...t })));
  toast(`已加入 ${tracks.value.length} 首到队列`, 'ok');
}

async function saveAsPlaylist() {
  if (!tracks.value.length) return;
  const name = await promptText({
    title: '存为我的歌单',
    value: meta.value.title,
    placeholder: '给歌单起个名字',
    okText: '保存',
  });
  if (!name) return;
  const pl = saveImportedAsPlaylist(name, tracks.value);
  if (!pl) return toast('名字不能为空', 'err');
  toast(`已保存到《${pl.name}》`, 'ok');
  openCollection({ type: 'playlist', id: pl.id });
}

async function removePlaylist() {
  if (!spec.value) return;
  const ok = await confirmModal({
    title: '删除歌单',
    text: `确定删除《${meta.value.title}》吗？此操作不可撤销。`,
    okText: '删除',
  });
  if (!ok) return;
  deletePlaylist(spec.value.id);
  goDiscover();
  toast('歌单已删除', 'ok');
}

async function exportList() {
  const title = meta.value.title;
  const text =
    title +
    '\n\n' +
    tracks.value.map((t, i) => `${i + 1}. ${t.name} - ${t.artist.join('/')}`).join('\n');
  const r = await window.bridge.file.exportText({ name: title + '.txt', text });
  if (r && r.ok && r.data && r.data.saved) toast('已导出', 'ok');
}

function playAt(i) {
  setQueue(tracks.value, i, true);
}
</script>

<template>
  <section v-if="spec" class="view">
    <div class="coll-head">
      <div class="coll-cover">
        <img v-if="cover" :src="cover" alt="" />
        <Icon v-else name="music" />
      </div>
      <div class="coll-info">
        <div class="coll-kind">{{ meta.kind }}</div>
        <h1 class="coll-title">{{ meta.title }}</h1>
        <div class="coll-meta">{{ meta.meta }}</div>
        <div v-if="spec.type === 'favorites' && downloads" class="coll-meta" role="status">
          音频已下载 {{ downloads.ready }}/{{ downloads.total }} 首
          <span v-if="downloads.streamOnly"> · {{ downloads.streamOnly }} 首仅支持在线播放</span>
          <span v-if="downloads.waitSeconds"> · {{ downloads.waitReason }}（约 {{ downloads.waitSeconds }} 秒）</span>
          <span v-else-if="downloads.active"> · 正在下载：{{ downloads.active }}</span>
          <span v-if="downloads.retrying"> · {{ downloads.retrying }} 首等待自动重试</span>
          <span v-if="downloads.failed"> · {{ downloads.failed }} 首失败 <button class="link-btn" @click="retryDownloads">重试</button></span>
          · <button class="link-btn" @click="Api.audio.folder()">打开音频文件夹</button>
        </div>
        <div class="coll-actions">
          <button class="btn primary" @click="playAll"><Icon name="play" />播放全部</button>
          <button class="btn ghost" @click="queueAll"><Icon name="list" />加入队列</button>
          <button v-if="isImport" class="btn ghost" @click="saveAsPlaylist">
            <Icon name="download" />存为我的歌单
          </button>
          <button v-if="canDelete" class="btn ghost danger" @click="removePlaylist">
            <Icon name="trash" />删除歌单
          </button>
          <button v-if="tracks.length" class="btn ghost" @click="exportList">
            <Icon name="download" />导出列表
          </button>
        </div>
      </div>
    </div>

    <TrackList :tracks="tracks" :removable="removable" :empty-text="emptyText" @play="playAt" />
  </section>
</template>
