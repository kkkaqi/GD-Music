import './styles/recognition.css';

const status = document.querySelector('#status');
const sources = [...document.querySelectorAll('[data-mode]')];
let changing = false;
async function call(action) {
  try {
    const result = await action();
    if (!result?.ok) throw Error(result?.error || '操作失败，请重试');
    return true;
  } catch (error) {
    status.textContent = error.message;
    return false;
  }
}
for (const button of sources) {
  button.addEventListener('click', async () => {
    if (changing) return;
    changing = true;
    sources.forEach(item => { item.disabled = true; });
    try {
      if (await call(() => window.recognition.mode(button.dataset.mode))) {
        sources.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      }
    } finally {
      changing = false;
      sources.forEach(item => { item.disabled = false; });
    }
  });
}
document.querySelector('#reload').addEventListener('click', () => call(() => window.recognition.reload()));
document.querySelector('#search').addEventListener('submit', event => {
  event.preventDefault();
  call(() => window.recognition.search(document.querySelector('#query').value));
});
const unsubscribe = window.recognition.onStatus(message => { status.textContent = message; });
const stopDetection = window.recognition.onDetected(title => {
  document.querySelector('#query').value = title;
  status.textContent = '已识别到歌曲，点「搜索歌曲」在 GD Music 中查找。';
});
window.addEventListener('beforeunload', () => { unsubscribe(); stopDetection(); }, { once: true });
