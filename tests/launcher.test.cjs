const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function launch(args) {
  let result;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/launch.js'), 'utf8'), {
    __dirname: path.join(__dirname, '../scripts'), console: { log() {} },
    process: { argv: ['node', 'launch.js', ...args], env: { LOCALAPPDATA: 'C:\\User\\AppData\\Local' } },
    require(name) {
      if (name === 'electron') return 'C:\\runtime\\electron.exe';
      if (name === 'node:fs') return { existsSync: () => true, readFileSync: file => file.endsWith('package.json') ? '{"version":"45.0.0"}' : '45.0.0' };
      if (name === 'node:child_process') return { spawn(exe, argv, options) { result = { exe, argv, options }; return { on() {} }; } };
      return require(name);
    },
  });
  return result;
}
test('正常启动允许桌面交互窗口显示', () => {
  const child = launch([]);
  assert.equal(child.options.windowsHide, false);
  assert.ok(child.argv[0].endsWith('electron-music'));
});
test('后台 smoke 测试仍隐藏辅助进程窗口', () => {
  assert.equal(launch(['--smoke-test']).options.windowsHide, true);
});
