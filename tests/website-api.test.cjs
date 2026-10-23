const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function setup() {
  const views = [], requests = [], signed = [];
  let filter;
  const session = { fromPartition: () => ({ webRequest: { onBeforeRequest(fn) { filter = fn; } }, setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {} }) };
  const allow = (url, resourceType = 'xhr') => { let result; filter({ url, resourceType }, value => { result = !value.cancel; }); return result; };
  class WebContentsView {
    constructor(options) {
      this.options = options; views.push(this);
      this.webContents = { setAudioMuted() {}, setWindowOpenHandler() {}, on() {},
        isDestroyed: () => this.closed, close: () => { this.closed = true; },
        loadURL: async url => { assert.equal(url, 'https://music.gdstudio.org/'); },
        executeJavaScript: async code => vm.runInNewContext(code, {
          URLSearchParams, AbortSignal, encodeURIComponent, crc32: value => { signed.push(value); return 'website-signature'; },
          fetch: async url => {
            const target = new URL(url, 'https://music.gdstudio.org/');
            assert.ok(allow(target.href)); requests.push(target);
            // 即使网站自动发起同一请求，也不能绕过主进程计数再请求一次。
            assert.equal(allow(target.href), false);
            return { status: 200, headers: new Headers(), text: async () => JSON.stringify({ url: 'https://example.test/song.mp3', br: 320 }) };
          },
        }),
      };
    }
  }
  const { WebsiteApi } = require('../src/main/website-api');
  return { adapter: new WebsiteApi({ WebContentsView, session }), views, requests, signed, allow };
}

test('网页版解析使用隔离的无窗口页面，默认拦截网站自动 API 和媒体请求', async t => {
  const { adapter, views, allow } = setup(); t.after(() => adapter.destroy());
  const response = await adapter.request({ types: 'url', source: 'joox', id: 'a+/==', br: '320' });
  assert.equal((await response.json()).br, 320);
  assert.equal(views.length, 1);
  assert.equal(views[0].options.webPreferences.sandbox, true);
  assert.equal(views[0].options.webPreferences.nodeIntegration, false);
  assert.equal(allow('https://music.gdstudio.org/api.php?types=search'), false);
  assert.equal(allow('https://music.gdstudio.org/api.php?types=url&id=other'), false);
  assert.equal(allow('https://evil.test/payload.js', 'script'), false);
  assert.equal(allow('https://music.gdstudio.org/test.mp3', 'media'), false);
  assert.equal(allow('https://music.gdstudio.org/js/player.js', 'script'), true);
});

test('并发解析串行复用网页，歌曲 ID 安全传值，销毁后释放页面', async () => {
  const { adapter, views, requests } = setup();
  const id = "a'+/==; window.injected = true; //";
  await Promise.all([adapter.request({ types: 'url', source: 'joox', id, br: '320' }),
    adapter.request({ types: 'url', source: 'joox', id: 'second', br: '128' })]);
  assert.equal(views.length, 1);
  assert.equal(requests[0].searchParams.get('id'), id);
  assert.equal(requests[0].searchParams.get('s'), 'website-signature');
  assert.equal(requests[1].searchParams.get('br'), '128');
  adapter.destroy();
  assert.equal(views[0].closed, true);
  await assert.rejects(adapter.request({}), /关闭/);
});

test('油管搜索按关键词生成官网签名，后续音源查询按歌曲ID签名', async t => {
  const { adapter, signed, requests } = setup(); t.after(() => adapter.destroy());
  await adapter.request({ types: 'search', source: 'ytmusic', name: "晴天 !()'", count: 20, pages: 2 });
  assert.equal(signed[0], '%E6%99%B4%E5%A4%A9%20%21%28%29%27');
  assert.equal(requests[0].searchParams.get('pages'), '2');
  await adapter.request({ types: 'lyric', source: 'ytmusic', id: 'video-id' });
  assert.equal(signed[1], 'video-id');
});
