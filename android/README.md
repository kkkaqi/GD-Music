# GD Music Android

底部「首页」展示推荐音乐和搜索，「我的」展示收藏和下载状态。点选推荐或搜索结果即开始播放，当前列表充当播放队列。首页右上角可选择搜索音源，支持网易云、QQ 音乐、酷我、TIDAL、Qobuz、JOOX、哔哩哔哩、Apple Music、YouTube Music 和 Embeat。需要 Android 8.0 或更新版本。

底部播放条可暂停、收藏和打开队列。点封面或歌名展开播放页，查看歌词、调整进度和切歌。音质标签可切换标准、较高、高品、16bit 无损和 24bit 无损，实际音质取决于音源返回。系统媒体通知可在后台控制播放。

点爱心或长按搜索结果可加入「我的喜欢」。收藏后自动按所选音质下载到应用目录，「已下载」的歌曲可在「我的喜欢」中离线播放。下载失败后可长按曲目重试。Embeat 仅支持在线播放。

曲目和播放地址取决于 GD 音乐台各音源的实际返回。仅供学习交流，版权归各平台和原作者所有。[GD 音乐台](https://music.gdstudio.org/)

## 本地构建

使用 JDK 17、Android SDK 35 和 Build Tools 35.0.0。设置 `ANDROID_HOME`，或在 `local.properties` 中配置 `sdk.dir`。Windows 下，如果项目路径包含非 ASCII 字符，把 `android` 目录复制到英文路径后构建。

```powershell
.\gradlew.bat testDebugUnitTest assembleDebug
```

可安装的调试包位于 `app/build/outputs/apk/debug/app-debug.apk`。正式包用 `assembleRelease` 构建，再用自己的 Android 签名密钥签名。
