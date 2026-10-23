/* LRC 歌词解析 + 双语合并 */
const TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** 解析 LRC 文本 → [{ t, text }]，按时间升序 */
export function parseLrc(text) {
  if (!text) return [];
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    TIME_RE.lastIndex = 0;
    const times = [];
    let m;
    while ((m = TIME_RE.exec(raw))) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const frac = m[3] ? Number('0.' + m[3]) : 0;
      times.push(min * 60 + sec + frac);
    }
    if (!times.length) continue;
    const content = raw.replace(TIME_RE, '').trim();
    if (!content) continue;
    for (const t of times) out.push({ t, text: content });
  }
  out.sort((a, b) => a.t - b.t);
  return out.filter(
    (line, i) => i === 0 || line.text !== out[i - 1].text || line.t !== out[i - 1].t
  );
}

/** 原词 + 翻译按时间对齐 → [{ t, text, tr }] */
export function mergeLrc(orig, trans) {
  const lines = parseLrc(orig);
  const trs = parseLrc(trans);
  if (!lines.length) {
    return trs.map((l) => ({ t: l.t, text: l.text, tr: '' }));
  }
  const map = new Map();
  for (const l of trs) map.set(Math.round(l.t * 10) / 10, l.text);
  return lines.map((l) => ({
    t: l.t,
    text: l.text,
    tr: map.get(Math.round(l.t * 10) / 10) || '',
  }));
}
