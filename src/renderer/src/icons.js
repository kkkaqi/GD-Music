/* 图标：内联 SVG，统一 1.7 描边，24x24 网格 */
const stroke = (inner) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const solid = (inner) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" stroke="none" aria-hidden="true">${inner}</svg>`;

export const ICONS = {
  settings: stroke('<path d="M9 3h6l6 6v6l-6 6H9l-6-6V9z"/><circle cx="12" cy="12" r="3.5"/>'),
  lock: stroke('<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3M12 14v3"/>'),
  unlock: stroke('<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M10 10V6a4 4 0 018 0v2M12 14v3"/>'),
  play: solid('<path d="M8 5.2v13.6c0 .9 1 1.4 1.7.9l10-6.8c.6-.4.6-1.4 0-1.8l-10-6.8c-.7-.5-1.7 0-1.7.9z"/>'),
  pause: solid('<rect x="6.6" y="5" width="4" height="14" rx="1.4"/><rect x="13.4" y="5" width="4" height="14" rx="1.4"/>'),
  prev: solid('<path d="M18.5 5.6v12.8c0 .9-1 1.4-1.7.9l-8.6-6.4a1.1 1.1 0 010-1.8l8.6-6.4c.7-.5 1.7 0 1.7.9z"/><rect x="4.2" y="5" width="2.4" height="14" rx="1.2"/>'),
  next: solid('<path d="M5.5 5.6v12.8c0 .9 1 1.4 1.7.9l8.6-6.4a1.1 1.1 0 000-1.8L7.2 4.7c-.7-.5-1.7 0-1.7.9z"/><rect x="17.4" y="5" width="2.4" height="14" rx="1.2"/>'),

  'chevron-left': stroke('<path d="M15 18l-6-6 6-6"/>'),
  'chevron-right': stroke('<path d="M9 18l6-6-6-6"/>'),
  'chevron-down': stroke('<path d="M6 9l6 6 6-6"/>'),

  search: stroke('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>'),
  x: stroke('<path d="M18 6L6 18M6 6l12 12"/>'),
  plus: stroke('<path d="M12 5v14M5 12h14"/>'),
  check: stroke('<path d="M4.5 12.5l5 5L20 6.5"/>'),
  info: stroke('<circle cx="12" cy="12" r="9"/><path d="M12 11.5v5"/><path d="M12 7.6h.01" stroke-width="2.4"/>'),

  'win-min': stroke('<path d="M5 12h14"/>'),
  'win-max': stroke('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
  'win-restore': stroke('<rect x="4" y="8" width="12" height="12" rx="2"/><path d="M8 8V5a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1h-3"/>'),
  'win-close': stroke('<path d="M6 6l12 12M18 6L6 18"/>'),

  compass: stroke('<circle cx="12" cy="12" r="9"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/>'),
  heart: stroke('<path d="M20.3 5.9a5.1 5.1 0 00-7.2 0L12 7l-1.1-1.1a5.1 5.1 0 10-7.2 7.2l8.3 8.3 8.3-8.3a5.1 5.1 0 000-7.2z"/>'),
  'heart-fill': solid('<path d="M20.3 5.9a5.1 5.1 0 00-7.2 0L12 7l-1.1-1.1a5.1 5.1 0 10-7.2 7.2l8.3 8.3 8.3-8.3a5.1 5.1 0 000-7.2z"/>'),
  clock: stroke('<circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.2 1.9"/>'),
  music: stroke('<path d="M9 18V6.2l10.2-2v11.6"/><circle cx="6.6" cy="18" r="2.4"/><circle cx="16.8" cy="15.8" r="2.4"/>'),
  trash: stroke('<path d="M4 7h16"/><path d="M9.5 7V4.6h5V7"/><path d="M6.4 7l.9 12.4h9.4L17.6 7"/>'),
  download: stroke('<path d="M12 3.5v11.6"/><path d="M7.4 10.6L12 15.2l4.6-4.6"/><path d="M4.5 20.5h15"/>'),
  upload: stroke('<path d="M12 15.1V3.5"/><path d="M7.4 8.1L12 3.5l4.6 4.6"/><path d="M4.5 20.5h15"/>'),
  more: solid('<circle cx="5.2" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.8" cy="12" r="1.7"/>'),
  list: stroke('<path d="M8.5 6h12M8.5 12h12M8.5 18h12"/><circle cx="4.4" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.4" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.4" cy="18" r="1.3" fill="currentColor" stroke="none"/>'),
  mic: stroke('<rect x="9" y="2.8" width="6" height="10.6" rx="3"/><path d="M5.4 11.4a6.6 6.6 0 0013.2 0"/><path d="M12 18v3.2"/>'),

  repeat: stroke('<path d="M17 2.8l3.2 3.2L17 9.2"/><path d="M20.2 6H8.2a4 4 0 00-4 4v1.4"/><path d="M7 21.2L3.8 18 7 14.8"/><path d="M3.8 18h12a4 4 0 004-4v-1.4"/>'),
  'repeat-one': stroke('<path d="M17 2.8l3.2 3.2L17 9.2"/><path d="M20.2 6H8.2a4 4 0 00-4 4v1.4"/><path d="M7 21.2L3.8 18 7 14.8"/><path d="M3.8 18h12a4 4 0 004-4v-1.4"/><path d="M10.6 10.6l1.5-1v4.2" stroke-width="1.6"/>'),
  shuffle: stroke('<path d="M16.4 3.2h4.4v4.4"/><path d="M20.8 3.2L4 20"/><path d="M20.8 16.4v4.4h-4.4"/><path d="M15.2 15.2l5.6 5.6"/><path d="M4 4l5.2 5.2"/>'),

  volume: stroke('<path d="M11 4.6L6.4 8.4H3.6v7.2h2.8L11 19.4z"/><path d="M15.2 8.8a4.4 4.4 0 010 6.4"/><path d="M17.8 6.4a7.8 7.8 0 010 11.2"/>'),
  'volume-mute': stroke('<path d="M11 4.6L6.4 8.4H3.6v7.2h2.8L11 19.4z"/><path d="M15.6 9.6l4.8 4.8M20.4 9.6l-4.8 4.8"/>'),
  expand: stroke('<path d="M14.6 3.4h6v6"/><path d="M9.4 20.6h-6v-6"/><path d="M20.6 3.4l-6.6 6.6"/><path d="M3.4 20.6L10 14"/>'),
  external: stroke('<path d="M14 4h6v6"/><path d="M20 4l-8.4 8.4"/><path d="M18 14.2V19a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h4.8"/>'),
  disc: stroke('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.4"/>'),
  folder: stroke('<path d="M3.6 7.2a1.6 1.6 0 011.6-1.6h3.6l1.8 2.2h8.2a1.6 1.6 0 011.6 1.6v9.4a1.6 1.6 0 01-1.6 1.6H5.2a1.6 1.6 0 01-1.6-1.6z"/>'),
  sparkle: stroke('<path d="M12 3.4l1.9 5.1 5.1 1.9-5.1 1.9L12 17.4l-1.9-5.1-5.1-1.9 5.1-1.9z"/>'),
};
