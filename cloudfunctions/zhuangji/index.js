'use strict';
// 装机宝典个人主体审核版云函数：只提供规则推荐、价格与固定资料查询。
// lib/ 与 data/ 用 scripts/sync-cloud.js 从仓库根目录同步。
//
// 注意：云函数文件系统只读，价格历史不会追加（走势判定基于内置基线数据）；
// 电商联盟凭据配置在云函数控制台的「环境变量」里。

const { recommend } = require('./lib/recommender');
const { getPrices, configuredPlatforms } = require('./lib/price-service');
const { tipsForBuild } = require('./lib/knowledge');
const { attachReviews } = require('./lib/reviews');

exports.main = async (event = {}) => {
  try {
    switch (event.action) {
      case 'config':
        return { ok: true, ruleEngine: true, platforms: configuredPlatforms() };

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

      default:
        return { ok: false, error: '未知 action：' + event.action };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
