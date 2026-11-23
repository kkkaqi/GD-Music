const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MusicRecognition, siteURL, searchText, captureAllowed } = require('../src/main/music-recognition');

test('电脑声音使用独立的屏幕捕获权限，麦克风模式拒绝屏幕和摄像头', () => {
  assert.equal(captureAllowed('display-capture', ['audio', 'video'], 'computer'), true);
  assert.equal(captureAllowed('display-capture', ['audio', 'video'], 'microphone'), false);
  assert.equal(captureAllowed('media', ['audio'], 'microphone'), true);
  assert.equal(captureAllowed('media', ['audio', 'video'], 'microphone'), false);
  assert.equal(captureAllowed('media', ['video'], 'computer'), false);
  assert.equal(captureAllowed('notifications', [], 'computer'), false);
});

test('识曲只信任服务方 HTTPS 来源', () => {
  assert.equal(siteURL('https://aha-music.com/song-finder'), true);
  for (const url of ['http://aha-music.com', 'https://aha-music.com.evil.test', 'file:///a', 'invalid']) {
    assert.equal(siteURL(url), false);
  }
});

test('识曲搜索限制类型和长度，并作为纯文本传递', () => {
  assert.equal(searchText({ title: 'song' }), '');
  assert.equal(searchText('  晴天\n周杰伦  '), '晴天 周杰伦');
  assert.equal(searchText('x'.repeat(400)).length, 240);
});

test('识曲网页无法使用本地窗口的 IPC', () => {
  const recognition = new MusicRecognition({});
  const mainFrame = {};
  const local = { mainFrame };
  recognition.win = { webContents: local };
  assert.equal(recognition.owns({ sender: local, senderFrame: mainFrame }), true);
  assert.equal(recognition.owns({ sender: local, senderFrame: {} }), false);
  assert.equal(recognition.owns({ sender: {}, senderFrame: mainFrame }), false);
});

test('返回搜索前先校验查询，搜索完成销毁识曲窗口和收音页面', () => {
  let query;
  const closed = [];
  const recognition = new MusicRecognition({ onSearch: text => { query = text; } });
  recognition.view = { webContents: { isDestroyed: () => false, close: () => closed.push('audio') } };
  recognition.win = { isDestroyed: () => false, destroy: () => closed.push('window') };
  assert.throws(() => recognition.search(' '), /请输入/);
  assert.deepEqual(closed, []);
  recognition.search(' 晴天 周杰伦 ');
  assert.equal(query, '晴天 周杰伦');
  assert.deepEqual(closed, ['audio', 'window']);
  assert.equal(recognition.win, null);
  assert.equal(recognition.view, null);
});

test('切换声音来源刷新识曲页面以停止旧录音', () => {
  const recognition = new MusicRecognition({});
  let reloads = 0;
  recognition.load = () => { reloads++; };
  recognition.setMode('microphone');
  assert.equal(reloads, 1);
  assert.throws(() => recognition.setMode('camera'), /请选择/);
  assert.equal(reloads, 1);
});
