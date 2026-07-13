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

// “老板娘”人设：电脑城柜台的姐，热情懂行不忽悠。
// 铁律：价格只引用系统提供的数据，没有数据就让顾客点比价按钮，绝不编数。
const BOSS_PERSONA =
  '你是“装机宝典”电脑城档口的老板娘，顾客都叫你姐。' +
  '性格：热情爽快、特别懂行、实在不忽悠，偶尔用电脑城行话和生活化比喻，但讲参数和数据时严谨。' +
  '铁律：' +
  '1) 只聊装机、电脑硬件、外设、行情相关话题，顾客跑题就笑着拉回来；' +
  '2) 具体价格只能引用系统资料里给出的数字，资料里没有的价格就说“这个姐得现查，你点下比价按钮”，绝不编造；' +
  '3) 推荐必须给理由，拿不准就直说拿不准，不硬答；' +
  '4) 平时回答口语化、120字以内，顾客明确要清单/对比时才分点展开。';

function buildContext(plan, priceNotes, knowledge) {
  const lines = [];
  if (plan && Array.isArray(plan.parts)) {
    lines.push(`【顾客当前方案】用途：${plan.usageLabel || plan.usage}；预算：¥${plan.budget}；合计：¥${plan.total}`);
    for (const p of plan.parts) {
      lines.push(`- ${p.categoryLabel} ${p.name} ¥${p.refPrice}${priceNotes && priceNotes[p.id] ? '（' + priceNotes[p.id] + '）' : ''}`);
    }
  }
  if (knowledge && knowledge.length) {
    lines.push('【店里的经验手册】');
    for (const k of knowledge) lines.push('- ' + k);
  }
  return lines.join('\n');
}

// 方案 + 经验库 -> 老板娘点评
async function reviewBuild(plan, tips, priceNotes, userNote) {
  const content = await chat([
    { role: 'system', content: BOSS_PERSONA +
      '现在顾客刚生成了一套配置单（兼容性和预算系统已校验过），你给一段点评：' +
      '这套配得合不合理、有什么风险要提醒、按当前价位哪些件该现在买哪些该等等、可微调的点。' +
      '150~250字，分点，不要复述配置单本身。' },
    { role: 'user', content:
      (userNote ? `顾客特殊需求：${userNote}\n` : '') +
      buildContext(plan, priceNotes, tips.map(t => t.text)) }
  ], { temperature: 0.7, maxTokens: 500 });
  return content.trim();
}

// 多轮对话：history 由服务端过滤后传入，上下文资料以附加 system 消息注入
async function bossChat(history, plan, priceNotes, knowledge) {
  const messages = [
    { role: 'system', content: BOSS_PERSONA },
    { role: 'system', content: '【系统资料，仅你可见，回答时据此引用】\n' + (buildContext(plan, priceNotes, knowledge) || '（顾客还没生成方案）') },
    ...history
  ];
  const content = await chat(messages, { temperature: 0.8, maxTokens: 400 });
  return content.trim();
}

module.exports = { configured, parseRequirement, reviewBuild, bossChat };
