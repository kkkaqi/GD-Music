/* 渲染进程 API 封装：拆掉 IPC 的 { ok, data } 信封 */
const b = window.bridge;

async function call(fn, params, label) {
  const res = await fn(params);
  if (!res || res.ok !== true) {
    throw new Error((res && res.error) || `${label || '请求'}失败`);
  }
  return res.data;
}

export const Api = {
  audio: {
    status: () => call(b.audio.status, undefined, '读取下载进度'),
    retry: () => call(b.audio.retry, undefined, '重试下载'),
    folder: () => call(b.audio.folder, undefined, '打开音频目录'),
  },
  search: (p) => call(b.api.search, p, '搜索'),
  url: (p) => call(b.api.url, p, '获取播放地址'),
  pic: (p) => call(b.api.pic, p, '获取封面'),
  lyric: (p) => call(b.api.lyric, p, '获取歌词'),
  playlist: (p) => call(b.api.playlist, p, '导入歌单'),
  quota: async () => {
    try {
      return await call(b.api.quota, undefined, '读取配额');
    } catch {
      return null;
    }
  },
  state: {
    load: async () => {
      try {
        return await call(b.state.load, undefined, '读取本地数据');
      } catch {
        return null;
      }
    },
    save: (s) => b.state.save(s),
  },
  app: {
    info: () => call(b.app.info, undefined, '读取应用信息'),
    openExternal: (url) => b.app.openExternal(url),
    showUserData: () => b.app.showUserData(),
  },
  file: {
    exportText: (payload) => b.file.exportText(payload),
    exportJson: (payload) => call(b.file.exportJson, payload, '导出配置'),
    importJson: () => call(b.file.importJson, undefined, '读取配置'),
    downloadTrack: (payload) => call(b.file.downloadTrack, payload, '下载'),
  },
};
