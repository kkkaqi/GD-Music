const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const bundle = require('esbuild').buildSync({
  stdin: { contents: "export * from './store'; export * from './player';", resolveDir: path.join(__dirname, '../src/renderer/src') },
  bundle: true, platform: 'browser', format: 'iife', globalName: 'smokeHarness',
  define: { 'process.env.NODE_ENV': '"production"' }, write: false,
}).outputFiles[0].text;
env.GD_SMOKE_BUNDLE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gd-smoke-bundle-')), 'player.js');
fs.writeFileSync(env.GD_SMOKE_BUNDLE, bundle);
// 复用项目启动器的 ASCII 路径运行时准备步骤。
const child = spawn(process.execPath, [path.join(__dirname, 'launch.js'), '--smoke-test'], { stdio: 'inherit', env, windowsHide: true });
child.on('exit', code => process.exit(code == null ? 1 : code));
child.on('error', err => { console.error(err); process.exit(1); });
