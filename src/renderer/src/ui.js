/* 轻量 UI 层：Toast / Modal / 右键菜单 —— 全部用响应式状态驱动 */
import { reactive } from 'vue';

/* ----------------------------- Toast ----------------------------- */

let toastId = 0;
export const toasts = reactive([]);

export function toast(msg, kind = 'info', ms = 2600) {
  const id = ++toastId;
  toasts.push({ id, msg, kind });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, ms);
}

/* ----------------------------- Modal ----------------------------- */

export const modal = reactive({
  open: false,
  title: '',
  text: '',
  input: false,
  value: '',
  placeholder: '',
  okText: '确定',
  cancelText: '取消',
  _resolve: null,
});

/**
 * 打开弹窗，resolve 值为 'ok' | 'cancel'，
 * 若带输入框则 resolve 输入内容（取消为 null）
 */
export function showModal(opts) {
  return new Promise((resolve) => {
    modal.open = true;
    modal.title = opts.title || '';
    modal.text = opts.text || '';
    modal.input = !!opts.input;
    modal.value = opts.value || '';
    modal.placeholder = opts.placeholder || '';
    modal.okText = opts.okText || '确定';
    modal.cancelText = opts.cancelText || '取消';
    modal._resolve = resolve;
  });
}

export function resolveModal(result) {
  const fn = modal._resolve;
  modal.open = false;
  modal._resolve = null;
  if (fn) fn(result);
}

export const promptText = (opts) => showModal({ ...opts, input: true });

export async function confirmModal(opts) {
  const r = await showModal(opts);
  return r === 'ok';
}

/* --------------------------- 右键菜单 --------------------------- */

export const menu = reactive({ open: false, x: 0, y: 0, items: [] });

export function openMenu(x, y, items) {
  menu.items = items;
  menu.x = x;
  menu.y = y;
  menu.open = true;
}

export function closeMenu() {
  menu.open = false;
}

/* --------------------------- 通用小工具 --------------------------- */

export function focusSearchEl() {
  const el = document.querySelector('#searchInput');
  if (el) {
    el.focus();
    el.select();
  }
}
