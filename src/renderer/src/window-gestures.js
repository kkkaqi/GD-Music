// 原生标题栏继续由系统处理；其余空白区域通过屏幕坐标移动，控件和滚动区域保持交互。
const INTERACTIVE = 'button,input,textarea,select,a,label,[role="button"],[contenteditable="true"],'
  + '.bar,.card,.trow,.qrow,.menu-item,.np-disc,.ly-line,.lyrics-scroll,.context-menu,.modal-layer,[data-window-no-drag]';

function onScrollbar(event) {
  for (let element = event.target; element instanceof Element; element = element.parentElement) {
    const rect = element.getBoundingClientRect();
    if (element.offsetWidth > element.clientWidth + 2 && event.clientX >= rect.left + element.clientLeft + element.clientWidth) return true;
    if (element.offsetHeight > element.clientHeight + 2 && event.clientY >= rect.top + element.clientTop + element.clientHeight) return true;
  }
  return false;
}

export function installWindowGestures(bridge) {
  let active = null;
  let frame = 0;
  function finish() {
    if (!active) return;
    const pointer = active.pointerId;
    active = null;
    cancelAnimationFrame(frame);
    frame = 0;
    bridge.updateGesture();
    bridge.endGesture();
    document.documentElement.classList.remove('window-moving');
    try { document.documentElement.releasePointerCapture(pointer); } catch {}
  }
  function down(event) {
    if (event.button !== 0 || event.defaultPrevented || !event.target.closest) return;
    const edge = event.target.closest('[data-window-resize]')?.dataset.windowResize;
    if (!edge && (event.target.closest(INTERACTIVE) || onScrollbar(event))) return;
    finish();
    const gesture = { pointerId: event.pointerId };
    active = gesture;
    event.preventDefault();
    try { document.documentElement.setPointerCapture(event.pointerId); } catch {}
    if (!edge) document.documentElement.classList.add('window-moving');
    bridge.beginGesture({ mode: edge ? 'resize' : 'move', edge: edge || '' }).then(accepted => {
      if (!accepted && active === gesture) finish();
    }).catch(() => { if (active === gesture) finish(); });
  }
  function move(event) {
    if (!active || event.pointerId !== active.pointerId || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; if (active) bridge.updateGesture(); });
  }
  function up(event) { if (active?.pointerId === event.pointerId) finish(); }
  document.addEventListener('pointerdown', down);
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
  document.documentElement.addEventListener('lostpointercapture', up);
  window.addEventListener('blur', finish);
  return () => {
    finish();
    document.removeEventListener('pointerdown', down);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
    document.documentElement.removeEventListener('lostpointercapture', up);
    window.removeEventListener('blur', finish);
  };
}
