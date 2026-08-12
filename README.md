# 云海果乐园

一个面向触屏和桌面浏览器的原创水果三消 PWA。云端海洋主页保持既定视觉基准，棋盘使用蓝莓、草莓、蜜桃、葡萄、柠檬、苹果和原创彩虹花。

## 已实现

- 8×8 相邻交换、三连消除、掉落补充与连锁消除
- 四连直线特效、五连彩虹花、泡沫障碍、三星评价
- 20 关可配置挑战、本地进度/最高分/道具存档
- 锤子、彩虹花与交换道具，暂停、重试、关卡地图及基础音效
- PWA Manifest 与离线缓存；可添加到手机主屏幕

## 本地运行

在项目根目录运行：

```powershell
$env:TEMP='D:\codexAI\.runtime\temp'
$env:TMP=$env:TEMP
$env:npm_config_cache='D:\codexAI\.runtime\npm-cache'
& 'D:\codexAI\.toolchains\emsdk\node\24.19.0_64bit\npm.cmd' run dev
```

## 构建与部署

```powershell
& 'D:\codexAI\.toolchains\emsdk\node\24.19.0_64bit\npm.cmd' run build
& 'D:\codexAI\.toolchains\emsdk\node\24.19.0_64bit\npm.cmd' run test:sites
```

将 `dist/client/` 部署至任意 HTTPS 静态托管即可。HTTPS 是安装和离线缓存所必需的；应用使用相对资源路径，可放在域名根目录或子目录。
