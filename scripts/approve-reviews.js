'use strict';
// 口碑管道·第3层（人工审核闸门）：reviews-pending 审核通过 -> data/reviews.json 生效
// 用法：node scripts/approve-reviews.js <零件ID...|all>
// 错误的“翻车点”会直接影响购买决策，所以口碑必须过人工这道闸，不自动入库。

const fs = require('fs');
const path = require('path');

const PENDING = path.join(__dirname, '..', 'data', 'reviews-pending.json');
const LIVE = path.join(__dirname, '..', 'data', 'reviews.json');

const args = process.argv.slice(2);
if (args.length === 0) { console.error('用法：node scripts/approve-reviews.js <零件ID...|all>'); process.exit(1); }

let pending = {};
try { pending = JSON.parse(fs.readFileSync(PENDING, 'utf8')); } catch (e) {
  console.error('没有待审核卡片，先运行 digest-reviews.js'); process.exit(1);
}
let live = {};
try { live = JSON.parse(fs.readFileSync(LIVE, 'utf8')); } catch (e) { /* 首次 */ }

const ids = args[0] === 'all' ? Object.keys(pending) : args;
let n = 0;
for (const id of ids) {
  if (!pending[id]) { console.log(`跳过 ${id}：不在待审核列表`); continue; }
  live[id] = pending[id];
  delete pending[id];
  n++;
  console.log(`✓ 入库 ${id}`);
}
fs.writeFileSync(LIVE, JSON.stringify(live, null, 2));
fs.writeFileSync(PENDING, JSON.stringify(pending, null, 2));
console.log(`\n${n} 张口碑卡片已生效 -> ${LIVE}`);
console.log('提示：口碑有时效性（驱动/BIOS更新会改变结论），建议每季度重跑管道刷新');
