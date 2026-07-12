# 错题本移动浏览器版

## 本地运行

```powershell
npm.cmd run dev
```

电脑和手机连接同一 Wi-Fi 后，使用手机浏览器打开终端显示的 Network 地址。

## 安装到主屏幕

- Android Chrome：菜单 -> 添加到主屏幕
- iPhone / iPad Safari：分享 -> 添加到主屏幕

## 数据位置

错题、复习记录、APKG 词库、音频和学习进度保存在当前浏览器的 IndexedDB 中，不会上传服务器。清理浏览器站点数据会删除本地数据，正式使用前应定期导出备份。

## 生产构建

```powershell
npm.cmd run build
npm.cmd run preview
```

生产文件位于 `dist`，部署时需要 HTTPS 才能完整使用 PWA 离线安装能力。
