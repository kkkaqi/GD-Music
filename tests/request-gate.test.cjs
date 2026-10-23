const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RequestGate } = require('../src/main/request-gate');
function clock() {
  let time = 1000000;
  return { now: () => time, sleep: async ms => { time += ms; } };
}
test('连续请求平滑发送，任意五分钟不超过48次', async () => {
  const c = clock();
  const gate = new RequestGate(c);
  const times = [];
  for (let i = 0; i < 60; i++) { await gate.acquire(); times.push(c.now()); }
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 6500);
  for (const time of times) assert.ok(times.filter(t => t > time - 300000 && t <= time).length <= 48);
});
test('后台保留前台请求额度，服务端冷却期内不发送', async () => {
  const c = clock();
  const gate = new RequestGate(c);
  gate.stamps = Array(36).fill(c.now());
  let waited = 0;
  await gate.acquire({ background: true, onWait: ms => { waited = Math.max(waited, ms); } });
  assert.ok(waited >= 300000);
  gate.defer(300000);
  const before = c.now();
  await gate.acquire();
  assert.ok(c.now() - before >= 300000);
});
test('重启保留额度与冷却，不通过重启绕过限流', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-rate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const c = clock(), file = path.join(dir, 'rate.json');
  const gate = new RequestGate(c);
  gate.init(file);
  await gate.acquire();
  gate.defer(300000);
  const restarted = new RequestGate(c);
  restarted.init(file);
  assert.equal(restarted.stamps.length, 1);
  assert.ok(restarted.waitMs() >= 300000);
});
