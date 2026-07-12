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
    { role: 'system', content:
      '你是装机需求解析器。把用户描述解析为 JSON：' +
      '{"budget": 预算金额数字（元，未提到则按描述档次估一个合理值）, ' +
      '"usage": "gaming"|"productivity"|"office"（游戏/生产力(剪辑编程渲染UE等)/办公，选最主要的一个）, ' +
      '"note": "一句话备注用户的特殊约束，如已有配件、升级意图、品牌偏好；没有则为空字符串"}。' +
      '只输出 JSON。' },
    { role: 'user', content: text.slice(0, 500) }
  ], { json: true, temperature: 0.1, maxTokens: 200 });
  const r = JSON.parse(content);
  const budget = Math.round(Number(r.budget));
  const usage = ['gaming', 'productivity', 'office'].includes(r.usage) ? r.usage : 'gaming';
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('未能从描述中解析出预算');
  return { budget, usage, note: String(r.note || '').slice(0, 200) };
}

// 方案 + 经验库 -> 顾问点评
async function reviewBuild(plan, tips, priceNotes, userNote) {
  const partsDesc = plan.parts.map(p =>
    `${p.categoryLabel}: ${p.name}（¥${p.refPrice}${priceNotes[p.id] ? '，' + priceNotes[p.id] : ''}）`
  ).join('\n');
  const content = await chat([
    { role: 'system', content:
      '你是资深装机顾问，熟悉图拉丁吧等装机社区的实战经验。' +
      '对给出的配置单做点评：兼容性和预算已由系统校验，你只评“合理性、风险、值不值得现在买、可微调的点”。' +
      '结合提供的社区经验条目，口吻专业但接地气，直说结论。150~250字，分点，不要复述配置单。' },
    { role: 'user', content:
      `用途：${plan.usageLabel}；预算：¥${plan.budget}；方案合计：¥${plan.total}\n` +
      (userNote ? `用户特殊需求：${userNote}\n` : '') +
      `配置单：\n${partsDesc}\n\n` +
      `社区经验参考：\n${tips.map(t => `- ${t.text}`).join('\n')}` }
  ], { temperature: 0.7, maxTokens: 500 });
  return content.trim();
}

module.exports = { configured, parseRequirement, reviewBuild };
