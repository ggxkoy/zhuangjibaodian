'use strict';
// DeepSeek 智能装机顾问（OpenAI 兼容接口，零依赖实现）
//
// 职责边界：兼容性校验与价格计算由规则引擎负责（LLM 不碰数字运算），
// DeepSeek 负责两件它擅长的事——
//   1. parseRequirement：把用户的自然语言需求解析成结构化参数（预算/用途/备注）
//   2. reviewBuild：结合装机经验库，对规则引擎生成的方案做“老哥点评”
//
// 配置：DEEPSEEK_API_KEY 必填；DEEPSEEK_MODEL 默认 deepseek-chat；
//       DEEPSEEK_BASE_URL 可指向任意 OpenAI 兼容网关（如自建中转）。

const https = require('https');

const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const TIMEOUT_MS = 30000;

function configured() {
  return !!process.env.DEEPSEEK_API_KEY;
}

function chat(messages, { json = false, temperature = 0.6, maxTokens = 600 } = {}) {
  if (!configured()) return Promise.reject(new Error('未配置 DEEPSEEK_API_KEY'));
  const body = JSON.stringify({
    model: MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(json ? { response_format: { type: 'json_object' } } : {})
  });
  const u = new URL('/chat/completions', BASE_URL);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: TIMEOUT_MS
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error('DeepSeek: ' + parsed.error.message));
          resolve(parsed.choices[0].message.content);
        } catch (e) { reject(new Error('DeepSeek 响应异常: ' + data.slice(0, 120))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('DeepSeek 请求超时')));
    req.on('error', reject);
    req.end(body);
  });
}

// 自然语言需求 -> { budget, usage, note }
async function parseRequirement(text) {
  const content = await chat([
    { role: 'system', content: PARSE_SYSTEM },
    { role: 'user', content: text.slice(0, 500) }
  ], { json: true, temperature: 0.1, maxTokens: 200 });
  const r = JSON.parse(content);
  const budget = Math.round(Number(r.budget));
  const usage = ['gaming', 'productivity', 'office'].includes(r.usage) ? r.usage : 'gaming';
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('未能从描述中解析出预算');
  return { budget, usage, note: String(r.note || '').slice(0, 200) };
}

// 老板娘人设/提示词与云函数共享，见 lib/boss-prompts.js
const { PARSE_SYSTEM, personaFor, elicitSystem, reviewSystem, buildContext } = require('./boss-prompts');

// 对话式需求确立：返回 { ready, budget, usage, note, reply }
async function elicit(history, character) {
  const content = await chat([
    { role: 'system', content: elicitSystem(character) },
    ...history.slice(-10)
  ], { json: true, temperature: 0.4, maxTokens: 300 });
  const r = JSON.parse(content);
  const usageOk = ['gaming', 'productivity', 'office'].includes(r.usage);
  const budget = Math.round(Number(r.budget));
  return {
    ready: !!r.ready && budget > 0 && usageOk,
    budget: budget > 0 ? budget : null,
    usage: usageOk ? r.usage : null,
    note: String(r.note || '').slice(0, 200),
    reply: String(r.reply || '').slice(0, 500)
  };
}

// 方案 + 经验库 -> 老板娘点评
async function reviewBuild(plan, tips, priceNotes, userNote, character) {
  const content = await chat([
    { role: 'system', content: reviewSystem(character) },
    { role: 'user', content:
      (userNote ? `顾客特殊需求：${userNote}\n` : '') +
      buildContext(plan, priceNotes, tips.map(t => t.text)) }
  ], { temperature: 0.7, maxTokens: 500 });
  return content.trim();
}

// 多轮对话：history 由服务端过滤后传入，上下文资料以附加 system 消息注入
async function bossChat(history, plan, priceNotes, knowledge, character) {
  const messages = [
    { role: 'system', content: personaFor(character) },
    { role: 'system', content: '【系统资料，仅你可见，回答时据此引用】\n' + (buildContext(plan, priceNotes, knowledge) || '（顾客还没生成方案）') },
    ...history
  ];
  const content = await chat(messages, { temperature: 0.8, maxTokens: 400 });
  return content.trim();
}

// 口碑管道·第2层：把社区真实评论提炼成结构化口碑卡片
// 铁律：只依据给定评论内容，不足则留空，不许编造
async function digestReviews(partName, comments) {
  const corpus = comments.map(c => `[👍${c.like}] ${c.text}`).join('\n');
  const content = await chat([
    { role: 'system', content:
      '你是硬件口碑分析师。根据社区真实评论（带点赞数，点赞高的权重大）提炼 JSON：' +
      '{"summary":"一句话总评","pros":["优点,最多3条"],"cons":["缺点,最多3条"],' +
      '"pitfalls":["翻车点/避坑点,最多2条,没有则空数组"],"suitFor":"适合什么人,一短句",' +
      '"confidence":"low|medium|high（按样本量和观点一致性）"}。' +
      '只依据评论内容提炼，评论里没提的绝不编造；信息不足的字段留空字符串或空数组。只输出 JSON。' },
    { role: 'user', content: `零件：${partName}\n评论（${comments.length}条）：\n${corpus.slice(0, 6000)}` }
  ], { json: true, temperature: 0.2, maxTokens: 500 });
  return JSON.parse(content);
}

module.exports = { configured, parseRequirement, elicit, reviewBuild, bossChat, digestReviews };
