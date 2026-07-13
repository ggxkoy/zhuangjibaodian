'use strict';
// 装机宝典云函数（微信云开发版后端）：与自建后端同源，lib/ 与 data/ 由
// scripts/sync-cloud.js 从仓库根目录同步，请勿直接修改这里的副本。
//
// AI（老板娘/需求解析/点评）不在云函数里调用：小程序端直接走云开发内置大模型
// wx.cloud.extend.AI（DeepSeek），本函数只通过 action=prompts 下发人设与上下文资料。
//
// 注意：云函数文件系统只读，价格历史不会追加（走势判定基于内置基线数据）；
// 电商联盟凭据配置在云函数控制台的「环境变量」里。

const { recommend } = require('./lib/recommender');
const { getPrices, configuredPlatforms } = require('./lib/price-service');
const { tipsForBuild, allKnowledge } = require('./lib/knowledge');
const { attachReviews } = require('./lib/reviews');
const prompts = require('./lib/boss-prompts');
const advisor = require('./lib/llm-advisor');
const CHARACTERS = require('./data/characters.json');

// 在云函数控制台配置环境变量 DEEPSEEK_API_KEY（可选 DEEPSEEK_MODEL/DEEPSEEK_BASE_URL），
// 即可用自己的 DeepSeek 账号跑 AI（ownKey 模式），替代云开发内置模型。

async function priceNotesFor(plan) {
  const notes = {};
  if (plan && Array.isArray(plan.parts) && plan.parts.length <= 20) {
    const { prices } = await getPrices(plan.parts.map(p => p.id));
    for (const q of prices) {
      const v = q.history && q.history.verdict;
      notes[q.partId] = `当前最低约¥${q.price}${q.live ? '·实时' : '·参考价'}${v && v.label ? '·' + v.label : ''}`;
    }
  }
  return notes;
}

function cleanHistory(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map(m => ({ role: m.role, content: m.content.slice(0, 600) }));
}

function sanitizeCharacter(c) {
  if (!c || typeof c !== 'object') return null;
  return { name: String(c.name || '').slice(0, 12), style: String(c.style || '').slice(0, 200) };
}

exports.main = async (event = {}) => {
  try {
    switch (event.action) {
      case 'config':
        // 云开发环境 AI 恒可用：ownKey=true 走自有 DeepSeek key（云函数直连 api.deepseek.com），
        // 否则小程序端走云开发内置模型 wx.cloud.extend.AI
        return { ok: true, deepseek: true, ownKey: advisor.configured(), platforms: configuredPlatforms() };

      // ---- ownKey 模式：AI 在云函数内完成（用你自己的 DeepSeek key/模型） ----
      case 'elicit': {
        if (!advisor.configured()) return { ok: false, error: '云函数未配置 DEEPSEEK_API_KEY' };
        const history = cleanHistory(event.messages);
        if (history.length === 0) return { ok: false, error: '缺少对话内容' };
        const r = await advisor.elicit(history, sanitizeCharacter(event.character));
        return { ok: true, ...r };
      }
      case 'chat': {
        if (!advisor.configured()) return { ok: false, error: '云函数未配置 DEEPSEEK_API_KEY' };
        const history = cleanHistory(event.messages);
        if (history.length === 0) return { ok: false, error: '缺少对话内容' };
        const notes = await priceNotesFor(event.plan);
        const reply = await advisor.bossChat(history, event.plan, notes, allKnowledge(), sanitizeCharacter(event.character));
        return { ok: true, reply };
      }
      case 'review': {
        if (!advisor.configured()) return { ok: false, error: '云函数未配置 DEEPSEEK_API_KEY' };
        const plan = event.plan;
        if (!plan || !Array.isArray(plan.parts)) return { ok: false, error: '缺少方案数据' };
        const notes = await priceNotesFor(plan);
        const advice = await advisor.reviewBuild(plan, tipsForBuild(plan, 8), notes, event.note, sanitizeCharacter(event.character));
        return { ok: true, advice };
      }
      case 'parse': {
        if (!advisor.configured()) return { ok: false, error: '云函数未配置 DEEPSEEK_API_KEY' };
        if (!event.text || !String(event.text).trim()) return { ok: false, error: '请输入需求描述' };
        const parsed = await advisor.parseRequirement(String(event.text));
        return { ok: true, ...parsed };
      }

      case 'recommend': {
        const budget = parseInt(event.budget, 10);
        if (!Number.isFinite(budget) || budget <= 0 || budget > 500000) {
          return { ok: false, error: '请输入有效预算（1 ~ 500000 元）' };
        }
        const plan = recommend(budget, event.usage || 'gaming', Array.isArray(event.exclude) ? event.exclude : []);
        if (plan.error) return { ok: false, error: plan.error };
        plan.tips = tipsForBuild(plan);
        attachReviews(plan);
        return { ok: true, plan };
      }

      case 'prices': {
        const ids = (Array.isArray(event.ids) ? event.ids : []).slice(0, 20);
        if (ids.length === 0) return { ok: false, error: '缺少零件 ID' };
        const { prices, sources } = await getPrices(ids);
        return { ok: true, prices, sources, fetchedAt: new Date().toISOString() };
      }

      case 'characters':
        return { ok: true, characters: CHARACTERS };

      // 下发店主人设 + 当前方案上下文，供小程序端拼装 AI 消息；
      // character 为预设或用户自定义 { name, style }，铁律在 personaFor 内强制附加
      case 'prompts': {
        const plan = event.plan;
        const character = sanitizeCharacter(event.character);
        const priceNotes = {};
        if (plan && Array.isArray(plan.parts) && plan.parts.length <= 20) {
          const { prices } = await getPrices(plan.parts.map(p => p.id));
          for (const q of prices) {
            const v = q.history && q.history.verdict;
            priceNotes[q.partId] = `当前最低约¥${q.price}${q.live ? '·实时' : '·参考价'}${v && v.label ? '·' + v.label : ''}`;
          }
        }
        return {
          ok: true,
          persona: prompts.personaFor(character),
          parseSystem: prompts.PARSE_SYSTEM,
          elicitSystem: prompts.elicitSystem(character),
          reviewSystem: prompts.reviewSystem(character),
          context: prompts.buildContext(plan, priceNotes, allKnowledge())
        };
      }

      default:
        return { ok: false, error: '未知 action：' + event.action };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
