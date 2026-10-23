const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');
const code = buildSync({
  stdin: { contents: "export * from './store'; export { toasts } from './ui';", resolveDir: path.resolve(__dirname, '../src/renderer/src') },
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
}).outputFiles[0].text;
const track = { id: '123', name: '测试歌曲', source: 'netease', artist: '歌手甲, 歌手乙', lyric_id: '456', pic_id: '789' };
function setup(data, playlist) {
  const context = { module: { exports: {} }, require, console, setTimeout: () => 1, clearTimeout() {},
    window: { bridge: { file: { importJson: async () => ({ ok: true, data: { picked: true, data } }) },
      api: { playlist: playlist || (async () => ({ ok: false, error: '离线' })) }, state: { save() {} } } } };
  vm.runInNewContext(code, context);
  return context.module.exports;
}
test('网页收藏合并，历史和播放列表另存，曲目字段归一化', async () => {
  const app = setup({ gdmusic_fav: [track], gdmusic_his: JSON.stringify([track]), gdmusic_playing: [track] });
  app.S.favorites.push({ ...track, id: 'old', artist: [] });
  await app.importPlaylistConfig();
  assert.equal(app.S.favorites.length, 2);
  assert.deepEqual(Array.from(app.S.favorites[1].artist), ['歌手甲', '歌手乙']);
  assert.equal(app.S.favorites[1].lyric_id, '456');
  assert.equal(app.S.playlists.length, 2);
  assert.notEqual(app.S.playlists[0].id, app.S.playlists[1].id);
  assert.equal(app.S.queue.length, 0);
});
test('网页歌单使用缓存，未缓存歌单补取，失败提示', async () => {
  const calls = [];
  const app = setup({ gdmusic_ulist: [
    { id: 1, name: '缓存', item: [track] }, { id: 2, name: '联网', item: [] }, { id: 3, name: '失败', item: [] },
  ] }, async ({ id }) => {
    calls.push(String(id));
    return String(id) === '2' ? { ok: true, data: { tracks: [track] } } : { ok: false, error: '离线' };
  });
  await app.importPlaylistConfig();
  assert.deepEqual(calls, ['2', '3']);
  assert.equal(app.S.playlists.length, 2);
  assert.ok(app.toasts.some(t => t.msg.includes('失败')));
});
test('保留桌面旧格式、同名追加，过滤损坏曲目', async () => {
  const app = setup({ app: 'gd-music', type: 'playlist', name: '旧歌单', tracks: [null, {}, track] });
  app.createPlaylist('旧歌单');
  await app.importPlaylistConfig();
  assert.equal(app.S.playlists[1].name, '旧歌单 (2)');
  assert.equal(app.S.playlists[1].tracks.length, 1);
  assert.ok(Array.isArray(app.S.playlists[1].tracks[0].artist));
});
test('无效配置不修改状态', async () => {
  const app = setup({ gdmusic_fav: '{broken' });
  await app.importPlaylistConfig();
  assert.equal(app.S.playlists.length, 0);
  assert.equal(app.S.favorites.length, 0);
  assert.ok(app.toasts.some(t => t.kind === 'err'));
});
test('重复收藏按音源和 ID 去重，重复导入不增加收藏', async () => {
  const app = setup({ gdmusic_fav: [track, track, { ...track, source: 'joox' }] });
  await app.importPlaylistConfig();
  await app.importPlaylistConfig();
  assert.equal(app.S.favorites.length, 2);
});
test('后续字段损坏时也不提前写入收藏', async () => {
  const app = setup({ gdmusic_fav: [track], gdmusic_ulist: {} });
  await app.importPlaylistConfig();
  assert.equal(app.S.favorites.length, 0);
  assert.equal(app.S.playlists.length, 0);
});
