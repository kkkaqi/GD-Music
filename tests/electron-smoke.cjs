// 由 scripts/test-electron.cjs 在独立 Electron 进程执行，所有数据位于临时目录。
const { app, BrowserWindow, dialog, globalShortcut, screen, net, Tray } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-smoke-'));
app.setPath('userData', dir);
const exported = path.join(dir, 'export.json');
const name = '<img src=x data-review-injection=1>测试歌单';
fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ playlists: [{ id: 'smoke', name, tracks: [{ id: '1', name: '测试', source: 'netease', artist: ['歌手'] }] }] }));
dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported });
globalShortcut.register = () => false;
BrowserWindow.prototype.show = function () {};
let nativeTray, nativeTrayMenu;
const nativeSetContextMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function(menu) {
  nativeTray = this; nativeTrayMenu = menu;
  return nativeSetContextMenu.call(this, menu);
};
const api = require('../src/main/api');
api.search = async () => [];
api.pic = async () => ({ url: '' });
api.lyric = async () => ({ lyric: '[00:00.00]桌面歌词测试 <img src=x>\n[00:01.20]下一句歌词\n[00:40.00]之后的歌词', tlyric: '[00:00.00]中文翻译 <b>首句</b>\n[00:01.20]第二句中文翻译' });
// 本地静音 WAV 验证真实 HTMLAudioElement 的换质定位，无外部音源依赖。
const wav = Buffer.alloc(44 + 8000 * 2 * 100);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const server = require('node:http').createServer((req, res) => {
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range && range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
  res.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {}) });
  res.end(wav.subarray(start, end + 1));
});
const listening = new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const playbackReferers = [];
server.on('request', req => { playbackReferers.push(req.headers.referer); });
api.trackUrl = async ({ br }) => ({ url: `http://127.0.0.1:${server.address().port}/song-${br}.wav`, br });
// 直接观测真实 Chromium 下载入口，不替换它可能依赖的全局 fetch。
let chromiumRequests = 0;
const nativeNetFetch = net.fetch.bind(net);
net.fetch = (...args) => { chromiumRequests++; return nativeNetFetch(...args); };
require('../src/main/main');
const checks = [];
const rendererErrors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', ({ level, message }) => {
    if (level === 'error') rendererErrors.push(message);
  });
});
const watchdog = setTimeout(() => { console.error('Electron smoke timeout'); app.exit(1); }, 25000);
app.whenReady().then(async () => {
  let cursorOverride = null;
  const nativeCursor = screen.getCursorScreenPoint.bind(screen);
  screen.getCursorScreenPoint = () => cursorOverride || nativeCursor();
  try {
    const win = BrowserWindow.getAllWindows()[0];
    const wc = win.webContents;
    assert.ok(nativeTray && !nativeTray.isDestroyed(), '启动后必须创建原生托盘图标');
    assert.deepEqual(nativeTrayMenu.items.map(item => item.label), ['打开GD-Music', '退出']);
    const originalWindowMethods = { show: win.show, focus: win.focus, restore: win.restore, isMinimized: win.isMinimized };
    const trayActions = [];
    win.show = () => trayActions.push('show'); win.focus = () => trayActions.push('focus');
    win.restore = () => trayActions.push('restore'); win.isMinimized = () => true;
    nativeTrayMenu.items[0].click();
    assert.deepEqual(trayActions, ['restore','show','focus']);
    Object.assign(win, originalWindowMethods);
    let quitRequested = false;
    const originalQuit = app.quit;
    app.quit = () => { quitRequested = true; };
    nativeTrayMenu.items[1].click();
    app.quit = originalQuit;
    assert.ok(quitRequested, '退出菜单应调用正常 app.quit 流程');
    checks.push('native tray with exactly open and quit, minimized window restore and normal quit');
    if (wc.isLoading()) await new Promise(resolve => wc.once('did-finish-load', resolve));
    const js = code => wc.executeJavaScript(code);
    assert.equal(await js("document.querySelector('select[title=音乐源] option[value=ytmusic]').textContent.includes('未开放')"), false);
    assert.deepEqual(await js("Array.from(document.querySelectorAll('select[title=音乐源] option'), o=>o.value)"),
      ['netease','tencent','kuwo','tidal','qobuz','joox','bilibili','apple','ytmusic','embeat']);
    assert.equal(await js("document.querySelector('select[title=音乐源]').textContent.includes('未开放')"), false);
    checks.push('ten website sources available in selector');
    const waitFor = async expression => {
      for (let i = 0; i < 100; i++) {
        if (await js(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      throw new Error(`等待失败: ${expression}`);
    };
    const originalBounds = win.getBounds();
    const gestureStart = {x:100,y:100,width:1100,height:700};
    win.setBounds(gestureStart);
    await new Promise(resolve => setTimeout(resolve, 100));
    const pointer = async (selector, type) => {
      await js(`(document.querySelector(${JSON.stringify(selector)}) || document.documentElement).dispatchEvent(new PointerEvent(${JSON.stringify(type)}, {bubbles:true,button:0,buttons:${type === 'pointerup' ? 0 : 1},pointerId:71,clientX:300,clientY:200}))`);
      await new Promise(resolve => setTimeout(resolve, 55));
    };
    for (const [edge, expected] of Object.entries({
      n:{x:100,y:110,width:1100,height:690},s:{x:100,y:100,width:1100,height:710},
      w:{x:120,y:100,width:1080,height:700},e:{x:100,y:100,width:1120,height:700},
      nw:{x:120,y:110,width:1080,height:690},ne:{x:100,y:110,width:1120,height:690},
      sw:{x:120,y:100,width:1080,height:710},se:{x:100,y:100,width:1120,height:710},
    })) {
      win.setBounds(gestureStart);
      const initial=win.getBounds();
      cursorOverride={x:400,y:300};
      await pointer(`[data-window-resize=${edge}]`, 'pointerdown');
      cursorOverride={x:420,y:310};
      await pointer('html', 'pointermove');
      await pointer('html', 'pointerup');
      const actual=win.getBounds();
      for (const key of ['x','y','width','height']) {
        const target=initial[key]+expected[key]-gestureStart[key];
        assert.ok(Math.abs(actual[key]-target)<=1, `${edge} ${key}: ${actual[key]} vs ${target}`);
      }
    }
    win.setBounds(gestureStart);
    const beforeMove=win.getBounds();
    cursorOverride={x:400,y:300};
    await pointer('.side-foot', 'pointerdown');
    cursorOverride={x:440,y:330};
    await pointer('html','pointermove');
    for (const dx of [41,43,70,100,40]) {
      cursorOverride={x:400+dx,y:330};
      await pointer('html','pointermove');
      const moving=win.getBounds();
      assert.ok(Math.abs(moving.width-beforeMove.width)<=1 && Math.abs(moving.height-beforeMove.height)<=1,
        '150% DPI 下连续移动不能逐次增大窗口，允许1 DIP物理像素取整');
    }
    await pointer('html','pointerup');
    const moved=win.getBounds();
    assert.ok(Math.abs(moved.x-beforeMove.x-40)<=1 && Math.abs(moved.y-beforeMove.y-30)<=1);
    assert.ok(Math.abs(moved.width-beforeMove.width)<=1); assert.ok(Math.abs(moved.height-beforeMove.height)<=1);
    for (const selector of ['#searchInput','.play-btn','.bar','.card']) {
      cursorOverride={x:400,y:300};
      await pointer(selector,'pointerdown');
      cursorOverride={x:500,y:400};
      await pointer('html','pointermove');
      await pointer('html','pointerup');
      assert.deepEqual(win.getBounds(),moved, `${selector} 不应移动窗口`);
    }
    win.maximize();
    await waitFor("document.querySelectorAll('.window-resize').length === 0");
    assert.ok(win.isMaximized());
    cursorOverride={x:400,y:300};
    await pointer('.side-foot','pointerdown');
    await pointer('html','pointerup');
    assert.ok(win.isMaximized(), '最大化时单击空白处不能意外还原窗口');
    await pointer('.side-foot','pointerdown');
    cursorOverride={x:440,y:330};
    await pointer('html','pointermove');
    await pointer('html','pointerup');
    assert.equal(win.isMaximized(),false,'最大化窗口拖动空白处应还原并移动');
    await waitFor("document.querySelectorAll('.window-resize').length === 8");
    cursorOverride=null;
    win.setBounds(originalBounds);
    checks.push('eight resize edges, DPI-stable blank movement, maximized restore and controls excluded');
    await waitFor("!!document.querySelector('.playlist-nav .menu-item')");
    assert.equal(await js("document.querySelectorAll('.card-fallback strong').length"), 12);
    assert.equal(await js("document.querySelector('.quality-btn').tagName"), 'SELECT');
    assert.deepEqual(await js("Array.from(document.querySelector('.quality-btn').options,o=>o.value)"), ['128','192','320','740','999']);
    checks.push('cover fallback and quality select');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await wc.capturePage().then(image => fs.writeFileSync(path.join(dir, 'home.png'), image.toPNG()));
    console.log('SMOKE_SCREENSHOT', path.join(dir, 'home.png'));
    await js("document.querySelector('button[title=关于]').click()");
    await waitFor("!!document.querySelector('.modal')");
    const about = await js("document.querySelector('.modal').textContent");
    assert.ok(about.includes(process.versions.electron), '关于显示真实 Electron 版本'); checks.push('about IPC');
    await js("document.querySelector('.modal .btn.primary').click()");
    await js("document.querySelector('.playlist-nav .menu-item').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:160,clientY:300}))");
    await waitFor("!!document.querySelector('.context-menu')");
    await js("Array.from(document.querySelectorAll('.context-menu button')).find(b=>b.textContent.includes('导出歌单配置')).click()");
    await waitFor("Array.from(document.querySelectorAll('.toast')).some(t=>t.textContent.includes('歌单配置已导出'))");
    assert.equal(JSON.parse(fs.readFileSync(exported, 'utf8')).tracks[0].id, '1'); checks.push('export real IPC and file');
    await js("document.querySelector('.playlist-nav .menu-item').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:160,clientY:300}))");
    await waitFor("!!document.querySelector('.context-menu')");
    await js("Array.from(document.querySelectorAll('.context-menu button')).find(b=>b.textContent.includes('删除歌单')).click()");
    await waitFor("!!document.querySelector('.modal')");
    assert.equal(await js("!!document.querySelector('.modal [data-review-injection]')"), false);
    assert.ok((await js("document.querySelector('.modal-body').textContent")).includes(name)); checks.push('sidebar untrusted name is text');
    await js("document.querySelector('.modal .btn.ghost').click(); document.querySelector('.playlist-nav .menu-item').click()");
    await waitFor("!!document.querySelector('.coll-actions .danger')");
    await js("document.querySelector('.coll-actions .danger').click()");
    await waitFor("!!document.querySelector('.modal')");
    assert.equal(await js("!!document.querySelector('.modal [data-review-injection]')"), false); checks.push('collection untrusted name is text');
    await js("document.querySelector('.modal .btn.ghost').click(); document.querySelector('.cover-expand').click()");
    await waitFor("document.querySelector('.np-page').classList.contains('in')");
    for (const [dx, dy] of [[2,2],[22,2],[42,2],[2,22],[22,22],[42,22],[2,42],[22,42],[42,42]]) {
      const rect = await js("document.querySelector('.np-close').getBoundingClientRect().toJSON()");
      assert.equal(rect.width, 45, '返回按钮宽度必须为45px');
      assert.equal(rect.height, 45, '返回按钮高度必须为45px');
      assert.equal(await js("getComputedStyle(document.querySelector('.np-close')).getPropertyValue('-webkit-app-region')"), 'no-drag');
      const x = Math.round(rect.x + dx), y = Math.round(rect.y + dy);
      assert.ok(await js(`document.querySelector('.np-close').contains(document.elementFromPoint(${x},${y}))`), `返回按钮点击范围应包含${dx},${dy}`);
      wc.sendInputEvent({ type: 'mouseMove', x, y });
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      await waitFor("!document.querySelector('.np-page').classList.contains('in')");
      await js("document.querySelector('.cover-expand').click()");
      await waitFor("document.querySelector('.np-page').classList.contains('in')");
    }
    checks.push('45px back button full hit area, nine mouse click positions');
    await js("document.querySelector('.np-page button[title=播放队列]').click()");
    await waitFor("document.querySelector('.queue-panel').classList.contains('in')");
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.ok(await js("(()=>{const q=document.querySelector('.queue-panel'),r=q.getBoundingClientRect();return q.contains(document.elementFromPoint(r.left+30,r.top+30));})()"));
    checks.push('queue above now-playing');
    await listening;
    await js("document.querySelector('.queue-panel button[title=关闭]').click(); document.querySelector('.np-close').click(); document.querySelector('.trow').click(); document.querySelector('.desktop-lyrics-toggle').click()");
    const overlay = BrowserWindow.getAllWindows().find(w => w !== win);
    assert.ok(overlay, '桌面歌词创建独立窗口');
    if (overlay.webContents.isLoading()) await new Promise(resolve => overlay.webContents.once('did-finish-load', resolve));
    const overlayJs = code => overlay.webContents.executeJavaScript(code);
    const overlayBounds = overlay.getBounds();
    const cursorInside = () => { const b = overlay.getBounds(); return { x: b.x + b.width / 2, y: b.y + 30 }; };
    const cursorOutside = () => { const b = overlay.getBounds(); return { x: b.x - 50, y: b.y - 50 }; };
    cursorOverride = cursorInside();
    const overlayWait = async expression => {
      for (let i = 0; i < 100; i++) {
        if (await overlayJs(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      throw Error('桌面歌词等待失败: ' + expression);
    };
    assert.ok(overlay.isAlwaysOnTop());
    assert.equal(overlay.getParentWindow(), null);
    await overlayWait("document.querySelector('.current-line').textContent.includes('桌面歌词测试')");
    await overlayWait("document.querySelector('.current-translation')?.textContent==='中文翻译 <b>首句</b>'");
    assert.equal(await overlayJs("!!document.querySelector('.lyric-content b')"), false);
    assert.equal(await overlayJs("document.querySelector('.next-translation').textContent"), '第二句中文翻译');
    assert.equal(await overlayJs("!!document.querySelector('.lyric-content img')"), false);
    await overlayWait("document.querySelector('.desktop-lyrics').classList.contains('is-hovered')");
    const toolbarGap = await overlayJs("document.querySelector('.current-line').getBoundingClientRect().top - document.querySelector('.lyrics-lock-toggle').getBoundingClientRect().bottom");
    assert.ok(Math.abs(toolbarGap - 5) < 1, `功能按钮与歌词间距应为5px，实际${toolbarGap}`);
    let unlockedLockRect = await overlayJs("document.querySelector('.lyrics-lock-toggle').getBoundingClientRect().toJSON()");
    assert.equal(await overlayJs("getComputedStyle(document.querySelector('.lyrics-lock-toggle')).backgroundColor"), 'rgba(0, 0, 0, 0)');
    assert.equal(await overlayJs("getComputedStyle(document.querySelector('.lyrics-lock-toggle')).color"), 'rgb(255, 255, 255)');
    checks.push('independent always-on-top lyric window and safe text');
    const lyricStyle = selector => overlayJs(`(()=>{const s=getComputedStyle(document.querySelector(${JSON.stringify(selector)}));return {color:s.color,opacity:s.opacity,stroke:s.webkitTextStrokeWidth,outline:s.webkitTextStrokeColor};})()`);
    const originalColor = await lyricStyle('.current-line');
    for (const selector of ['.next-line','.current-translation','.next-translation']) {
      const style = await lyricStyle(selector);
      assert.equal(style.color, selector === '.current-translation' ? originalColor.color : 'rgb(196, 196, 196)', '当前原文和翻译使用选定颜色，未播放的下一句及翻译保持灰色');
      assert.equal(style.opacity, '1', '歌词不能降低透明度');
      assert.ok(parseFloat(style.stroke) >= 0.6, '歌词应有清晰描边');
    }
    await overlayJs("document.querySelector('button[title=歌词设置]').click()");
    cursorOverride = cursorOutside();
    await overlayWait("!document.querySelector('.desktop-lyrics').classList.contains('is-hovered')");
    assert.equal(await overlayJs("!!document.querySelector('.lyrics-settings input[type=color]')"), true, '鼠标移出时必须保留调色板所属的设置面板');
    await overlayJs("(()=>{const input=document.querySelector('input[type=color]');input.value='#143c6b';input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await overlayWait("window.desktopLyrics.status().then(s=>s.color==='#143c6b')");
    for (const selector of ['.current-line','.next-line','.current-translation','.next-translation']) {
      const style = await lyricStyle(selector);
      const next = selector === '.next-line' || selector === '.next-translation';
      assert.equal(style.color, next ? 'rgb(196, 196, 196)' : 'rgb(20, 60, 107)');
      assert.equal(style.outline, next ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)', '深色当前句使用浅色描边，灰色下一句保持深色描边');
    }
    await overlayJs("window.desktopLyrics.configure({color:'#a8f4ac'})");
    await overlayWait("getComputedStyle(document.querySelector('.current-line')).webkitTextStrokeColor==='rgb(0, 0, 0)'");
    cursorOverride = cursorInside();
    await overlayWait("document.querySelector('.desktop-lyrics').classList.contains('is-hovered')");
    await overlayJs("document.querySelector('button[title=歌词设置]').click()");
    checks.push('current lyric highlighted, upcoming lyric gray, adaptive outlines and settings survive leaving window');
    const beforeFontBounds = overlay.getBounds();
    await overlayJs("document.querySelector('button[title=歌词设置]').click()");
    await overlayWait("!!document.querySelector('.font-size-trigger')");
    assert.equal(await overlayJs("!!document.querySelector('#lyrics-font-size, .lyrics-settings input[type=number]')"), false);
    await overlayJs("(()=>{const input=document.querySelector('.lyrics-settings-body input[type=range]');input.value='60';input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await overlayWait("window.desktopLyrics.status().then(s=>s.opacity===0.6)");
    await overlayJs("window.desktopLyrics.configure({opacity:0.48})");
    const settingsAnchor = await overlayJs("document.querySelector('.lyrics-settings-body').getBoundingClientRect().toJSON()");
    await overlayJs("document.querySelector('.font-size-trigger').click()");
    await overlayWait("!!document.querySelector('.font-size-menu')");
    assert.deepEqual(await overlayJs("Array.from(document.querySelectorAll('[data-font-size]'),b=>Number(b.dataset.fontSize))"), [12,16,20,24,28,32,36,40]);
    assert.equal(await overlayJs("document.querySelector('[data-font-size=\"32\"]').getAttribute('aria-checked')"), 'true');
    await new Promise(resolve => setTimeout(resolve, 150));
    const expandedAnchor = await overlayJs("document.querySelector('.lyrics-settings-body').getBoundingClientRect().toJSON()");
    for (const key of ['x','y','width','height']) assert.ok(Math.abs(expandedAnchor[key] - settingsAnchor[key]) <= 1, `展开字号菜单不能改变主设置面板的${key}`);
    const submenuRect = await overlayJs("document.querySelector('.font-size-menu').getBoundingClientRect().toJSON()");
    assert.ok(submenuRect.left >= 0 && submenuRect.right <= overlay.getContentBounds().width + 1, '字号子菜单应在窗口内完整显示');
    await overlayJs("document.querySelector('.font-size-trigger').click()");
    const collapsedAnchor = await overlayJs("document.querySelector('.lyrics-settings-body').getBoundingClientRect().toJSON()");
    for (const key of ['x','y','width','height']) assert.ok(Math.abs(collapsedAnchor[key] - settingsAnchor[key]) <= 1, `收起字号菜单不能改变主设置面板的${key}`);
    await overlayJs("document.querySelector('.font-size-trigger').click()");
    await overlayWait("!!document.querySelector('.font-size-menu')");
    await overlay.capturePage().then(image => fs.writeFileSync(path.join(dir, 'desktop-lyrics-font-menu.png'), image.toPNG()));
    assert.ok(await overlayJs("document.querySelector('[data-font-size=\"40\"]').getBoundingClientRect().bottom <= innerHeight"), '字号菜单底部可见');
    await overlayJs("document.querySelector('[data-font-size=\"40\"]').click()");
    await overlayWait("getComputedStyle(document.querySelector('.current-line')).fontSize==='40px'");
    assert.equal(await overlayJs("getComputedStyle(document.querySelector('.current-translation')).fontSize"), '24px');
    assert.equal(await overlayJs("getComputedStyle(document.querySelector('.lyrics-lock-toggle svg')).width"), '28px');
    assert.equal(await overlayJs("!!document.querySelector('.lyrics-settings')"), false);
    await overlayJs("document.querySelector('button[title=歌词设置]').click();document.querySelector('.font-size-trigger')?.click()");
    await overlayWait("!!document.querySelector('.font-size-trigger')");
    await overlayJs("document.querySelector('.font-size-trigger').click()");
    await overlayWait("!!document.querySelector('[data-font-size=\"12\"]')");
    assert.equal(await overlayJs("document.querySelector('[data-font-size=\"40\"]').getAttribute('aria-checked')"), 'true');
    await overlayJs("document.querySelector('[data-font-size=\"12\"]').click()");
    await overlayWait("getComputedStyle(document.querySelector('.current-line')).fontSize==='12px'");
    assert.equal(await overlayJs("getComputedStyle(document.querySelector('.next-line')).fontSize"), '10.56px');
    for (let i = 0; i < 20 && JSON.parse(fs.readFileSync(path.join(dir, 'desktop-lyrics.json'))).fontSize !== 12; i++) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'desktop-lyrics.json'))).fontSize, 12);
    assert.ok(overlay.getBounds().width < beforeFontBounds.width, '字号减小时窗口宽度减小');
    await overlay.capturePage().then(image => fs.writeFileSync(path.join(dir, 'desktop-lyrics-font-size.png'), image.toPNG()));
    await overlayJs("window.desktopLyrics.configure({fontSize:32})");
    await overlayWait("getComputedStyle(document.querySelector('.current-line')).fontSize==='32px'");
    // 暂停在同一句，比较20px和56px的内容自适应尺寸。
    await overlayJs("document.querySelector('button[title=暂停]')?.click();window.desktopLyrics.configure({fontSize:20})");
    await overlayWait("getComputedStyle(document.querySelector('.current-line')).fontSize==='20px'");
    await new Promise(resolve => setTimeout(resolve, 120));
    const smallFontBounds = overlay.getBounds();
    await overlayJs("window.desktopLyrics.configure({fontSize:56})");
    await overlayWait("getComputedStyle(document.querySelector('.current-line')).fontSize==='56px'");
    await overlayWait("document.querySelector('.lyric-content').getBoundingClientRect().bottom <= window.innerHeight");
    assert.ok(overlay.getBounds().height > smallFontBounds.height);
    assert.ok(overlay.getBounds().width > smallFontBounds.width);
    await new Promise(resolve => setTimeout(resolve, 120));
    await overlay.capturePage().then(image => fs.writeFileSync(path.join(dir, 'desktop-lyrics-auto-large.png'), image.toPNG()));
    const originalFrame = await overlayJs("({current:document.querySelector('.current-line').textContent,next:document.querySelector('.next-line').textContent,currentTranslation:document.querySelector('.current-translation')?.textContent||'',nextTranslation:document.querySelector('.next-translation')?.textContent||'',playing:false})");
    await js('window.bridge.lyrics.update(' + JSON.stringify({ ...originalFrame, current: '这是一段用于检查大字号自动换行和完整显示的歌词。'.repeat(8) }) + ')');
    await overlayWait("document.querySelector('.current-line').getBoundingClientRect().height > 3 * 56");
    await overlayWait("document.querySelector('.lyric-content').getBoundingClientRect().bottom <= window.innerHeight");
    assert.ok(overlay.getBounds().height > 400, '长歌词换行后允许区域高于400px');
    const fitted = overlay.getBounds(), workArea = screen.getDisplayMatching(fitted).workArea;
    assert.ok(fitted.x >= workArea.x && fitted.y >= workArea.y && fitted.x + fitted.width <= workArea.x + workArea.width + 1 && fitted.y + fitted.height <= workArea.y + workArea.height + 1);
    await js('window.bridge.lyrics.update(' + JSON.stringify(originalFrame) + ')');
    await overlayWait("document.querySelector('.current-line').textContent===" + JSON.stringify(originalFrame.current));
    await overlayJs("window.desktopLyrics.configure({fontSize:20})");
    await overlayWait("window.innerHeight < " + overlay.getBounds().height);
    await new Promise(resolve => setTimeout(resolve, 120));
    await overlay.capturePage().then(image => fs.writeFileSync(path.join(dir, 'desktop-lyrics-auto-small.png'), image.toPNG()));
    await overlayJs("window.desktopLyrics.configure({fontSize:32});document.querySelector('button[title=播放]')?.click()");
    await overlayWait("getComputedStyle(document.querySelector('.current-line')).fontSize==='32px'");
    checks.push('font preset submenu replaces slider, supports 12px, selection state and persistence, preserves background control');
    await overlayJs("document.querySelector('button[title=暂停]')?.click()");
    const nativeSetBounds = overlay.setBounds.bind(overlay);
    const resizeTrace = [];
    overlay.setBounds = (bounds, ...args) => { resizeTrace.push({ ...bounds, time: Date.now() }); return nativeSetBounds(bounds, ...args); };
    await overlayJs(`(async()=>{
      for (const fontSize of [...Array.from({length:19},(_,i)=>20+i*2), ...Array.from({length:19},(_,i)=>56-i*2)]) {
        await window.desktopLyrics.configure({fontSize});
        await new Promise(resolve=>setTimeout(resolve,10));
      }
    })()`);
    await new Promise(resolve => setTimeout(resolve, 250));
    fs.writeFileSync(path.join(dir, 'lyrics-resize-trace.json'), JSON.stringify(resizeTrace));
    console.log('LYRICS_RESIZE_CALLS', resizeTrace.length);
    assert.ok(resizeTrace.length <= 24, `连续放大缩小应合并窗口调整，实际发生${resizeTrace.length}次`);
    const settledCount = resizeTrace.length;
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(resizeTrace.length, settledCount, '停止调整后不能继续反复改变窗口大小');
    overlay.setBounds = nativeSetBounds;
    await overlayJs("window.desktopLyrics.configure({fontSize:32});document.querySelector('button[title=播放]')?.click()");
    await overlayWait("getComputedStyle(document.querySelector('.current-line')).fontSize==='32px'");
    checks.push('rapid font growth and shrink coalesce native resizes and settle without feedback');
    await overlayWait("!!document.querySelector('button[title=暂停]')");
    await overlayJs("document.querySelector('button[title=暂停]').click()");
    await overlayWait("!!document.querySelector('button[title=播放]')");
    await overlayJs("document.querySelector('button[title=播放]').click()");
    await overlayWait("document.querySelector('.current-line').textContent==='下一句歌词'");
    await overlayWait("document.querySelector('.current-translation')?.textContent==='第二句中文翻译'");
    assert.equal(await overlayJs("!!document.querySelector('.next-translation')"), false);
    await overlayJs("document.querySelector('button[title=暂停]').click()");
    checks.push('desktop controls, bilingual timed lyrics and 5px toolbar spacing');
    cursorOverride = cursorInside();
    await new Promise(resolve => setTimeout(resolve, 100));
    unlockedLockRect = await overlayJs("document.querySelector('.lyrics-lock-toggle').getBoundingClientRect().toJSON()");
    await overlayJs("window.desktopLyrics.configure({locked:true})");
    await overlayWait("document.querySelector('.desktop-lyrics').classList.contains('locked')");
    assert.equal(overlay.isFocusable(), false);
    assert.equal(await overlayJs("getComputedStyle(document.querySelector('.desktop-lyrics')).backgroundColor"), 'rgba(0, 0, 0, 0)');
    assert.equal(await overlayJs("getComputedStyle(document.querySelector('.lyrics-toolbar')).visibility"), 'hidden');
    assert.deepEqual(await overlayJs("document.querySelector('.lyrics-lock-toggle').getBoundingClientRect().toJSON()"), unlockedLockRect);
    assert.equal(await overlayJs("getComputedStyle(document.querySelector('.lyrics-lock-toggle')).backgroundColor"), 'rgba(0, 0, 0, 0)');
    assert.equal(await overlayJs("getComputedStyle(document.querySelector('.lyrics-lock-toggle')).visibility"), 'visible');
    cursorOverride = cursorOutside();
    await overlayWait("!document.querySelector('.desktop-lyrics').classList.contains('is-hovered')");
    assert.equal(await overlayJs("getComputedStyle(document.querySelector('.lyrics-lock-toggle')).visibility"), 'hidden');
    await new Promise(resolve => setTimeout(resolve, 120));
    await overlay.capturePage();
    const lockedImage = await overlay.capturePage();
    fs.writeFileSync(path.join(dir, 'desktop-lyrics-locked.png'), lockedImage.toPNG());
    assert.equal(lockedImage.crop({x:10,y:80,width:1,height:1}).toBitmap()[3], 0, '锁定背景内部必须完全透明');
    console.log('LOCKED_LYRICS_SCREENSHOT', path.join(dir, 'desktop-lyrics-locked.png'));
    cursorOverride = cursorInside();
    await overlayWait("document.querySelector('.desktop-lyrics').classList.contains('is-hovered')");
    await overlay.capturePage();
    await overlay.capturePage().then(image => fs.writeFileSync(path.join(dir, 'desktop-lyrics-locked-hover.png'), image.toPNG()));
    await overlayJs("document.querySelector('.lyrics-lock-toggle').click()");
    await overlayWait("!document.querySelector('.desktop-lyrics').classList.contains('locked')");
    assert.notEqual(await overlayJs("getComputedStyle(document.querySelector('.desktop-lyrics')).backgroundColor"), 'rgba(0, 0, 0, 0)');
    assert.deepEqual(await overlayJs("document.querySelector('.lyrics-lock-toggle').getBoundingClientRect().toJSON()"), unlockedLockRect);
    cursorOverride = cursorOutside();
    await overlayWait("!document.querySelector('.desktop-lyrics').classList.contains('is-hovered')");
    assert.equal(await overlayJs("getComputedStyle(document.querySelector('.lyrics-toolbar')).visibility"), 'hidden');
    assert.equal(await overlayJs("getComputedStyle(document.querySelector('.desktop-lyrics')).backgroundColor"), 'rgba(0, 0, 0, 0)');
    cursorOverride = cursorInside();
    await overlayWait("document.querySelector('.desktop-lyrics').classList.contains('is-hovered')");
    await overlayJs("window.desktopLyrics.configure({locked:true})");
    await js("document.querySelector('.desktop-lyrics-toggle').click()");
    await overlayWait("!document.querySelector('.desktop-lyrics').classList.contains('locked')");
    assert.ok(overlay.isFocusable());
    if (process.platform === 'win32') {
      const handle = overlay.getNativeWindowHandle();
      const hwnd = handle.length === 8 ? handle.readBigUInt64LE(0).toString() : handle.readUInt32LE(0).toString();
      const nativeCheck = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class GDTaskbarCheck { [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int n); }';
        $style = [GDTaskbarCheck]::GetWindowLong([IntPtr]::new([long]${hwnd}), -20);
        if (($style -band 128) -eq 0) { throw 'Lyrics must have WS_EX_TOOLWINDOW to stay out of task switching'; }
        Write-Output 'WINDOWS_TOOLWINDOW_PASS'`;
      const output = require('node:child_process').execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', nativeCheck], { windowsHide: true, encoding: 'utf8' });
      assert.ok(output.includes('WINDOWS_TOOLWINDOW_PASS'));
      checks.push('Windows auxiliary lyrics excluded from task switching');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    await overlay.capturePage();
    await overlay.capturePage().then(image => fs.writeFileSync(path.join(dir, 'desktop-lyrics.png'), image.toPNG()));
    console.log('LYRICS_SCREENSHOT', path.join(dir, 'desktop-lyrics.png'));
    await overlayJs("window.desktopLyrics.hide()");
    checks.push('shared lock position, transparent lock backgrounds, hover and unlock');
    await js(fs.readFileSync(process.env.GD_SMOKE_BUNDLE, 'utf8'));
    await js("smokeHarness.setQueue([{id:'1',name:'音质测试',source:'netease',artist:['测试']}],0,false); smokeHarness.loadAndPlay(false)");
    await waitFor('smokeHarness.audio.readyState >= 1');
    await js('smokeHarness.audio.currentTime=42; smokeHarness.cycleQuality()');
    await waitFor('smokeHarness.audio.readyState >= 1 && Math.abs(smokeHarness.audio.currentTime-42)<0.5');
    assert.equal(await js('smokeHarness.audio.paused'), true); checks.push('real audio quality paused seek');
    await wc.executeJavaScript('smokeHarness.audio.play()', true);
    await js('smokeHarness.cycleQuality()');
    await waitFor('!smokeHarness.audio.paused && smokeHarness.audio.currentTime >= 42');
    checks.push('real audio quality playing seek');
    assert.ok(playbackReferers.length > 0);
    assert.ok(playbackReferers.every(value => value === 'https://music.gdstudio.org/'), '播放媒体与当前官网保持相同来源，避免酷我403');
    checks.push('streaming uses current website referer');
    await js('smokeHarness.clearQueue()');
    const beforeAudioDownload = chromiumRequests;
    await js("window.bridge.state.save({favorites:[{id:'offline',source:'netease',name:'离线测试'}],quality:'320'})");
    await waitFor("window.bridge.audio.status().then(r=>r.data.ready===1)");
    assert.ok(chromiumRequests > beforeAudioDownload, '音频下载必须使用 Chromium 通道');
    const requestCountBeforeExport = playbackReferers.length;
    const manualDownload = await js("window.bridge.file.downloadTrack({source:'netease',id:'offline',br:'320',name:'离线测试'})");
    assert.equal(manualDownload.ok, true);
    assert.equal(manualDownload.data.saved, true);
    assert.deepEqual(fs.readFileSync(manualDownload.data.filePath), wav);
    assert.equal(playbackReferers.length, requestCountBeforeExport, '手动下载复用完整缓存，不重复请求');
    const streamOnlyDownload = await js("window.bridge.file.downloadTrack({source:'embeat',id:'stream',name:'在线音乐'})");
    assert.equal(streamOnlyDownload.ok, false);
    assert.match(streamOnlyDownload.error, /仅支持在线播放/);
    checks.push('manual download copies complete cache and Embeat does not download');
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await js("smokeHarness.S.quality='320';smokeHarness.setQueue([{id:'offline',source:'netease',name:'离线测试',artist:[]}],0,false);smokeHarness.loadAndPlay(false)");
    await waitFor("smokeHarness.audio.readyState>=1 && smokeHarness.audio.src.startsWith('app://bundle/audio-cache/')");
    await js('smokeHarness.audio.currentTime=60');
    await wc.executeJavaScript('smokeHarness.audio.play()', true);
    await waitFor('!smokeHarness.audio.paused && smokeHarness.audio.currentTime>=60');
    checks.push('favorites download then offline local audio and seek');
    await js('smokeHarness.clearQueue()');
    assert.deepEqual(rendererErrors, [], '渲染进程不应出现跨窗口数据克隆等错误');
    await js("document.querySelector('button[title=新建歌单]').click()");
    await waitFor("!!document.querySelector('.modal input')");
    await js("(()=>{const input=document.querySelector('.modal input');input.value='托盘退出保存测试';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.modal .btn.primary').click();})()");
    await waitFor("document.querySelector('.playlist-nav').textContent.includes('托盘退出保存测试')");
    app.once('will-quit', () => {
      try {
        assert.ok(nativeTray.isDestroyed(), '正常退出时必须移除托盘图标');
        const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
        assert.ok(saved.playlists.some(p => p.name === '托盘退出保存测试'), '从托盘立即退出也必须保存最新歌单');
        checks.push('tray quit removes native icon and flushes latest renderer state');
        console.log('ELECTRON_SMOKE_PASS', JSON.stringify(checks));
        clearTimeout(watchdog);
      } catch (err) { console.error(err); app.exit(1); }
    });
    nativeTrayMenu.items[1].click();
  } catch (err) { console.error(err); clearTimeout(watchdog); app.exit(1); }
});
