const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { RequestGate, retryAfterMs } = require('../src/main/request-gate');
const apiFile = path.resolve(__dirname, '../src/main/api.js');
function setup(responses) {
  let now = 1000000;
  const gates = [];
  class Gate extends RequestGate {
    constructor() { super({ now: () => now, sleep: async ms => { now += ms; } }); gates.push(this); }
  }
  const nodeRequire = createRequire(apiFile);
  const calls = [];
  const context = { module: { exports: {} }, require: name => name === './request-gate' ? { RequestGate: Gate, retryAfterMs } : nodeRequire(name),
    Date, URL, URLSearchParams, AbortSignal, fetch: async url => { calls.push(url); return responses.shift(); } };
  vm.runInNewContext(fs.readFileSync(apiFile, 'utf8'), context);
  return { api: context.module.exports, gate: gates[0], calls };
}

test('导入解析ID失效时使用原始歌曲ID，保留同一音源和无损档位', async () => {
  const { api, calls } = setup([Response.json({ url: '', br: -1 }),
    Response.json({ url: 'https://example.test/song.flac', br: 999 })]);
  const result = await api.trackUrl({ source: 'joox', id: 'original==', url_id: 'stale-id', br: '999' });
  assert.equal(result.br, 999);
  assert.deepEqual(calls.map(url => new URL(url).searchParams.get('id')), ['stale-id', 'original==']);
  assert.ok(calls.every(url => new URL(url).searchParams.get('br') === '999'));
});

test('解析ID有效时不调用原始ID；限流和服务异常不触发ID回退', async () => {
  const good = setup([Response.json({ url: 'https://example.test/song.flac', br: 999 })]);
  await good.api.trackUrl({ id: 'original', url_id: 'valid', br: '999' });
  assert.equal(good.calls.length, 1);
  for (const status of [429, 503]) {
    const { api, calls } = setup([new Response('', { status })]);
    await assert.rejects(api.trackUrl({ id: 'original', url_id: 'stale', br: '999' }), err => err.status === status);
    assert.equal(calls.length, 1);
  }
});
test('API 503 保留重试信息及 Retry-After，并进入共享冷却', async () => {
  const { api, gate } = setup([new Response('', { status: 503, headers: { 'Retry-After': '90' } })]);
  await assert.rejects(api.trackUrl({ id: '1' }), err => err.status === 503 && err.retryable && err.retryAfterMs === 90000);
  assert.equal(gate.waitMs(), 90000);
});
test('JSON 限流错误同样进入共享冷却', async () => {
  const { api, gate } = setup([new Response(JSON.stringify({ code: 429, msg: 'rate limit' }))]);
  await assert.rejects(api.trackUrl({ id: '1' }), err => err.status === 429 && err.retryAfterMs === 300000);
  assert.equal(gate.waitMs(), 300000);
});

test('空地址不缓存，手动重试能重新获取链接', async () => {
  const { api, calls } = setup([Response.json({ url: '', br: -1 }), Response.json({ url: 'https://example.test/song.mp3', br: 320 })]);
  await assert.rejects(api.trackUrl({ id: 'retry' }), /地址|音源/);
  assert.equal((await api.trackUrl({ id: 'retry' })).br, 320);
  assert.equal(calls.length, 2);
});

test('忽略旧版本留下的空地址磁盘缓存', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-api-negative-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const key = new URLSearchParams({ types: 'url', source: 'joox', id: 'old', br: '320' }).toString();
  const hash = crypto.createHash('sha1').update(key).digest('hex');
  fs.mkdirSync(path.join(dir, hash.slice(0, 2)));
  fs.writeFileSync(path.join(dir, hash.slice(0, 2), hash + '.json'), JSON.stringify({ exp: Date.now() + 1200000, value: { url: '', br: -1 } }));
  const { api, calls } = setup([Response.json({ url: 'https://example.test/new.mp3', br: 320 })]);
  api.initCache(dir);
  assert.match((await api.trackUrl({ source: 'joox', id: 'old' })).url, /new.mp3/);
  assert.equal(calls.length, 1);
});

test('JOOX 直接按网页版解析同一 ID，合并请求并缓存成功结果', async () => {
  const { api, gate, calls } = setup([Response.json({ url: '', br: -1 })]);
  const webCalls = [];
  api.setWebsiteRequester(async params => { webCalls.push(params); return Response.json({ url: 'https://example.test/joox.mp3', br: 320, size: 13035086 }); });
  const p = { source: 'joox', id: 'dSn2AQbXo15kTOYNnJNDWw==', br: '320' };
  const results = await Promise.all([api.trackUrl(p), api.trackUrl(p)]);
  assert.equal(results[0].size, 13035086);
  assert.equal(webCalls.length, 1);
  assert.equal(webCalls[0].id, p.id);
  assert.equal(webCalls[0].source, 'joox');
  assert.equal(gate.stamps.length, 1);
  await api.trackUrl(p);
  assert.equal(calls.length, 0);
  assert.equal(webCalls.length, 1);
});

test('官网返回空音频时不重复调用同一官网接口，也不缓存失败', async () => {
  const { api, gate } = setup([]); let attempts = 0;
  api.setWebsiteRequester(async () => { attempts++; return Response.json({url:'',br:-1}); });
  await assert.rejects(api.trackUrl({source:'joox',id:'empty'}), /地址/);
  assert.equal(attempts, 1); assert.equal(gate.stamps.length, 1);
  await assert.rejects(api.trackUrl({source:'joox',id:'empty'}), /地址/);
  assert.equal(attempts, 2);
});

for (const source of ['netease', 'tencent', 'kuwo', 'tidal', 'qobuz', 'joox', 'bilibili', 'apple', 'embeat']) {
  test(`${source} 搜索、音频、封面、歌词均沿用官网接口`, async () => {
    const { api, gate, calls } = setup([]), webCalls = [];
    api.setWebsiteRequester(async p => {
      webCalls.push(p);
      return Response.json(p.types === 'search' ? [{ id: 'original', url_id: 'media+/=', name: '歌', artist: ['歌手'], source }] :
        p.types === 'url' ? { url: '/cache/song.m4a', br: 128 } :
        p.types === 'pic' ? { url: '//example.test/pic.jpg' } : { lyric: '[00:00]原词', tlyric: '[00:00]译文' });
    });
    const [track] = await api.search({ source, name: '歌', count: 20 });
    assert.equal(track.url_id, 'media+/=');
    assert.equal((await api.trackUrl({ source, id: track.id, url_id: track.url_id })).url, 'https://music.gdstudio.org/cache/song.m4a');
    assert.equal(webCalls[1].id, 'media+/=');
    assert.equal((await api.pic({ source, id: 'pic' })).url, 'https://example.test/pic.jpg');
    assert.match((await api.lyric({ source, id: 'lyric' })).tlyric, /译文/);
    assert.equal(gate.stamps.length, 4);
    assert.equal(calls.length, 0);
  });
}

test('官网专辑搜索使用 search_album 类型和原始音源，缺省音源补回搜索结果', async () => {
  const { api, calls } = setup([]); let requested;
  api.setWebsiteRequester(async p => { requested = p; return Response.json([{ id: 'album-song', name: '歌' }]); });
  const [track] = await api.search({ source: 'tidal', name: '25 Adele', album: true });
  assert.equal(requested.types, 'search_album');
  assert.equal(requested.source, 'tidal');
  assert.equal(track.source, 'tidal');
  assert.equal(calls.length, 0);
});

test('网页版回退同样遵守 429 冷却，不把限流解释成无音源', async () => {
  const { api, gate } = setup([Response.json({ url: '' })]);
  api.setWebsiteRequester(async () => new Response('', { status: 429, headers: { 'Retry-After': '400' } }));
  await assert.rejects(api.trackUrl({ source: 'joox', id: 'limited' }), err => err.status === 429 && err.retryable);
  assert.equal(gate.waitMs(), 400000);
});

test('油管的搜索、播放、封面和歌词直接使用官网接口，共享额度及成功缓存', async () => {
  const { api, gate, calls } = setup([]), webCalls = [];
  api.setWebsiteRequester(async params => {
    webCalls.push(params);
    return Response.json(params.types === 'search' ? [{ id: 'video', name: '晴天', artist: ['周杰倫'], source: 'ytmusic' }] :
      params.types === 'url' ? { url: 'cache/song.webm', br: 135, size: 5086328 } :
      params.types === 'pic' ? { url: '/cache/cover.jpg' } : { lyric: '[00:00]测试歌词', tlyric: '' });
  });
  const tracks = await api.search({ source: 'ytmusic', name: '晴天', count: 20 });
  assert.equal(tracks[0].source, 'ytmusic');
  assert.equal((await api.trackUrl({ source: 'ytmusic', id: 'video' })).url, 'https://music.gdstudio.org/cache/song.webm');
  assert.equal((await api.pic({ source: 'ytmusic', id: 'video' })).url, 'https://music.gdstudio.org/cache/cover.jpg');
  assert.match((await api.lyric({ source: 'ytmusic', id: 'video' })).lyric, /测试歌词/);
  await api.search({ source: 'ytmusic', name: '晴天', count: 20 });
  assert.equal(webCalls.length, 4);
  assert.equal(gate.stamps.length, 4);
  assert.equal(calls.length, 0);
});

test('油管无效代理占位地址不缓存，重试能重新解析', async () => {
  const { api } = setup([]); let attempts = 0;
  api.setWebsiteRequester(async () => Response.json(++attempts === 1 ?
    { url: 'https://music-proxy.gdstudio.org/', br: -1, size: 0 } :
    { url: 'https://example.test/song.webm', br: 135 }));
  await assert.rejects(api.trackUrl({ source: 'ytmusic', id: 'video' }), /地址|音源/);
  assert.match((await api.trackUrl({ source: 'ytmusic', id: 'video' })).url, /song.webm/);
  assert.equal(attempts, 2);
});
