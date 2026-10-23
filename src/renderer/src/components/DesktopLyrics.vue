<script setup>
import { computed, reactive, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import Icon from './Icon.vue';
const bridge = window.desktopLyrics;
const frame = reactive({ current: 'GD Music', next: '播放歌曲后显示歌词', currentTranslation: '', nextTranslation: '', playing: false, liked: false });
const settings = reactive({ fontSize: 32, layoutWidth: window.innerWidth, opacity: 0.48, color: '#a8f4ac', locked: false, hovered: false });
const lyricOutline = computed(() => {
  const channels = settings.color.slice(1).match(/../g).map(hex => {
    const value = parseInt(hex, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? '#000000' : '#ffffff';
});
const displayedFontSize = ref(32);
const lockButton = ref(null);
const lyricContent = ref(null);
const settingsPanel = ref(null);
const settingsOpen = ref(false);
const fontMenuOpen = ref(false);
const fontPresets = [12, 16, 20, 24, 28, 32, 36, 40];
// 旧版保存的其它字号继续显示为选中项，不静默改动用户设置。
const fontChoices = computed(() => fontPresets.includes(settings.fontSize) ? fontPresets : [...fontPresets, settings.fontSize].sort((a, b) => a - b));
watch(settingsOpen, open => { if (!open) fontMenuOpen.value = false; });
let offFrame, offSettings, offHover, offLayout, resizeObserver, layoutFrame;
let lastMeasurement = '';
function measureContent() {
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => {
    reportLockRegion();
    if (!lyricContent.value) return;
    const clone = lyricContent.value.cloneNode(true);
    Object.assign(clone.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
      left: '0', top: '0', width: Math.max(1, settings.layoutWidth - 2) + 'px' });
    clone.style.setProperty('--lyric-size', settings.fontSize + 'px');
    lyricContent.value.parentElement.appendChild(clone);
    let height = 46 + clone.getBoundingClientRect().height + 2;
    clone.remove();
    if (settingsPanel.value) {
      const panelClone = settingsPanel.value.cloneNode(true);
      Object.assign(panelClone.style, { visibility: 'hidden', maxHeight: 'none', height: 'auto', overflow: 'visible' });
      settingsPanel.value.parentElement.appendChild(panelClone);
      height = Math.max(height, 49 + panelClone.getBoundingClientRect().height + 10);
      const fontMenu = panelClone.querySelector('.font-size-menu');
      if (fontMenu) height = Math.max(height, 49 + fontMenu.offsetTop + fontMenu.getBoundingClientRect().height + 10);
      panelClone.remove();
    }
    const measurement = { height: Math.ceil(height), width: settings.layoutWidth, fontSize: settings.fontSize };
    const key = JSON.stringify(measurement);
    if (key === lastMeasurement) return;
    lastMeasurement = key;
    bridge.fitContent(measurement);
  });
}
watch(() => [settings.fontSize, settings.layoutWidth, settings.locked, settings.hovered, frame.current, frame.next,
  frame.currentTranslation, frame.nextTranslation, settingsOpen.value, fontMenuOpen.value], measureContent, { flush: 'post' });
watch(settingsPanel, (element, previous) => {
  if (previous) resizeObserver?.unobserve(previous);
  if (element) resizeObserver?.observe(element);
  measureContent();
});
function reportLockRegion() {
  if (!lockButton.value) return;
  const { x, y, width, height } = lockButton.value.getBoundingClientRect();
  bridge.setLockRegion({ x, y, width, height });
}
function closeSettingsOutside(event) {
  if (settingsOpen.value && !event.target.closest('.lyrics-settings, button[title="歌词设置"]')) settingsOpen.value = false;
}
function closeSettingsOnEscape(event) { if (event.key === 'Escape') settingsOpen.value = false; }
onMounted(async () => {
  document.addEventListener('pointerdown', closeSettingsOutside);
  window.addEventListener('keydown', closeSettingsOnEscape);
  offFrame = bridge.onFrame(value => { Object.assign(frame, value); });
  offLayout = bridge.onLayout(value => { displayedFontSize.value = value.fontSize; });
  offSettings = bridge.onSettings(value => {
    Object.assign(settings, value);
    if (value.locked) settingsOpen.value = false;
  });
  offHover = bridge.onHover(hovered => {
    settings.hovered = hovered;
    // 原生调色板可超出歌词窗口；移出窗口时不卸载它所属的 input。
  });
  Object.assign(settings, await bridge.status());
  await nextTick();
  resizeObserver = new ResizeObserver(measureContent);
  resizeObserver.observe(document.documentElement);
  resizeObserver.observe(lyricContent.value);
  measureContent();
});
onBeforeUnmount(() => {
  offFrame?.(); offSettings?.(); offHover?.(); offLayout?.(); resizeObserver?.disconnect(); cancelAnimationFrame(layoutFrame);
  document.removeEventListener('pointerdown', closeSettingsOutside);
  window.removeEventListener('keydown', closeSettingsOnEscape);
});
function configure(key, value) { bridge.configure({ [key]: value }); }
function chooseFontSize(size) {
  configure('fontSize', size);
  settingsOpen.value = false;
}
</script>

<template>
  <section class="desktop-lyrics" :class="{ locked: settings.locked, 'is-hovered': settings.hovered }"
    :style="{ '--lyric-size': displayedFontSize + 'px', '--lyric-color': settings.color, '--lyric-outline': lyricOutline, '--panel-opacity': settings.opacity }">
    <header class="lyrics-toolbar">
      <div class="toolbar-group"><span class="lyrics-brand" title="GD Music"><Icon name="music" /></span>
        <button :title="frame.liked ? '取消喜欢' : '喜欢'" :class="{ liked: frame.liked }" @click="bridge.command('like')"><Icon :name="frame.liked ? 'heart-fill' : 'heart'" /></button>
      </div>
      <div class="toolbar-group playback">
        <button title="上一首" @click="bridge.command('prev')"><Icon name="prev" /></button>
        <button :title="frame.playing ? '暂停' : '播放'" @click="bridge.command('toggle')"><Icon :name="frame.playing ? 'pause' : 'play'" /></button>
        <button title="下一首" @click="bridge.command('next')"><Icon name="next" /></button>
      </div>
      <div class="toolbar-group">
        <button title="歌词设置" :class="{ active: settingsOpen }" @click="settingsOpen = !settingsOpen"><Icon name="settings" /></button>
        <button ref="lockButton" class="lyrics-lock-toggle" :title="settings.locked ? '解除歌词锁定' : '锁定歌词'"
          :aria-label="settings.locked ? '解除歌词锁定' : '锁定歌词'" :aria-pressed="settings.locked"
          @click="configure('locked', !settings.locked)"><Icon :name="settings.locked ? 'lock' : 'unlock'" /></button>
        <button title="关闭桌面歌词" @click="bridge.hide()"><Icon name="x" /></button>
      </div>
    </header>
    <div ref="lyricContent" class="lyric-content" :title="frame.title">
      <div class="lyric-pair">
        <div class="current-line" :title="frame.current">{{ frame.current }}</div>
        <div v-if="frame.currentTranslation" class="lyric-translation current-translation" :title="frame.currentTranslation">{{ frame.currentTranslation }}</div>
      </div>
      <div class="lyric-pair">
        <div class="next-line" :title="frame.next">{{ frame.next || ' ' }}</div>
        <div v-if="frame.nextTranslation" class="lyric-translation next-translation" :title="frame.nextTranslation">{{ frame.nextTranslation }}</div>
      </div>
    </div>
    <div v-if="settingsOpen && !settings.locked" ref="settingsPanel" class="lyrics-settings" @keydown.esc.stop="settingsOpen = false">
      <div class="lyrics-settings-body">
        <button class="font-size-trigger" :class="{ active: fontMenuOpen }" aria-haspopup="menu" :aria-expanded="fontMenuOpen"
          @click="fontMenuOpen = !fontMenuOpen" @keydown.right.prevent="fontMenuOpen = true">
          <span>字体大小</span><span class="font-size-summary">{{ settings.fontSize }}<Icon name="chevron-right" /></span>
        </button>
        <label>背景 <input type="range" min="0" max="85" :value="Math.round(settings.opacity * 100)" @input="configure('opacity', Number($event.target.value) / 100)" /><span>{{ Math.round(settings.opacity * 100) }}%</span></label>
        <label>歌词颜色 <input type="color" :value="settings.color" @input="configure('color', $event.target.value)" /></label>
        <small>原文和翻译同步缩放，字号自动保存。拖动歌词区域可移动窗口；锁定后点击右上角小锁解锁。</small>
      </div>
      <div v-if="fontMenuOpen" class="font-size-menu" role="menu" aria-label="字体大小">
        <button v-for="size in fontChoices" :key="size" :data-font-size="size" role="menuitemradio"
          :aria-checked="settings.fontSize === size" :class="{ selected: settings.fontSize === size }" @click="chooseFontSize(size)">
          <span class="font-choice-dot" aria-hidden="true"></span><span>{{ size }}</span>
        </button>
      </div>
    </div>
  </section>
</template>
