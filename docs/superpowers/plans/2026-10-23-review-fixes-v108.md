# v1.0.8 Review Fixes Implementation Plan

**Goal:** 修复 v1.0.7 审查确认的下载链接重试、媒体错误换源、续播及搜索历史竞态四项问题。

**Architecture:** 沿用主进程 URL 缓存与 AudioCache、renderer 播放 token 和搜索序号。只增加定向刷新与有次数限制的媒体恢复，不改变歌词外观、音源目录及共享限流。

**Tech Stack:** Electron 45、Vue 3、Node.js test runner、现有 esbuild renderer 测试工具。

用户已通过“都修复一下”授权执行前述审查报告中的修复建议，在当前会话逐项实施。

## 1. 下载与地址缓存

- [x] 在 `tests/api-retry.test.cjs` 加入刷新内存及磁盘 URL 缓存、保留其他歌曲/音质、并发刷新合并及限流测试。
- [x] 在 `tests/audio-cache.test.cjs` 加入 403/410 刷新一次成功、持续失败有界、点击重试再次解析、完整本地缓存不重下的测试；运行两个文件确认新增用例失败。
- [x] 修改 `src/main/api.js` 的 `request` 支持 `options.refresh`，跳过并清除目标缓存，仍合并在途请求并通过共享限流；`trackUrl` 对解析 ID 回退使用相同刷新选项。
- [x] 修改 `src/main/audio-cache.js`：失效响应只刷新一次；手动重试标记失败任务的下次解析为刷新。`resolve` 支持播放恢复传入的 refresh 标记，完整本地音频保持优先。
- [x] 运行 `node --test tests/api-retry.test.cjs tests/audio-cache.test.cjs`。

## 2. 媒体错误恢复与续播

- [x] 新增 `tests/playback-recovery.test.cjs`，覆盖媒体失败刷新、同曲换源、恢复失败有界、暂停不自动播放、过期恢复不能覆盖新歌，以及 73 秒续播和新歌从零开始；先运行确认失败。
- [x] 修改 `src/renderer/src/player.js`：为每次加载维护恢复上下文，记录已尝试来源及是否刷新；媒体错误进入同一恢复流程，全部失败后才跳过，暂停时不安排自动跳歌。
- [x] 加载新地址、等待元数据及异步换源过程中检查播放 token；明确媒体停止与暂停的意图，保留当前进度。
- [x] `togglePlay()` 在没有地址的首次恢复播放时传入保存的 `player.position`；选择新歌曲的 `loadAndPlay()` 默认仍为零。
- [x] 运行 `node --test tests/playback-recovery.test.cjs tests/review-regressions.test.cjs`。

## 3. 搜索历史竞态

- [x] 新增 `tests/search-history.test.cjs`，覆盖 B 在途返回 A、分页在途导航、旧错误不污染历史、前进返回可重新搜索；先运行确认失败。
- [x] 修改 `src/renderer/src/store.js`：在页面历史切换时使搜索序号失效、重置 loading，禁止旧成功/失败响应修改当前结果及历史。
- [x] 运行 `node --test tests/search-history.test.cjs tests/review-regressions.test.cjs`。

## 4. 综合验证与交付

- [x] 扩展 `tests/electron-smoke.cjs`，用真实 HTMLAudioElement 和本地服务验证续播及媒体错误恢复。
- [x] 运行 `npm test`、`npm run test:electron`、`git diff --check`，检查所有结果。
- [x] 更新 README、帮助文档及审查记录，注明四项问题的修复状态与实际音源可用性的边界。
- [x] 更新版本为 1.0.8，生成安装包并核对版本，保留 v1.0.7 已发布文件。
