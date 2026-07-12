# 微信端运行与验证指南

> 本文档面向接手验证的工程师/AI 代理（Codex）：目标是把装机宝典在微信端跑起来并逐项验收。
> 后端零依赖（Node.js ≥ 16 即可），所有验证不需要任何付费凭据。

## 一、三条微信端路径

| 路径 | 适用 | 改造量 | 前置条件 |
|------|------|--------|----------|
| A. 微信内 H5 | 最快验证/分享 | 零改造 | 公网 HTTPS 域名 |
| B. 小程序 web-view 壳 | 已有 H5 想套壳 | 一个页面 | **仅企业主体**小程序支持 web-view；域名需 HTTPS + ICP 备案 + 业务域名校验 |
| C. 原生小程序（`miniprogram/`，已提供） | 个人主体可上线 | 已完成 | 本地验证零门槛；上线需备案域名 |

## 二、后端冒烟测试（先做这个）

```bash
cd zhuangjibaodian
node server.js          # http://localhost:3000
```

逐项 curl，核对响应形状：

```bash
# 1. 推荐：应返回 { usageLabel, total, parts[], tips[], keyIds }
curl "http://localhost:3000/api/recommend?budget=8000&usage=gaming"

# 2. 比价：应返回 { prices[{ price, live, links, history{ verdict } }], sources, fetchedAt }
#    未配置电商联盟凭据时 live 全为 false、platform 为 "ref"，属预期
curl "http://localhost:3000/api/prices?ids=cpu-r5-7500f,ram-d5-32"

# 3. 能力探测：未配 key 时 { deepseek: false, platforms: {...全false} }
curl "http://localhost:3000/api/config"

# 4. AI 端点降级：未配 key 应返回 501 + 中文错误说明
curl -X POST http://localhost:3000/api/parse -H "Content-Type: application/json" -d '{"text":"8000元游戏主机"}'

# 5. 错误处理：应分别返回 400 / 422
curl "http://localhost:3000/api/recommend?budget=abc"
curl "http://localhost:3000/api/recommend?budget=2000&usage=gaming"
```

可选：配置 `DEEPSEEK_API_KEY=sk-xxx` 重启后，第 3 步 `deepseek` 应为 `true`，
第 4 步应返回 `{ budget, usage, note }` 结构化解析结果。

## 三、路径 C：原生小程序验证（重点）

### 本地跑通（微信开发者工具）

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 本机启动后端：`node server.js`。
3. 开发者工具 →「导入项目」→ 目录选仓库下的 **`miniprogram/`** → AppID 选「测试号」（游客模式即可，无需注册）。
4. `project.config.json` 已设 `urlCheck: false`（等价于「详情 → 本地设置 → 不校验合法域名」），
   `app.js` 里 `apiBase` 默认 `http://127.0.0.1:3000`，模拟器可直连本机服务，**无需任何修改**。

### 模拟器验收清单

- [ ] 首页渲染：预算输入 + 快捷档位（3000~20000）+ 三个用途卡片
- [ ] 输入 `8000` → 选「游戏」→ 生成 → 跳转方案页，合计不超预算
- [ ] 方案页每个零件有价格徽章（无凭据时为灰色「参考价」+ 顶部橙色警示条）
- [ ] 零件卡片有价位判定徽章（内存/固态应显示红色「历史高位」）与「年内最低/均价」
- [ ] 「📚 装机经验参考」卡片有 3~5 条带来源标签的经验
- [ ] 点击「京东/淘宝/拼多多」→ toast「链接已复制」（小程序不能直接开外链，复制是预期行为）
- [ ] 「🔄 换一套方案」→ 核心件（CPU/显卡）与上一套不同
- [ ] 预算 `2000` + 游戏 → 首页显示「预算过低」错误，不跳转
- [ ] （配了 DEEPSEEK_API_KEY 后）首页出现紫色 AI 卡片 → 输入
      「我有一张2080Ti，8000块配一套跑UE5的平台」→ 自动填预算/用途并出方案 →
      方案页出现「AI 装机顾问点评」卡片
- [ ] （未配 key）首页无 AI 卡片、方案页无点评卡，其余功能全部正常

### 真机预览

手机与电脑同一局域网，把 `miniprogram/app.js` 的 `apiBase` 改成电脑局域网 IP
（如 `http://192.168.1.5:3000`），开发者工具点「预览」扫码。
真机上 http + IP 仅在开启「调试模式」时可用（预览界面右上角 → 打开调试）。

### 上线（交给用户操作，验证时无需做）

1. [mp.weixin.qq.com](https://mp.weixin.qq.com/) 注册小程序（个人主体即可），替换 `project.config.json` 的 `appid`。
2. 后端部署到公网，套 HTTPS（nginx/caddy 反代 3000 端口），域名需 ICP 备案。
3. 小程序后台「开发管理 → 开发设置 → request 合法域名」添加该域名；`app.js` 的 `apiBase` 改为线上地址。
4. **密钥安全**：`DEEPSEEK_API_KEY`、电商联盟凭据全部只配在服务器环境变量，小程序端零密钥，代码里不允许出现任何 key。

## 四、路径 A：微信内 H5

后端部署到公网 HTTPS 后，微信聊天窗口发送链接直接打开即可，页面已按微信内置浏览器
（移动端 WebView）适配。本地等价验证：普通浏览器开 `http://localhost:3000`，
设备模拟切 375px 宽，跑一遍与小程序相同的验收清单（H5 版还多一个价格走势迷你曲线图）。

## 五、路径 B：web-view 壳（仅企业主体需要时）

新建小程序页面放一行 `<web-view src="https://你的域名/"></web-view>`；
小程序后台「业务域名」验证文件下载后放进仓库 `public/` 目录即可（静态服务会原样托管到站点根路径）。

## 六、已知边界（验证时不要误报为 bug）

- 未配电商联盟凭据时所有价格为参考价（灰徽章 + 警示条）——设计如此，见 README「接入实时价格」
- 拼多多开放平台的 POST 请求在部分数据中心网络会被出口策略拦截，家用/生产网络正常
- `scripts/fetch-knowledge.js` 抓图拉丁吧在数据中心 IP 下 403 属正常（B 站源一般可用）
- 价格历史前几个数据点带 `seed` 标记，是从公开行情报道推算的品类基线，运行后被真实取价逐步覆盖
- 小程序端无 H5 的 SVG 走势曲线（WXML 限制），只有判定徽章 + 最低/均价文字，属预期裁剪
