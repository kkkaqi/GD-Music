import { reactive, watch } from 'vue';
import { player } from './player';
import { S, currentTrack, isLiked } from './store';
import { toast } from './ui';

export const desktopLyrics = reactive({ visible: false, locked: false });
export async function toggleDesktopLyrics() {
  try { Object.assign(desktopLyrics, await window.bridge.lyrics.toggle()); }
  catch (err) { toast(err.message || '无法打开桌面歌词', 'err'); }
}

export function initDesktopLyrics() {
  const bridge = window.bridge.lyrics;
  if (!bridge) return () => {};
  const off = bridge.onSettings(settings => { Object.assign(desktopLyrics, settings); });
  bridge.status().then(settings => Object.assign(desktopLyrics, settings)).catch(() => {});
  const stop = watch(() => {
    const track = currentTrack.value;
    const line = player.lines[player.active];
    const nextLine = player.lines[player.active + 1];
    return { title: track?.name || 'GD Music', playing: player.playing, liked: isLiked(track),
      current: line?.text || (player.lyricLoading ? '歌词加载中…' : track?.name || 'GD Music'),
      currentTranslation: S.showTranslation ? line?.tr || '' : '',
      nextTranslation: S.showTranslation ? nextLine?.tr || '' : '',
      next: nextLine?.text || (player.lines.length ? '' : track ? '暂无歌词' : '播放歌曲后显示歌词') };
  }, frame => bridge.update(frame), { immediate: true });
  return () => { stop(); off(); };
}
