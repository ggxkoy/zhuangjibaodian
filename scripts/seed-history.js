'use strict';
// 生成价格历史基线数据 data/price-history.json
//
// 说明：这是从公开行情报道推算的“品类级”粗粒度基线（非逐件真实成交价），
// 用于让好价判定在积累到真实数据前就有参照系；服务运行后每天记录的
// 真实取价会不断覆盖/追加，基线点带 seed 标记以示区别。
//
// 品类倍率依据（相对 2026-07 参考价）：
// - 内存：32G DDR5 从 2025 年中 ~900 元涨至 2026-07 ~3800 元（涨幅 322%）
// - 固态：1TB 从 ~500 元涨至 ~1200 元（半年翻倍）
// - CPU/显卡/主板/电源/散热/机箱：一年内基本平稳、略有回落

const fs = require('fs');
const path = require('path');

const PARTS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'parts.json'), 'utf8'));

const DATES = ['2025-07-12', '2025-10-12', '2026-01-12', '2026-04-12', '2026-07-01'];
const MULTIPLIERS = {
  ram: [0.23, 0.35, 0.6, 0.85, 0.98],
  ssd: [0.42, 0.55, 0.75, 0.9, 0.98],
  default: [1.02, 1.01, 1.0, 1.0, 1.0]
};

const hist = {};
for (const [cat, list] of Object.entries(PARTS)) {
  const mult = MULTIPLIERS[cat] || MULTIPLIERS.default;
  for (const p of list) {
    hist[p.id] = DATES.map((d, i) => ({
      d, p: Math.round(p.refPrice * mult[i]), live: false, seed: true
    }));
  }
}

const out = path.join(__dirname, '..', 'data', 'price-history.json');
fs.writeFileSync(out, JSON.stringify(hist));
console.log(`已生成 ${Object.keys(hist).length} 个零件的价格历史基线 -> ${out}`);
