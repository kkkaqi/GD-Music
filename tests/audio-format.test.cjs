const { test } = require('node:test');
const assert = require('node:assert/strict');

test('保留网页支持的AAC、APE、AIFF、ALAC文件格式', () => {
  const { audioExtension } = require('../src/main/audio-format');
  for (const ext of ['aac','ape','alac','aiff','aif']) {
    assert.equal(audioExtension(`https://example.test/song.${ext}`, 'application/octet-stream', 'audio'), ext);
  }
  assert.equal(audioExtension('https://example.test/song', 'audio/aac'), 'aac');
  assert.equal(audioExtension('https://example.test/song', 'audio/x-ape'), 'ape');
  assert.equal(audioExtension('https://example.test/song', 'audio/x-aiff'), 'aiff');
});
test('下载格式支持油管代理地址的mime参数和响应类型，避免webm误存为mp3', () => {
  const { audioExtension } = require('../src/main/audio-format');
  assert.equal(audioExtension('https://music-proxy.gdstudio.org/https://cdn.test/videoplayback?mime=audio%2Fwebm'), 'webm');
  assert.equal(audioExtension('https://example.test/song', 'audio/mp4; codecs="mp4a.40.2"'), 'm4a');
  assert.equal(audioExtension('https://example.test/song.mp3'), 'mp3');
  assert.equal(audioExtension('https://example.test/song', '', 'audio'), 'audio');
});

test('TIDAL MP4和B站M4S保存为M4A，B站错误的audio/mpeg响应类型不能覆盖容器格式', () => {
  const { audioExtension } = require('../src/main/audio-format');
  assert.equal(audioExtension('https://music-proxy.gdstudio.org/https://cdn.test/song.mp4'), 'm4a');
  assert.equal(audioExtension('https://music-proxy.gdstudio.org/https://cdn.test/song.m4s', 'audio/mpeg'), 'm4a');
  assert.equal(audioExtension('https://example.test/song', 'video/mp4'), 'm4a');
});
