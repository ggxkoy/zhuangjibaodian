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
const CHARACTERS = require('./data/characters.json');

function sanitizeCharacter(c) {
  if (!c || typeof c !== 'object') return null;
  return { name: String(c.name || '').slice(0, 12), style: String(c.style || '').slice(0, 200) };
}

exports.main = async (event = {}) => {
  try {
    switch (event.action) {
      case 'config':
        // 云开发环境下 AI 能力由 wx.cloud.extend.AI 提供，无需 API key
        return { ok: true, deepseek: true, platforms: configuredPlatforms() };

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
