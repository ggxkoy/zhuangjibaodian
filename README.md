# 装机宝典 🖥️

输入**预算**和**用途**（游戏 / 生产力 / 办公），一键生成整套装机方案，并对方案中每个零件向各大电商平台（京东 / 淘宝 / 拼多多）拉取最低价比价。

## 快速开始

零依赖，只需 Node.js（≥ 16）：

```bash
node server.js
# 打开 http://localhost:3000
```

界面为移动端优先的小程序风格 H5；仓库同时提供**原生微信小程序**（`miniprogram/` 目录，
微信开发者工具导入即可本地运行）。微信端三条路径与完整验收清单见 [docs/WECHAT.md](docs/WECHAT.md)。

## 功能

- **需求输入**：预算金额（含常用档位快捷选择）+ 用途三选一（🎮 游戏 / 🛠️ 生产力 / 📄 办公）
- **智能配单**：枚举 CPU×显卡组合，自动补全兼容配件（主板插槽、内存代际、电源功率、散热解热量、机箱板型全部做兼容校验），按用途加权评分选出预算内最优方案；剩余预算自动升级内存 / 固态 / 散热
- **多平台比价**：每个零件并发请求各平台适配器取最低价，10 分钟缓存；拉取失败自动回退本地参考价并明确标注来源（"京东实时最低" / "参考价"）
- **价格走势与好价判定**（参考"什么值得买"）：每次取价按天记录价格历史，零件卡片展示近一年走势迷你曲线，并判定当前价位——接近历史低点 / 低于均价 / 价格平稳 / **历史高位**（如当前的内存、固态），方案顶部汇总"N 件好价、M 件高位急用再买"
- **比价直达**：每个零件附京东 / 淘宝 / 拼多多搜索直达链接
- **换一套方案**：排除已推荐的核心件重新生成备选方案
- **AI 装机顾问（DeepSeek）**：自然语言描述需求（"我有张 2080Ti，8000 配一套跑 UE5 的平台"）自动解析成预算/用途/特殊约束；方案生成后结合经验库给出"老哥点评"——合理性、风险、该不该现在买
- **装机经验库**：内置图拉丁吧等社区沉淀的实战共识，按方案零件/平台/用途匹配展示最相关的几条，同时作为 AI 点评的知识上下文

## 项目结构

```
server.js                 # 零依赖 HTTP 服务：静态页面 + API
lib/recommender.js        # 配单引擎（兼容性校验 + 加权评分 + CPU/显卡均衡约束）
lib/price-service.js      # 多平台比价服务（官方开放平台适配器 + 缓存 + 回退）
lib/price-history.js      # 价格历史记录与好价判定
lib/llm-advisor.js        # DeepSeek 顾问（需求解析 + 方案点评）
lib/knowledge.js          # 装机经验库匹配
data/parts.json           # 零件库（规格、性能分、参考价、搜索关键词）
data/price-history.json   # 价格历史（天级数据点，运行时持续追加）
data/knowledge.json       # 装机经验条目（社区共识，人工维护）
scripts/seed-history.js   # 从公开行情报道推算的品类级历史基线生成器
scripts/fetch-knowledge.js# 多源经验线索抓取（B站专栏/图拉丁吧，候选供人工筛选）
public/                   # H5 前端（原生 HTML/CSS/JS，小程序风格）
miniprogram/              # 原生微信小程序（开发者工具导入即用）
docs/WECHAT.md            # 微信端运行与验证指南（三条路径 + 验收清单）
```

## API

| 接口 | 参数 | 说明 |
|------|------|------|
| `GET /api/recommend` | `budget`（元）、`usage`（gaming/productivity/office）、`exclude`（可选，排除零件 ID） | 生成装机方案（含经验提示） |
| `GET /api/prices` | `ids`（逗号分隔零件 ID） | 拉取各平台最低价 + 走势判定 |
| `GET /api/config` | — | 服务端能力探测（AI/比价源是否已配置） |
| `POST /api/parse` | `{ text }` | 自然语言需求解析（需 DeepSeek） |
| `POST /api/review` | `{ plan, note }` | AI 装机顾问点评（需 DeepSeek） |

## 接入 DeepSeek（AI 顾问）

```bash
DEEPSEEK_API_KEY=sk-xxx node server.js
```

可选：`DEEPSEEK_MODEL`（默认 `deepseek-chat`）、`DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`，
可指向任意 OpenAI 兼容网关）。key 在 [platform.deepseek.com](https://platform.deepseek.com/) 申请。

职责边界：**兼容性校验、预算分配、价格计算全部由规则引擎完成**（LLM 不碰数字运算，杜绝算错钱），
DeepSeek 只做两件它擅长的事——听懂自然语言需求、结合经验库对方案讲人话点评。
未配置 key 时 AI 入口自动隐藏，其余功能不受影响。

## 装机经验库（图拉丁吧等社区沉淀）

`data/knowledge.json` 收录社区实战共识（平台选择、避坑、验机流程等），每条带匹配条件
（零件/插槽/用途/功耗阈值），方案页自动展示最相关的 5 条，并全量提供给 AI 点评做上下文。

`scripts/fetch-knowledge.js` 是多源经验线索抓取器（输出到 `data/knowledge-inbox.json`
供人工提炼——论坛内容质量参差，**不做自动入库**）：

```bash
node scripts/fetch-knowledge.js                    # 默认抓 B站专栏，关键词“装机”
node scripts/fetch-knowledge.js bilibili 装机避坑   # B站图文教程（公开API，成功率高）
node scripts/fetch-knowledge.js tieba 内存          # 图拉丁吧（反爬严格，数据中心IP多403）
node scripts/fetch-knowledge.js all 装机教程        # 全部来源
```

新增来源（知乎/Chiphell/NGA 等）只需在脚本 `SOURCES` 里加一个返回
`[{title, url, from}]` 的函数。

## 接入实时价格（重要）

三大平台适配器已完整实现（含签名算法），**配置环境变量即启用实时最低价**，无需改代码：

| 平台 | 环境变量 | 凭据申请（免费） |
|------|----------|------------------|
| 京东联盟 | `JD_APP_KEY` `JD_APP_SECRET` | [union.jd.com](https://union.jd.com/) → 工具 → API |
| 淘宝联盟 | `TAOBAO_APP_KEY` `TAOBAO_APP_SECRET` `TAOBAO_ADZONE_ID` | [open.taobao.com](https://open.taobao.com/) + 淘宝联盟推广位 |
| 多多进宝 | `PDD_CLIENT_ID` `PDD_CLIENT_SECRET`（可选 `PDD_PID`） | [jinbao.pinduoduo.com](https://jinbao.pinduoduo.com/) → 开放平台 |

```bash
JD_APP_KEY=xxx JD_APP_SECRET=xxx node server.js
```

取价逻辑：按零件关键词在各平台搜索（京东零件可在 `parts.json` 填 `jdSku` 精确到商品），
对结果做**标题分词匹配 + 价格合理性区间过滤**（防止配件、错配商品混入），再取各平台最低价，缓存 10 分钟。
任一平台失败自动降级为参考价并在界面明确标注，不影响出方案。

> ⚠️ 未接入实时源时显示的是人工维护的参考价。2025 下半年起内存/固态经历大幅涨价（"一天三个价"），
> 参考价与实际行情可能存在明显误差，界面会显著提示，下单前务必点击平台按钮核实实价。
