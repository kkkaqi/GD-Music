'use strict';

/**
 * 启动器
 *
 * 为什么需要它：
 * 本机（Windows 11 26200）上，Electron 主程序如果从一个包含中文的路径启动，
 * 会在加载阶段直接崩溃（0xc0000005）。而项目目录 `...\Desktop\音乐\...` 含中文，
 * 所以这里把 Electron 运行时复制到纯 ASCII 路径（%LOCALAPPDATA%\GDMusic\runtime）
 * 再用它加载项目，源码位置保持不变。
 *
 * 运行时按 electron 版本号打标记，升级依赖后会自动重新复制。
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = path.join(__dirname, '..');
if (!fs.existsSync(path.join(root, 'node_modules', 'electron', 'package.json'))) {
  console.error('[launch] 找不到 electron，请先运行: npm install');
  process.exit(1);
}
// Electron 45 在首次解析模块时下载二进制，不再依赖安装后脚本。
const srcDist = path.dirname(require('electron'));

const pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')
);
const version = pkg.version;

const isAscii = (p) => /^[\x00-\x7F]*$/.test(p);

const asciiBases = [process.env.LOCALAPPDATA, process.env.ProgramData, 'C:\\'].filter(Boolean);
const base =
  asciiBases.find((b) => isAscii(b)) ||
  asciiBases.map((b) => path.join(b, 'GDMusic')).find((b) => isAscii(b)) ||
  'C:\\GDMusic';

// 按版本隔离，升级时不删除或覆盖可能仍在运行的旧 Electron。
const runtimeDir = path.join(base, 'GDMusic', 'runtime', version);
const exe = path.join(runtimeDir, 'electron.exe');
const stamp = path.join(runtimeDir, 'version.txt');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isSymbolicLink()) continue;
    else fs.copyFileSync(src, dst);
  }
}

function ensureRuntime() {
  const current = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : '';
  if (fs.existsSync(exe) && current === version) return;

  console.log(`[launch] 准备 Electron 运行时 ${version} -> ${runtimeDir}`);
  try {
    copyDir(srcDist, runtimeDir);
    fs.writeFileSync(stamp, version);
    console.log('[launch] 运行时就绪');
  } catch (err) {
    console.error('[launch] 复制运行时失败:', err && err.message);
    process.exit(1);
  }
}

ensureRuntime();

const env = { ...process.env };
// 这个变量存在（哪怕是空字符串）都会让 electron 以 Node 模式运行
delete env.ELECTRON_RUN_AS_NODE;

const smokeTest = process.argv.includes('--smoke-test');
const args = smokeTest ? [path.join(root, 'tests', 'electron-smoke.cjs')] : [root, ...process.argv.slice(2)];
console.log(`[launch] ${exe} ${args.join(' ')}`);

// 仅后台测试隐藏窗口；正常启动必须允许 Electron 显示交互窗口。
const child = spawn(exe, args, { stdio: 'inherit', cwd: root, env, windowsHide: smokeTest });
child.on('exit', (code) => process.exit(code == null ? 0 : code));
child.on('error', (err) => {
  console.error('[launch] 启动失败:', err.message);
  process.exit(1);
});
