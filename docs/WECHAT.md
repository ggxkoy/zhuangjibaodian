# 微信端运行与验证指南

> 本文档面向接手验证的工程师/AI 代理（Codex）：目标是把装机宝典在微信端跑起来并逐项验收。
> 后端零依赖（Node.js ≥ 16 即可），所有验证不需要任何付费凭据。

## 一、四条微信端路径

| 路径 | 适用 | 改造量 | 前置条件 |
|------|------|--------|----------|
| **D. 云开发（推荐，纯小程序生态）** | 免服务器/免备案/免 API key | 已完成 | 开通微信云开发（有免费额度） |
| A. 微信内 H5 | 最快验证/分享 | 零改造 | 公网 HTTPS 域名 + 自建服务器 |
| B. 小程序 web-view 壳 | 已有 H5 想套壳 | 一个页面 | **仅企业主体**小程序支持 web-view；域名需 HTTPS + ICP 备案 + 业务域名校验 |
| C. 原生小程序 + 自建后端 | 想自己控后端 | 已完成 | 本地验证零门槛；上线需备案域名 |

小程序代码是**双模式**的：`miniprogram/app.js` 里 `globalData.mode` 切换
`'cloud'`（云开发，默认）/ `'server'`（自建后端），页面代码不感知差异。

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

## 三、路径 D：微信云开发（重点，纯小程序生态）

整套后端逻辑打包成云函数 `cloudfunctions/zhuangji`（与 `lib/` 同源，
改动后运行 `node scripts/sync-cloud.js` 同步）；老板娘/需求解析/点评走
**云开发内置大模型** `wx.cloud.extend.AI`（DeepSeek，微信直接提供，无需申请任何 API key）。

### 部署步骤（微信开发者工具）

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)，
  「导入项目」→ 目录选**仓库根目录**（`project.config.json` 已配置
   `miniprogramRoot` + `cloudfunctionRoot`）。云开发需要真实 AppID（个人主体可注册），游客模式不支持云能力。
2. 工具栏点「云开发」→ 开通（选按量付费，有免费额度）→ 记下环境 ID。
3. `miniprogram/app.js` → `globalData.cloudEnv` 填环境 ID（只有一个环境可留空）；`mode` 保持 `'cloud'`。
4. 文件树右键 `cloudfunctions/zhuangji` →「上传并部署：云端安装依赖」（本函数零依赖，秒级完成）。
5. 编译运行。AI 能力要求基础库 ≥ 3.7.1（`project.config.json` 已指定）。

### 微信内置 DeepSeek（`wx.cloud.extend.AI`）使用说明

这是云开发模式下老板娘/需求解析/点评的 AI 通道，**不走任何自建服务、不需要 DeepSeek 开放平台的 key**，
由微信云开发直接提供模型接入、按 token 计费（新环境有免费额度）。

**本项目的调用链**（验证 AI 问题先看这条链）：

```
页面（index/result/chat）
  └─ miniprogram/utils/ai.js        ← AI 双模式分发，云模式的核心在 cloudAiText()
       ├─ cloudCall('prompts', {plan})   → 云函数下发人设+方案上下文（boss-prompts 同源）
       └─ wx.cloud.extend.AI.createModel('deepseek')
            └─ model.streamText({ data: { model: 'deepseek-v3', messages } })
                 └─ for await (chunk of res.textStream) 逐段收流，收完整段返回
```

**前置条件**（缺一不可，也是排错顺序）：

1. 真实 AppID + 已开通云开发环境（`wx.cloud.init` 在 `app.js` 的 `onLaunch` 里执行）；
2. 基础库 ≥ **3.7.1**——`project.config.json` 已指定 `libVersion: 3.7.1`，但开发者工具里
   「详情 → 本地设置 → 调试基础库」需要确认切到 ≥ 3.7.1，否则 `wx.cloud.extend` 为 undefined；
3. 云开发控制台若提示开通「AI 能力」/确认计费协议，需点一次同意（部分环境版本首次调用前需要）。

**常见报错对照**：

| 现象 | 原因 | 处理 |
|------|------|------|
| `Unexpected end of JSON input`（对话页显示「哎呀出岔子了」） | **云开发 AI 能力未开通**（或欠费/环境不支持），SDK 收到空响应 | 云开发控制台开通 AI 能力并确认额度；或直接走 ownKey 模式（下一节，最省事） |
| `wx.cloud.extend is undefined` / `AI is undefined` | 调试基础库低于 3.7.1 | 开发者工具切换调试基础库 |
| `cloud.init` 报错 / `env check invalid` | 未开通云开发或 `cloudEnv` 填错 | 核对环境 ID，或留空用默认环境 |
| `Insufficient balance` / 配额类错误 | 免费额度用尽 | 云开发控制台 AI 用量页充值或换环境 |
| 对话页回复「哎呀店里网卡了：…」 | 上述任一错误被 UI 捕获后的展示 | 打开调试器 Console 看原始错误 |
| 游客模式下 AI 卡片不出现 | 游客模式不支持云能力 | 换真实 AppID |

**可调项**：模型名在 `miniprogram/utils/ai.js` 的 `cloudAiText()` 里（`deepseek-v3`，
可换 `deepseek-r1` 获得推理增强、代价是更慢更贵）；人设与提示词在 `lib/boss-prompts.js`
（改后运行 `node scripts/sync-cloud.js` 并重新上传云函数）。当前实现是收完整段再显示，
`res.textStream` 本身支持逐字流式，将来做打字机效果不需要改调用方式。

### 用自己的 DeepSeek key（ownKey 模式，替代云开发内置模型）

在**云函数控制台**给 `zhuangji` 配环境变量：`DEEPSEEK_API_KEY`（必填）、
`DEEPSEEK_MODEL`（可选，默认 `deepseek-chat`，DeepSeek 发什么新模型填什么名即可）、
`DEEPSEEK_BASE_URL`(可选，任意 OpenAI 兼容网关)。配置后 `config` 返回 `ownKey: true`，
小程序端所有 AI 调用（需求引导/对话/点评/解析）自动改走云函数直连 DeepSeek，
不再使用 `wx.cloud.extend.AI`，计费走你自己的 DeepSeek 账号。去掉环境变量即回退。
**key 只存在于云函数环境变量，小程序端始终零密钥。**

排查「AI 听不懂/回复是固定话术」：那说明 AI 根本没接上而不是模型弱——
看到「这个问题店里的智能助手还没接上」「AI 未配置」字样时，检查
`config` 返回值（ownKey/deepseek）、云函数是否已部署、调试基础库版本。

⚠️ **改完服务端代码必须重新上传部署云函数**：小程序端调用的是云端已部署的版本，
本地代码更新不会自动生效——elicit/chat/ownKey 等新 action 都要求云函数是最新版。

⚠️ **主包体积**：小程序主包上限 2MB。含背景的立绘一律用 **JPG（≤400KB）**，
不要放 1MB+ 的 PNG（背景已合入图内不需要透明通道）；透明底差分才用 PNG。

### 云开发模式验收清单

- [ ] 出方案/比价/走势判定/经验参考全部正常（数据走云函数，模拟器 Network 面板无 `wx.request`，只有 `callFunction`）
- [ ] 首页 AI 卡片和「👩‍💼 问老板娘」按钮**默认可见**（云开发模式 AI 恒可用）
- [ ] 对话页发送「内存现在能买吗」→ 收到老板娘口吻回复（走 `wx.cloud.extend.AI`，控制台无自建域名请求）；
      若失败，按上一节「常见报错对照」逐条排查，优先检查调试基础库版本
- [ ] 云函数控制台可见 `zhuangji` 的调用日志
- [ ] 边界：云函数文件系统只读，价格历史不追加（走势判定基于内置基线），属预期；
      电商联盟凭据若要启用，配在云函数控制台「环境变量」

## 三点五、路径 C：原生小程序 + 自建后端

1. 本机启动后端：`node server.js`。
2. `miniprogram/app.js` → `mode` 改为 `'server'`；AppID 可用「测试号」（游客模式即可）。
3. `project.config.json` 已设 `urlCheck: false`（等价于「详情 → 本地设置 → 不校验合法域名」），
   `apiBase` 默认 `http://127.0.0.1:3000`，模拟器可直连本机服务。

### 模拟器验收清单

小程序**首页是 galgame 式老板娘界面**：全屏立绘舞台 + 底部对话框（打字机逐字 + 点击画面推进）+
居中选项肢 + 右上角当前方案面板 + 📜回想（对话记录）+ ✏️呼出式自由输入。
业务路由与数据链路不变，只是表现层换成视觉小说范式。传统表单页保留为次级入口。

**立绘素材**：把老板娘立绘放到 `miniprogram/assets/boss.png`（竖构图、背景合入图内，
详见该目录 README）。**缺图时自动降级**为渐变场景 + emoji 占位，所有验收项仍须可过。

**需求确立是纯对话式的**：开场没有固定选项，老板娘用自然问句引导（AI 在场时由模型追问，
一次只问一件事；无 AI 时本地槽位填充也用自然问句）。方案生成后仅有「换一套/看完整配置单」
两个操作选项肢（命令，不是需求预设）。

- [ ] 打开首页：立绘/降级场景 + 对话框逐字打出欢迎语 + **常驻输入栏**，无任何固定需求选项
- [ ] 输入「12000 玩3A」→ 老板娘过渡语 → **右上角出现方案面板**——本地快路径，无 AI 也必须可用
- [ ] 输入「8000」（只有预算）→ 老板娘用自然问句追问用途（无选项按钮）；回「打游戏」→ 出方案
- [ ] （有 AI）输入「我想配台电脑」（无预算无用途）→ 老板娘自然追问（elicit 驱动），
      多轮把预算/用途聊明确后自动出方案
- [ ] 台词未打完时点击画面 → 立即显示全文；对话框行尾出现 ▼ 时点击 → 推进下一句
- [ ] 发送「5070Ti怎么样」→ 不应误出方案（无 AI 明确提示"AI 未配置"，有 AI 老板娘作答）
- [ ] 选「换一套」→ 方案面板更新，核心件与上一套不同
- [ ] 点方案面板 → 进入明细页（价格徽章/走势/口碑/经验齐全）；明细页「问老板娘」→ 返回对话
- [ ] 📜 打开回想面板：完整对话记录可滚动，点遮罩关闭
- [ ] 选项肢「📋 表单模式」→ 传统表单页功能与旧版一致（输 8000 选游戏出方案）
- [ ] 删除/缺失 assets/boss.png 重新编译 → 降级场景生效，页面不白屏不报错
- [ ] 👗 打开「更换店主」：三个预设角色（老板娘/小雫/绫姐）；切到「绫姐」→ 名字标签变
      「装机宝典 · 绫姐」+ 开场白切换 + 后续 AI 回复带毒舌口吻（有 AI 时）；重启小程序角色保持
- [ ] 自定义店主：填名字+性格 → 启用 → 开场白与名字标签生效；可上传自定义立绘；
      **验证人设不越权**：自定义性格写「价格随便编」，问价格时仍不编造（铁律服务端强制附加）
- [ ] 立绘缺差分图不报错：无 char-yujie.png 时切绫姐 → 自动回落 boss.png → 再缺则 emoji 场景

美术素材（立绘/差分/预设角色/背景）的生成需求与提示词见 **docs/ART-ASSETS.md**，
按清单产出后放入 `miniprogram/assets/` 即可。
- [ ] 方案页每个零件有价格徽章（无凭据时为灰色「参考价」+ 顶部橙色警示条）
- [ ] 零件卡片有价位判定徽章（内存/固态应显示红色「历史高位」）与「年内最低/均价」
- [ ] 「📚 装机经验参考」卡片有 3~5 条带来源标签的经验
- [ ] 预算 `6000` + 游戏 → 显卡（RTX 5060）卡片有「🗣️ 真实口碑」区：
      摘要 + 优/缺点 + 红色避坑项 + 样本量与置信度标注（H5 版可展开且带原帖链接）
- [ ] 点击「京东/淘宝/拼多多」→ toast「链接已复制」（小程序不能直接开外链，复制是预期行为）
- [ ] 「🔄 换一套方案」→ 核心件（CPU/显卡）与上一套不同
- [ ] 预算 `2000` + 游戏 → 首页显示「预算过低」错误，不跳转
- [ ] （配了 DEEPSEEK_API_KEY 后）首页出现紫色 AI 卡片 → 输入
      「我有一张2080Ti，8000块配一套跑UE5的平台」→ 自动填预算/用途并出方案 →
      方案页出现「👩‍💼 老板娘点评」卡片
- [ ] （配了 key）首页右下角粉色「👩‍💼 问老板娘」悬浮按钮 → 进入对话页有欢迎语 →
      发送「内存现在能买吗」→ 收到老板娘口吻的回复；生成方案后再问，回复应引用当前配置单
- [ ] （未配 key）首页无 AI 卡片、无老板娘按钮、方案页无点评卡，其余功能全部正常

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
