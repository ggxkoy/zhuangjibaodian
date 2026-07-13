'use strict';
// 口碑数据服务：加载人工审核过的口碑卡片（data/reviews.json），挂到方案零件上。
// 卡片由三层管道产出：fetch-reviews(采集B站等社区评论) -> digest-reviews(DeepSeek提炼)
// -> approve-reviews(人工审核入库)。每张卡片带样本量、置信度、原帖溯源链接、更新日期。

const fs = require('fs');
const path = require('path');

let REVIEWS = {};
try {
  REVIEWS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'reviews.json'), 'utf8'));
} catch (e) { REVIEWS = {}; }

function reviewFor(partId) {
  return REVIEWS[partId] || null;
}

// 给 /api/recommend 的方案零件挂上口碑卡片
function attachReviews(plan) {
  if (!plan || !Array.isArray(plan.parts)) return plan;
  for (const p of plan.parts) {
    const r = reviewFor(p.id);
    if (r) p.review = r;
  }
  return plan;
}

module.exports = { reviewFor, attachReviews };
