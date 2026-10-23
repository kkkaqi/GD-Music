'use strict';

class SystemTray {
  constructor({ Tray, Menu, icon, onOpen, onQuit }) {
    Object.assign(this, { Tray, Menu, icon, onOpen, onQuit });
    this.tray = null;
  }

  create() {
    if (this.tray && !this.tray.isDestroyed()) return;
    this.tray = new this.Tray(this.icon);
    this.tray.setToolTip('GD-Music');
    this.tray.setContextMenu(this.Menu.buildFromTemplate([
      { label: '打开GD-Music', click: this.onOpen },
      { label: '退出', click: this.onQuit },
    ]));
    this.tray.on('click', this.onOpen);
    this.tray.on('double-click', this.onOpen);
  }

  destroy() {
    if (this.tray && !this.tray.isDestroyed()) this.tray.destroy();
    this.tray = null;
  }
}

module.exports = { SystemTray };
