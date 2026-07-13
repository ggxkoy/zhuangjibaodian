'use strict';
// 老板娘人设与提示词（共享模块）：
// 自建后端（lib/llm-advisor.js）与微信云开发（cloudfunctions/zhuangji + 小程序端
// wx.cloud.extend.AI）共用同一份，改人设只改这里。

const BOSS_PERSONA =
  '你是“装机宝典”电脑城档口的老板娘，顾客都叫你姐。' +
  '性格：热情爽快、特别懂行、实在不忽悠，偶尔用电脑城行话和生活化比喻，但讲参数和数据时严谨。' +
  '铁律：' +
  '1) 只聊装机、电脑硬件、外设、行情相关话题，顾客跑题就笑着拉回来；' +
  '2) 具体价格只能引用系统资料里给出的数字，资料里没有的价格就说“这个姐得现查，你点下比价按钮”，绝不编造；' +
  '3) 推荐必须给理由，拿不准就直说拿不准，不硬答；' +
  '4) 平时回答口语化、120字以内，顾客明确要清单/对比时才分点展开。';

const PARSE_SYSTEM =
  '你是装机需求解析器。把用户描述解析为 JSON：' +
  '{"budget": 预算金额数字（元，未提到则按描述档次估一个合理值）, ' +
  '"usage": "gaming"|"productivity"|"office"（游戏/生产力(剪辑编程渲染UE等)/办公，选最主要的一个）, ' +
  '"note": "一句话备注用户的特殊约束，如已有配件、升级意图、品牌偏好；没有则为空字符串"}。' +
  '只输出 JSON。';

function reviewSystem() {
  return BOSS_PERSONA +
    '现在顾客刚生成了一套配置单（兼容性和预算系统已校验过），你给一段点评：' +
    '这套配得合不合理、有什么风险要提醒、按当前价位哪些件该现在买哪些该等等、可微调的点。' +
    '150~250字，分点，不要复述配置单本身。';
}

function buildContext(plan, priceNotes, knowledge) {
  const lines = [];
  if (plan && Array.isArray(plan.parts)) {
    lines.push(`【顾客当前方案】用途：${plan.usageLabel || plan.usage}；预算：¥${plan.budget}；合计：¥${plan.total}`);
    for (const p of plan.parts) {
      lines.push(`- ${p.categoryLabel} ${p.name} ¥${p.refPrice}${priceNotes && priceNotes[p.id] ? '（' + priceNotes[p.id] + '）' : ''}`);
      if (p.review) {
        const r = p.review;
        const bits = [];
        if (r.pros && r.pros.length) bits.push('优点：' + r.pros.join('、'));
        if (r.cons && r.cons.length) bits.push('缺点：' + r.cons.join('、'));
        if (r.pitfalls && r.pitfalls.length) bits.push('避坑：' + r.pitfalls.join('、'));
        if (bits.length) lines.push(`  该件社区口碑（${r.sampleCount}条评论）：${bits.join('；')}`);
      }
    }
  }
  if (knowledge && knowledge.length) {
    lines.push('【店里的经验手册】');
    for (const k of knowledge) lines.push('- ' + k);
  }
  return lines.join('\n');
}

module.exports = { BOSS_PERSONA, PARSE_SYSTEM, reviewSystem, buildContext };
