'use strict';
// 把根目录的 lib/ 与 data/ 同步进云函数目录，保证云开发版与自建后端同源。
// 每次改动 lib/ 或 data/ 后、上传云函数前跑一次：node scripts/sync-cloud.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, 'cloudfunctions', 'zhuangji');

// llm-advisor 不进云函数（云开发版 AI 走小程序端 wx.cloud.extend.AI）
const LIB_FILES = ['recommender.js', 'price-service.js', 'price-history.js', 'knowledge.js', 'boss-prompts.js'];
const DATA_FILES = ['parts.json', 'knowledge.json', 'price-history.json'];

for (const [dir, files] of [['lib', LIB_FILES], ['data', DATA_FILES]]) {
  fs.mkdirSync(path.join(DEST, dir), { recursive: true });
  for (const f of files) {
    fs.copyFileSync(path.join(ROOT, dir, f), path.join(DEST, dir, f));
    console.log(`同步 ${dir}/${f}`);
  }
}
console.log('云函数源码已同步 -> cloudfunctions/zhuangji/');
