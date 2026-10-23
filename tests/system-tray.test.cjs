const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SystemTray } = require('../src/main/system-tray');

function setup() {
  const icons = [];
  const actions = [];
  class Tray extends EventEmitter {
    constructor(icon) { super(); this.icon=icon; this.destroyed=false; icons.push(this); }
    setToolTip(text) { this.tooltip=text; }
    setContextMenu(menu) { this.menu=menu; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed=true; }
  }
  const tray = new SystemTray({ Tray, Menu:{buildFromTemplate:items=>({items})}, icon:'assets/icon.ico',
    onOpen:()=>actions.push('open'), onQuit:()=>actions.push('quit') });
  return {tray,icons,actions};
}

test('托盘使用应用图标和名称，右键菜单严格只有打开和退出两项', () => {
  const {tray,icons}=setup();tray.create();
  assert.equal(icons[0].icon,'assets/icon.ico');
  assert.equal(icons[0].tooltip,'GD-Music');
  assert.deepEqual(icons[0].menu.items.map(item=>item.label),['打开GD-Music','退出']);
});

test('托盘单击、双击和打开菜单均打开主窗口，退出菜单调用正常退出流程', () => {
  const {tray,icons,actions}=setup();tray.create();
  icons[0].emit('click');icons[0].emit('double-click');icons[0].menu.items[0].click();icons[0].menu.items[1].click();
  assert.deepEqual(actions,['open','open','open','quit']);
});

test('重复初始化不会创建多个托盘图标，退出销毁可重复调用', () => {
  const {tray,icons}=setup();tray.create();tray.create();
  assert.equal(icons.length,1);
  tray.destroy();tray.destroy();
  assert.equal(icons[0].isDestroyed(),true);
});
