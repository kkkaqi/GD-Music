const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AudioCache } = require('../src/main/audio-cache');

test('Embeat 按官网仅在线播放，收藏跳过音频下载并明确计数', async t => {
  let calls = 0;
  const cache = make(t, async () => { calls++; return new Response('audio'); });
  cache.syncFavorites([{...track, source:'embeat'}, track], '320'); await cache.idle();
  assert.equal(calls, 1);
  assert.equal(cache.status().total, 1);
  assert.equal(cache.status().streamOnly, 1);
  await assert.rejects(cache.ensure({...track,source:'embeat'}), /仅支持在线播放/);
});

test('新增代理音源完整Range下载，TIDAL实际格式保存为M4A', async t => {
  const cache = make(t, async (_url, options) => {
    assert.equal(options.headers.Range, 'bytes=0-');
    assert.equal(options.headers.Referer, 'https://music.gdstudio.org/');
    return new Response('mp4-audio', {status:206, headers:{'Content-Type':'audio/mp4','Content-Range':'bytes 0-8/9'}});
  });
  assert.equal((await cache.ensure({...track,source:'tidal'})).ext, 'm4a');
});

test('HTTP 音频不发送 HTTPS Referer，避免 Chromium 在发出请求前拒绝降级来源', async t => {
  const cache = make(t, async (_url, options) => {
    assert.equal(options.headers.Referer, undefined);
    return new Response('audio', {headers:{'Content-Type':'audio/mpeg'}});
  });
  cache.resolver = async () => ({url:'http://127.0.0.1/song.mp3'});
  assert.equal((await cache.ensure(track)).size, 5);
});
const track = { source: 'netease', id: '123', br: '320' };
function make(t, fetcher = async () => new Response('audio-bytes', { headers: { 'Content-Type': 'audio/mpeg' } })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-audio-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cache = new AudioCache(dir, async p => ({ url: 'https://example.test/song', br: p.br }), fetcher);
  let now = 1000000;
  cache.now = () => now;
  cache.sleep = async ms => { now += ms; };
  return cache;
}

for (const status of [403,410]) test(`失效链接 HTTP ${status} 仅刷新一次并保存新音频`, async t => {
  const urls=[],options=[];
  const cache=make(t,async url => {urls.push(url);return url.endsWith('old.mp3') ? new Response('',{status}) : new Response('fresh-audio',{headers:{'Content-Type':'audio/mpeg'}});});
  cache.resolver=async (_p,opt) => {options.push(opt);return {url:`https://example.test/${opt.refresh ? 'fresh' : 'old'}.mp3`};};
  const saved=await cache.ensure(track);
  assert.equal(fs.readFileSync(saved.file,'utf8'),'fresh-audio');
  assert.deepEqual(urls,['https://example.test/old.mp3','https://example.test/fresh.mp3']);
  assert.equal(options[1].background,true);
  assert.equal(options[1].refresh,true);
});

test('持续403有次数限制，手动重试强制重新解析且不重复下载完整文件',async t => {
  let allowed=false; const options=[];let downloads=0;
  const cache=make(t,async () => {downloads++;return allowed ? new Response('good-audio',{headers:{'Content-Type':'audio/mpeg'}}) : new Response('',{status:403});});
  cache.resolver=async (_p,opt) => {options.push(opt);return {url:'https://example.test/song.mp3'};};
  cache.syncFavorites([track]);await cache.idle();
  assert.equal(cache.status().failed,1);
  assert.equal(downloads,2);
  allowed=true;cache.retry();await cache.idle();
  assert.equal(cache.status().ready,1);
  assert.equal(options.at(-1).refresh,true);
  const previous=downloads;
  await cache.resolve({...track,refresh:true});cache.retry();await cache.idle();
  assert.equal(downloads,previous);
});

test('播放请求可刷新远程URL，仍优先使用完整本地文件',async t => {
  const cache=make(t);let options;
  cache.resolver=async (_p,opt) => {options=opt;return {url:'https://example.test/new.mp3'};};
  await cache.resolve({...track,refresh:true});
  assert.equal(options.refresh,true);
  await cache.ensure(track);
  cache.resolver=async () => {throw Error('不应解析完整缓存');};
  assert.equal((await cache.resolve({...track,refresh:true})).cached,true);
});

test('较大无损文件流式保存，不再被256MB限制拒绝', async t => {
  const total = 256 * 1024 * 1024 + 1;
  let remaining = total;
  const chunk = Buffer.alloc(1024 * 1024, 1);
  const cache = make(t, async () => new Response(new ReadableStream({ pull(controller) {
    if (!remaining) return controller.close();
    const bytes = Math.min(remaining, chunk.length); remaining -= bytes;
    controller.enqueue(chunk.subarray(0, bytes));
  } }), { headers: { 'Content-Type': 'audio/flac', 'Content-Length': String(total) } }));
  const saved = await cache.ensure({...track,br:'999'});
  assert.equal(saved.size, total);
  assert.equal(fs.statSync(saved.file).size, total);
});

test('新增音频格式保存后重启仍能离线读取', async t => {
  for (const ext of ['aac','ape','alac','aiff','aif']) {
    const cache = make(t, async () => new Response('audio', { headers: {'Content-Type':'application/octet-stream'} }));
    cache.resolver = async () => ({url:`https://example.test/song.${ext}`});
    const saved = await cache.ensure(track);
    assert.equal(saved.ext, ext);
    const offline = new AudioCache(cache.dir, () => { throw Error('offline'); });
    assert.equal((await offline.resolve(track)).ext, ext);
  }
});

test('持续传输的慢速文件不受总时长限制，无进度时超时并允许重试', async t => {
  const cache = make(t, async (_url, options) => new Response(new ReadableStream({ start(controller) {
    options.signal.addEventListener('abort', () => controller.error(options.signal.reason), {once:true});
  } }), {headers:{'Content-Type':'audio/mpeg'}}));
  cache.inactivityTimeoutMs = 40;
  let guard;
  try {
    await assert.rejects(Promise.race([cache.ensure(track), new Promise((_, reject) => {
      guard=setTimeout(() => reject(Error('没有按无进度超时退出')), 500);
    })]), err => err.name === 'TimeoutError' && err.retryable);
  } finally { clearTimeout(guard); }
  cache.fetcher = async (_url, options) => {
    let sent=0;
    return new Response(new ReadableStream({ async pull(controller) {
      await new Promise(r=>setTimeout(r,15));
      if(options.signal.aborted) return controller.error(options.signal.reason);
      if(sent++ < 6) controller.enqueue(Buffer.from('audio')); else controller.close();
    } }), {headers:{'Content-Type':'audio/mpeg'}});
  };
  const saved = await cache.ensure(track);
  assert.equal(saved.size, 30);
});

test('FLAC 文件头优先于服务器错误的 MP3 类型，并兼容之前保存错后缀的缓存', async t => {
  const body = Buffer.from('fLaC-lossless-audio');
  const cache = make(t, async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(body.subarray(0, 2)); controller.enqueue(body.subarray(2)); controller.close();
  } }), { headers: { 'Content-Type': 'audio/mpeg; charset=UTF-8' } }));
  const p = { ...track, br: '999' };
  const downloaded = await cache.ensure(p);
  assert.equal(downloaded.ext, 'flac');
  assert.equal(downloaded.type, 'audio/flac');
  assert.deepEqual(fs.readFileSync(downloaded.file), body);
  const key = cache.key(p);
  fs.renameSync(downloaded.file, path.join(cache.dir, key + '.mp3'));
  fs.writeFileSync(path.join(cache.dir, key + '.json'), JSON.stringify({ size: body.length, type: 'audio/mpeg', ext: 'mp3', br: 999 }));
  const offline = new AudioCache(cache.dir, () => { throw Error('offline'); });
  const restored = await offline.resolve(p);
  assert.equal(restored.ext, 'flac');
  assert.equal(restored.type, 'audio/flac');
  assert.equal((await offline.serve(new Request(restored.url))).headers.get('content-type'), 'audio/flac');
});
test('收藏自动下载且重启离线命中，相同歌曲不同音质分开保存', async t => {
  const cache = make(t);
  cache.syncFavorites([track], '320');
  await cache.idle();
  assert.equal(cache.status().ready, 1);
  const restarted = new AudioCache(cache.dir, () => { throw Error('offline'); });
  assert.match((await restarted.resolve(track)).url, /^app:\/\/bundle\/audio-cache\//);
  assert.equal(restarted.lookup({ ...track, br: '999' }), null);
});
test('重复下载合并且本地支持 Range 拖动播放', async t => {
  let calls = 0;
  const cache = make(t, async () => { calls++; return new Response('0123456789', { headers: { 'Content-Type': 'audio/mpeg' } }); });
  await Promise.all([cache.ensure(track), cache.ensure(track)]);
  assert.equal(calls, 1);
  const url = cache.lookup(track).url;
  const res = await cache.serve(new Request(url, { headers: { Range: 'bytes=3-6' } }));
  assert.equal(res.status, 206);
  assert.equal(await res.text(), '3456');
  assert.equal((await cache.serve(new Request(url, { headers: { Range: 'bytes=100-' } }))).status, 416);
});

test('油管下载请求完整Range，响应是完整WebM才发布为离线文件', async t => {
  const cache = make(t, async (_url, options) => {
    assert.equal(options.headers.Range, 'bytes=0-');
    return new Response('webm-audio', { status: 206, headers: { 'Content-Type': 'audio/webm', 'Content-Range': 'bytes 0-9/10' } });
  });
  const p = { ...track, source: 'ytmusic' };
  assert.equal((await cache.ensure(p)).ext, 'webm');
  const bad = make(t, async () => new Response('part', { status: 206,
    headers: { 'Content-Type': 'audio/webm', 'Content-Range': 'bytes 0-3/10' } }));
  await assert.rejects(bad.ensure(p), /完整/);
  assert.equal(bad.lookup(p), null);
});
test('下载失败不留下可播放的半文件，重试后可恢复', async t => {
  const cache = make(t, async () => new Response('<html>error</html>', { headers: { 'Content-Type': 'text/html' } }));
  cache.syncFavorites([track], '320');
  await cache.idle();
  assert.equal(cache.status().failed, 1);
  assert.equal(cache.lookup(track), null);
  assert.equal(fs.readdirSync(cache.dir).length, 0);
  cache.fetcher = async () => new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
  cache.retry();
  await cache.idle();
  assert.equal(cache.status().ready, 1);
});

test('503 自动退避再下载，临时错误不计为永久失败', async t => {
  const cache = make(t);
  let now = 1000000, attempts = 0;
  cache.now = () => now;
  cache.sleep = async ms => { now += ms; };
  cache.fetcher = async () => {
    if (++attempts === 1) return new Response('', { status: 503, headers: { 'Retry-After': '45' } });
    assert.ok(now >= 1045000);
    return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
  };
  cache.syncFavorites([track], '320');
  await cache.idle();
  assert.equal(cache.status().ready, 1);
  assert.equal(cache.status().failed, 0);
  assert.equal(attempts, 2);
});

test('音频流超时会清理半文件并退避重试', async t => {
  let attempts = 0;
  const cache = make(t, async () => {
    if (++attempts === 1) return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.error(new DOMException('download timeout', 'TimeoutError'));
    } }), { headers: { 'Content-Type': 'audio/mpeg' } });
    assert.equal(fs.readdirSync(cache.dir).length, 0);
    return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
  });
  cache.syncFavorites([track], '320');
  await cache.idle();
  assert.equal(cache.status().ready, 1);
  assert.equal(cache.status().failed, 0);
  assert.equal(attempts, 2);
});

test('下载队列逐首间隔至少8秒', async t => {
  const cache = make(t);
  let now = 1000000;
  const started = [];
  cache.now = () => now;
  cache.sleep = async ms => { now += ms; };
  cache.fetcher = async () => { started.push(now); return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } }); };
  cache.syncFavorites([track, { ...track, id: '456' }], '320');
  await cache.idle();
  assert.equal(started.length, 2);
  assert.ok(started[1] - started[0] >= 8000);
  assert.equal(cache.status().ready, 2);
});

test('等待期间取消收藏不会下载已取消的任务', async t => {
  const cache = make(t);
  let requests = 0;
  cache.sleep = async () => { cache.syncFavorites([], '320'); };
  cache.fetcher = async () => { requests++; return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } }); };
  cache.syncFavorites([track, { ...track, id: '456' }], '320');
  await cache.idle();
  assert.equal(requests, 1);
});

test('429 遵守5分钟等待，期间重复保存不会绕过冷却', async t => {
  const cache = make(t);
  let now = 1000000, requests = 0, sawWaiting = false;
  cache.now = () => now;
  cache.sleep = async ms => {
    sawWaiting ||= cache.status().waitSeconds > 0 && cache.status().retrying === 1 && cache.status().failed === 0;
    cache.syncFavorites([track], '320');
    now += ms;
  };
  cache.fetcher = async () => {
    if (++requests === 1) return new Response('', { status: 429 });
    assert.ok(now >= 1300000);
    return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
  };
  cache.syncFavorites([track], '320');
  await cache.idle();
  assert.equal(cache.status().ready, 1);
  assert.ok(sawWaiting);
});

test('单首持续503不会阻止其他歌曲在等待后下载', async t => {
  const cache = make(t);
  const order = [];
  cache.resolver = async p => {
    order.push(p.id);
    if (p.id === track.id) throw Object.assign(Error('busy'), { status: 503, retryable: true });
    cache.syncFavorites([{ ...track, id: '456' }], '320');
    return { url: 'https://example.test/song' };
  };
  cache.syncFavorites([track, { ...track, id: '456' }], '320');
  await cache.idle();
  assert.deepEqual(order, ['123', '456']);
  assert.equal(cache.status().ready, 1);
});
