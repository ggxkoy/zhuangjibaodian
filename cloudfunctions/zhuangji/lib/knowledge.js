'use strict';
// 装机经验库：内置精选的装机圈共识（图拉丁吧等社区沉淀），
// 按方案零件/平台/用途匹配出最相关的几条，作为固定装机经验展示。
// scripts/fetch-knowledge.js 可从论坛抓取候选条目供人工筛选入库。

const fs = require('fs');
const path = require('path');
const { PARTS } = require('./recommender');

const ENTRIES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'knowledge.json'), 'utf8'));

const PART_BY_ID = {};
for (const list of Object.values(PARTS)) {
  for (const p of list) PART_BY_ID[p.id] = p;
}

// plan: /api/recommend 的输出（含 parts[].id / usage）
function tipsForBuild(plan, limit = 5) {
  const ids = new Set(plan.parts.map(p => p.id));
  const cpu = plan.parts.map(p => PART_BY_ID[p.id]).find(p => p && p.socket);
  const gpu = plan.parts.filter(p => p.category === 'gpu').map(p => PART_BY_ID[p.id])[0];
  const ram = plan.parts.filter(p => p.category === 'ram').map(p => PART_BY_ID[p.id])[0];

  const scored = [];
  for (const e of ENTRIES) {
    const m = e.match || {};
    let score = 0;
    if (m.parts && m.parts.some(id => ids.has(id))) score += 3;
    if (m.sockets && cpu && m.sockets.includes(cpu.socket)) score += 2;
    if (m.usages && m.usages.includes(plan.usage)) score += 2;
    if (m.ramType && ram && ram.type === m.ramType) score += 1;
    if (m.cpuTdpGte) {
      // 组合条件：主板/其它条件命中的同时还要求 CPU TDP 达标
      if (!(cpu && cpu.tdp >= m.cpuTdpGte)) score = 0;
    }
    if (m.gpuPowerGte && gpu && gpu.power >= m.gpuPowerGte) score += 2;
    if (score === 0 && m.always) score = 0.5;
    if (score > 0) scored.push({ score: score * (e.weight || 1), text: e.text, source: e.source });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
    .map(({ text, source }) => ({ text, source }));
}

function allKnowledge() {
  return ENTRIES.map(e => `[${e.source}] ${e.text}`);
}

module.exports = { tipsForBuild, allKnowledge };
