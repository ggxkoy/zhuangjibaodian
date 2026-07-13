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
  const p = await cloudCall('prompts', {});
  const raw = await cloudAiText([
    { role: 'system', content: p.parseSystem },
    { role: 'user', content: text.slice(0, 500) }
  ]);
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 未返回有效解析结果');
  const r = JSON.parse(m[0]);
  const budget = Math.round(Number(r.budget));
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('未能从描述中解析出预算');
  return {
    budget,
    usage: ['gaming', 'productivity', 'office'].includes(r.usage) ? r.usage : 'gaming',
    note: String(r.note || '').slice(0, 200)
  };
}

async function reviewBuild(plan, note) {
  if (mode() !== 'cloud') {
    const data = await serverRequest('/api/review', { method: 'POST', data: { plan, note, character: character() } });
    return data.advice;
  }
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
  const p = await cloudCall('prompts', { plan, character: character() });
  return cloudAiText([
    { role: 'system', content: p.persona },
    { role: 'system', content: '【系统资料，仅你可见，回答时据此引用】\n' + (p.context || '（顾客还没生成方案）') },
    ...messages.slice(-12).map(m => ({ role: m.role, content: String(m.content).slice(0, 600) }))
  ]);
}

module.exports = { parseRequirement, reviewBuild, bossChat };
