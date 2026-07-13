'use strict';
// 口碑管道·第2层（AI 提炼）：reviews-inbox 原始评论 -> DeepSeek 提炼口碑卡片
// -> data/reviews-pending.json（待人工审核，不直接生效）
//
// 用法：DEEPSEEK_API_KEY=sk-xxx node scripts/digest-reviews.js <零件ID|all>
// 审核后：node scripts/approve-reviews.js <零件ID|all> 才会入库生效。

const fs = require('fs');
const path = require('path');
const advisor = require('../lib/llm-advisor');

const INBOX = path.join(__dirname, '..', 'data', 'reviews-inbox.json');
const PENDING = path.join(__dirname, '..', 'data', 'reviews-pending.json');

(async () => {
  if (!advisor.configured()) {
    console.error('需要 DEEPSEEK_API_KEY 环境变量'); process.exit(1);
  }
  const arg = process.argv[2];
  if (!arg) { console.error('用法：node scripts/digest-reviews.js <零件ID|all>'); process.exit(1); }

  let inbox = {};
  try { inbox = JSON.parse(fs.readFileSync(INBOX, 'utf8')); } catch (e) {
    console.error('先运行 fetch-reviews.js 采集语料'); process.exit(1);
  }
  const ids = arg === 'all' ? Object.keys(inbox) : [arg];

  let pending = {};
  try { pending = JSON.parse(fs.readFileSync(PENDING, 'utf8')); } catch (e) { /* 首次 */ }

  for (const id of ids) {
    const entry = inbox[id];
    if (!entry || !entry.comments || entry.comments.length < 5) {
      console.log(`跳过 ${id}：语料不足（<5条），不提炼以免以偏概全`); continue;
    }
    process.stdout.write(`提炼 ${entry.name}（${entry.comments.length}条）… `);
    try {
      const card = await advisor.digestReviews(entry.name, entry.comments);
      pending[id] = {
        ...card,
        sampleCount: entry.comments.length,
        sources: entry.sources,
        updatedAt: entry.fetchedAt
      };
      console.log('完成，置信度 ' + card.confidence);
    } catch (e) { console.log('失败：' + e.message); }
  }
  fs.writeFileSync(PENDING, JSON.stringify(pending, null, 2));
  console.log(`\n待审核卡片已写入 ${PENDING}`);
  console.log('请人工核对（尤其 pitfalls 字段）后运行：node scripts/approve-reviews.js <零件ID|all>');
})();
