const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, deferred, ok, track } = require('./helpers/renderer.cjs');

test('音质菜单提供官网全部五档，旧999仍代表24bit无损', async () => {
  const { a } = setup();
  assert.deepEqual(Array.from(a.QUALITIES, q => q.value), ['128', '192', '320', '740', '999']);
  assert.match(a.QUALITIES.find(q => q.value === '740').label, /16bit/);
  assert.match(a.QUALITIES.find(q => q.value === '999').label, /24bit/);
});

test('音源选择与官网当前十个源一致，全部已接入，Embeat 标注仅在线播放', () => {
  const { a } = setup();
  assert.deepEqual(Array.from(a.SOURCES, s => s.value), ['netease', 'tencent', 'kuwo', 'tidal', 'qobuz', 'joox', 'bilibili', 'apple', 'ytmusic', 'embeat']);
  assert.ok(a.SOURCES.every(s => s.open));
  assert.match(a.SOURCES.find(s => s.value === 'embeat').label, /仅在线播放/);
});

for (const source of ['netease', 'kuwo', 'tidal', 'qobuz', 'apple', 'embeat']) test(`${source} 按官网20条分页加载`, async () => {
  const calls = [];
  const { a } = setup({ search: async p => { calls.push(p); return ok(Array.from({length: p.pages === 1 ? 20 : 2}, (_, i) => ({...track,source,id:`${p.pages}-${i}`}))); } });
  a.S.source = source;
  await a.runSearch('歌');
  assert.equal(a.ui.search.done, false);
  await a.runSearch('歌', { append: true });
  assert.equal(calls[0].count, 20);
  assert.equal(a.ui.search.tracks.length, 22);
  assert.equal(a.ui.search.done, true);
});

test('JOOX 按官网不提供下一页，B站和Embeat不提交专辑搜索', async () => {
  const { a } = setup({ search: async () => ok(Array.from({ length: 30 }, () => track)) });
  a.S.source = 'joox'; await a.runSearch('歌'); assert.equal(a.ui.search.done, true);
  for (const source of ['bilibili', 'embeat']) {
    a.ui.search.q = ''; a.setSearchSource(source); a.toggleAlbum(); assert.equal(a.ui.search.album, false);
  }
});

test('播放保留歌曲原始ID，同时传递官网提供的音频解析ID', async () => {
  let requested;
  const { a } = setup({ url: async p => { requested = p; return ok({url:'https://example.test/song.m4a'}); } });
  a.setQueue([{...track,url_id:'media+/='}], 0, false); await a.loadAndPlay();
  assert.equal(requested.id, track.id); assert.equal(requested.url_id, 'media+/=');
  assert.equal(a.currentTrack.value.id, track.id);
});
test('油管作为已接入音源，按官网20条分页继续加载', async () => {
  const calls = [];
  const { a } = setup({ search: async params => {
    calls.push(params);
    return ok(Array.from({ length: params.pages === 1 ? 20 : 3 }, (_, i) => ({ ...track, id: `${params.pages}-${i}`, source: 'ytmusic' })));
  } });
  assert.ok(a.SOURCES.find(s => s.value === 'ytmusic').open);
  a.S.source = 'ytmusic';
  await a.runSearch('晴天');
  assert.equal(a.ui.search.done, false);
  await a.runSearch('晴天', { append: true });
  assert.equal(a.ui.search.tracks.length, 23);
  assert.equal(a.ui.search.done, true);
  assert.equal(calls[0].count, 20);
  assert.equal(calls[1].pages, 2);
});
test('歌单导出数据可跨结构化克隆边界', async () => {
  const { a } = setup(); const p = a.createPlaylist('备份'); p.tracks = [track];
  await a.exportPlaylistConfig(p.id);
  assert.ok(a.toasts.some(t => t.msg === '歌单配置已导出'));
});
test('空队列立即播放第一首', async () => {
  const { a } = setup(); a.playNextAndGo(track);
  await new Promise(setImmediate);
  assert.equal(a.S.queueIndex, 0); assert.equal(a.currentTrack.value.id, '1'); assert.equal(a.audio.plays, 1);
});
test('清空队列取消在途音源、歌词和缓冲状态', async () => {
  const url = deferred(), lyric = deferred();
  const { a } = setup({ url: () => url.promise, lyric: () => lyric.promise });
  a.setQueue([track], 0, false); const loading = a.loadAndPlay(); a.clearQueue();
  url.resolve(ok({ url: 'https://example.test/late.mp3' })); lyric.resolve(ok({ lyric: '[00:00]旧歌词' }));
  await loading; await new Promise(setImmediate);
  assert.equal(a.audio.src, ''); assert.equal(a.audio.plays, 0); assert.equal(a.player.lines.length, 0);
  assert.equal(a.player.buffering, false); assert.equal(a.player.lyricLoading, false);
});
test('旧音频报错定时器不能跳过用户新选的歌曲', async () => {
  const { a, fire } = setup(); a.setQueue([track, { ...track, id: '2' }], 0, false);
  await a.loadAndPlay(); a.audio.emit('error'); a.S.queueIndex = 1; await a.loadAndPlay(); fire(900);
  assert.equal(a.S.queueIndex, 1);
});
test('单曲循环下失败也跳到下一首', async () => {
  const { a, fire } = setup({ url: async () => { throw new Error('无音源'); } });
  a.S.mode = 'single'; a.setQueue([track, { ...track, id: '2' }], 0, false);
  await a.loadAndPlay(); fire(1500); assert.equal(a.S.queueIndex, 1);
});
test('自动换源不采用异名或同名异歌手结果', async () => {
  const requested = [];
  const { a } = setup({ url: async p => { requested.push(p.source); throw new Error('无音源'); },
    search: async () => ok([{ ...track, source: 'joox', name: '别的歌' }, { ...track, source: 'joox', artist: ['别人'] }]) });
  a.setQueue([track], 0, false); await a.loadAndPlay(); assert.deepEqual(requested, ['netease']);
});
test('自动换源仍接受歌名和歌手匹配的结果', async () => {
  const { a } = setup({ url: async p => { if (p.source === 'netease') throw new Error('无音源'); return ok({ url: 'https://example.test/alt.mp3' }); },
    search: async () => ok([{ ...track, source: 'joox' }]) });
  a.setQueue([track], 0, false); await a.loadAndPlay(); assert.equal(a.currentTrack.value.source, 'joox'); assert.equal(a.audio.plays, 1);
});
test('过期搜索失败不隐藏新查询分页', async () => {
  const old = deferred(), fresh = deferred(); let count = 0;
  const { a } = setup({ search: () => ++count === 1 ? old.promise : fresh.promise });
  const p1 = a.runSearch('旧'), p2 = a.runSearch('新');
  fresh.resolve(ok(Array.from({ length: 30 }, () => track))); await p2;
  old.reject(new Error('旧查询失败')); await p1; assert.equal(a.ui.search.done, false);
});
test('分页加载设为忙碌并阻止重复请求，失败可重试', async () => {
  const d = deferred(); let calls = 0;
  const { a } = setup({ search: () => { calls++; return d.promise; } });
  a.ui.search.done = false; a.ui.search.page = 1; a.ui.search.tracks = [track];
  const p = a.runSearch('歌', { append: true }); assert.equal(a.ui.search.loading, true);
  await a.runSearch('歌', { append: true }); assert.equal(calls, 1);
  d.reject(new Error('暂时失败')); await p; assert.equal(a.ui.search.done, false); assert.equal(a.ui.search.loading, false);
});
for (const paused of [true, false]) test(`音质切换保留进度与${paused ? '暂停' : '播放'}状态`, async () => {
  const calls = []; const { a } = setup({ url: async p => { calls.push(p); return ok({ url: `https://example.test/${p.br}.mp3` }); } });
  a.setQueue([track], 0, false); await a.loadAndPlay(!paused); a.audio.emit('loadedmetadata'); a.audio.currentTime = 73;
  await a.cycleQuality(); await new Promise(setImmediate); a.audio.emit('loadedmetadata');
  assert.equal(calls.length, 2); assert.equal(calls[1].br, a.S.quality);
  assert.equal(a.audio.currentTime, 73); assert.equal(a.audio.paused, paused);
});
test('连续切换音质只应用最后结果并保留播放意图', async () => {
  const middle = deferred(); let calls = 0;
  const { a } = setup({ url: async p => ++calls === 2 ? middle.promise : ok({ url: `https://example.test/${p.br}.mp3` }) });
  a.setQueue([track], 0, false); await a.loadAndPlay(true); a.audio.emit('loadedmetadata'); a.audio.currentTime = 42;
  const pending = a.cycleQuality(); await a.cycleQuality(); a.audio.emit('loadedmetadata');
  middle.resolve(ok({ url: 'https://example.test/stale.mp3' })); await pending;
  assert.equal(a.audio.paused, false); assert.equal(a.audio.currentTime, 42);
  assert.ok(!a.audio.src.includes('stale'));
});
