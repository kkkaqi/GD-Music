'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const env = { ...process.env };
// 独立缓存避免本机旧版打包工具留下的失效提取状态影响构建。
env.ELECTRON_BUILDER_CACHE ||= path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'GDMusic', 'build-cache');
const stageRoot = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'GDMusic', 'package-output');
fs.mkdirSync(stageRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(stageRoot, 'build-'));
// 本机原生可执行文件在中文路径下会异常退出，构建完成后再复制交付文件。
const child = spawn(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'),
  '--config', path.join(root, 'electron-builder.cjs'), '--config.directories.output', output,
  '--win', '--x64', '--publish', 'never'],
{ cwd: root, env, stdio: 'inherit', windowsHide: true });
child.on('error', err => { console.error(err.message); process.exit(1); });
child.on('exit', code => {
  if (code !== 0) process.exit(code ?? 1);
  const release = path.join(root, 'release');
  const desktopRelease = path.join(os.homedir(), 'Desktop', 'GD-Music-Release');
  fs.mkdirSync(release, { recursive: true });
  fs.mkdirSync(desktopRelease, { recursive: true });
  for (const name of fs.readdirSync(output)) {
    if (/\.(exe|blockmap)$/.test(name)) {
      fs.copyFileSync(path.join(output, name), path.join(release, name));
      console.log('[package]', path.join(release, name));
      if (name.endsWith('.exe')) {
        fs.copyFileSync(path.join(output, name), path.join(desktopRelease, name));
        console.log('[package]', path.join(desktopRelease, name));
      }
    }
  }
  console.log('[package] unpacked application:', path.join(output, 'win-unpacked'));
  process.exit(code ?? 1);
});
