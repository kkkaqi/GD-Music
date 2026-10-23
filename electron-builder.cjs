'use strict';

const path = require('node:path');

module.exports = {
  appId: 'org.gdmusic.desktop',
  productName: 'GD-Music',
  electronVersion: require('electron/package.json').version,
  electronDist: path.dirname(require('electron')),
  directories: { output: 'release', buildResources: 'assets' },
  asar: true,
  npmRebuild: false,
  files: [
    'package.json',
    'src/main/**/*',
    'src/shared/**/*',
    'src/renderer/dist/**/*',
    'assets/icon.png',
    'assets/icon.ico',
    'README.md',
  ],
  win: {
    icon: 'assets/icon.ico',
    executableName: 'GD-Music',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
    ],
  },
  nsis: {
    artifactName: 'GD-Music-${version}-Windows-x64-Setup.${ext}',
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'GD-Music',
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
  },
  portable: {
    artifactName: 'GD-Music-${version}-Windows-x64-Portable.${ext}',
    unpackDirName: 'GD-Music-${version}',
  },
};
