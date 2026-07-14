# 立绘素材（主包只放兜底图）

微信主包 1.5MB 起提示、2MB 硬上限，所以**本目录只保留默认 `boss.jpg`**（164KB 兜底图）。

其余全部差分与角色立绘放在仓库根目录 **`assets-remote/`**（不参与打包），
上线走云开发云存储：上传到存储的 `sprites/` 目录 → 把 File ID 前缀填进
`miniprogram/utils/sprites.js` 的 `REMOTE_BASE`。`<image>` 原生支持 `cloud://` 地址。

`REMOTE_BASE` 未配置时所有角色回落默认立绘，功能不受影响。

新素材规格见 `docs/ART-ASSETS.md`：含背景整图用 JPG（质量80、≤400KB）、
1080×1920 竖构图、底部 30% 留白给对话框。**产出后放 `assets-remote/`，不要放本目录。**
