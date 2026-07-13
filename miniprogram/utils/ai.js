// AI 能力双模式封装（需求解析 / 老板娘点评 / 老板娘对话）：
//   mode 'server' —— 转发到自建后端，后端持有 DEEPSEEK_API_KEY
//   mode 'cloud'  —— 小程序端直接调用微信云开发内置大模型 wx.cloud.extend.AI
//                    （DeepSeek，由云开发提供，无需任何 API key；基础库 ≥ 3.7.1）
// 人设与提示词由云函数 action=prompts 下发，与自建后端同源（lib/boss-prompts.js）。

const { mode, serverRequest, cloudCall } = require('./api');

// 当前店主角色（自定义老板娘）：只传人设相关字段
function character() {
  const ch = getApp().globalData.character;
  return ch ? { name: ch.name, style: ch.style } : null;
}

// 云模式下若云函数配了自己的 DEEPSEEK_API_KEY（ownKey），AI 全部走云函数（可自选模型）；
// 否则走云开发内置模型 wx.cloud.extend.AI
function ownKey() { return !!getApp().globalData.config.ownKey; }

function extractJson(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 未返回有效结果');
  return JSON.parse(m[0]);
}

async function cloudAiText(messages) {
  const model = wx.cloud.extend.AI.createModel('deepseek');
  const res = await model.streamText({
    data: { model: 'deepseek-v3', messages }
  });
  let out = '';
  for await (const chunk of res.textStream) out += chunk;
  if (!out.trim()) throw new Error('AI 未返回内容');
  return out.trim();
}

async function parseRequirement(text) {
  if (mode() !== 'cloud') return serverRequest('/api/parse', { method: 'POST', data: { text } });
  if (ownKey()) return cloudCall('parse', { text });
  const p = await cloudCall('prompts', {});
  const raw = await cloudAiText([
    { role: 'system', content: p.parseSystem },
    { role: 'user', content: text.slice(0, 500) }
  ]);
  const r = extractJson(raw);
  const budget = Math.round(Number(r.budget));
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('未能从描述中解析出预算');
  return {
    budget,
    usage: ['gaming', 'productivity', 'office'].includes(r.usage) ? r.usage : 'gaming',
    note: String(r.note || '').slice(0, 200)
  };
}

// 对话式需求确立：返回 { ready, budget, usage, note, reply }
async function elicit(messages) {
  if (mode() !== 'cloud') {
    return serverRequest('/api/elicit', { method: 'POST', data: { messages, character: character() } });
  }
  if (ownKey()) return cloudCall('elicit', { messages, character: character() });
  const p = await cloudCall('prompts', { character: character() });
  const raw = await cloudAiText([
    { role: 'system', content: p.elicitSystem },
    ...messages.slice(-10).map(m => ({ role: m.role, content: String(m.content).slice(0, 600) }))
  ]);
  const r = extractJson(raw);
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

async function reviewBuild(plan, note) {
  if (mode() !== 'cloud') {
    const data = await serverRequest('/api/review', { method: 'POST', data: { plan, note, character: character() } });
    return data.advice;
  }
  if (ownKey()) return (await cloudCall('review', { plan, note, character: character() })).advice;
  const p = await cloudCall('prompts', { plan, character: character() });
  return cloudAiText([
    { role: 'system', content: p.reviewSystem },
    { role: 'user', content: (note ? `顾客特殊需求：${note}\n` : '') + p.context }
  ]);
}

async function bossChat(messages, plan) {
  if (mode() !== 'cloud') {
    const data = await serverRequest('/api/chat', { method: 'POST', data: { messages, plan, character: character() } });
    return data.reply;
  }
  if (ownKey()) return (await cloudCall('chat', { messages, plan, character: character() })).reply;
  const p = await cloudCall('prompts', { plan, character: character() });
  return cloudAiText([
    { role: 'system', content: p.persona },
    { role: 'system', content: '【系统资料，仅你可见，回答时据此引用】\n' + (p.context || '（顾客还没生成方案）') },
    ...messages.slice(-12).map(m => ({ role: m.role, content: String(m.content).slice(0, 600) }))
  ]);
}

module.exports = { parseRequirement, elicit, reviewBuild, bossChat };
