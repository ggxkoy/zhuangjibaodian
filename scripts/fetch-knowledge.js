'use strict';
// 从装机论坛抓取经验候选条目 -> data/knowledge-inbox.json（仅供人工筛选，不自动入库）
//
// 用法：node scripts/fetch-knowledge.js [关键词]
//
// 说明：贴吧/论坛没有公开 API 且反爬严格，此脚本尽力而为：
// 抓取图拉丁吧网页版帖子标题作为“经验线索”，403/超时属正常现象
// （数据中心 IP 基本会被拦，家用网络成功率高一些）。
// 抓到的只是候选，人工提炼成经验条目后加进 data/knowledge.json 才会生效——
// 论坛帖子质量参差，自动入库只会污染经验库。

const https = require('https');
const fs = require('fs');
const path = require('path');

const keyword = process.argv[2] || '';
const url = keyword
  ? `https://tieba.baidu.com/f/search/res?ie=utf-8&kw=%E5%9B%BE%E6%8B%89%E4%B8%81&qw=${encodeURIComponent(keyword)}`
  : 'https://tieba.baidu.com/f?kw=%E5%9B%BE%E6%8B%89%E4%B8%81&ie=utf-8';

https.get(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9'
  },
  timeout: 10000
}, res => {
  if (res.statusCode !== 200) {
    console.error(`抓取失败：HTTP ${res.statusCode}（贴吧反爬拦截属正常，请换网络环境或手动整理经验帖）`);
    res.resume();
    return;
  }
  let html = '';
  res.setEncoding('utf8');
  res.on('data', c => { html += c; });
  res.on('end', () => {
    // 提取帖子标题（网页版列表页 title 属性 / 搜索结果页链接文本）
    const titles = new Set();
    for (const m of html.matchAll(/class="j_th_tit[^"]*"[^>]*title="([^"]{6,80})"/g)) titles.add(m[1]);
    for (const m of html.matchAll(/<a[^>]*data-tid[^>]*>([^<]{6,80})<\/a>/g)) titles.add(m[1]);
    if (titles.size === 0) {
      console.error('未解析到帖子标题（页面结构可能变化，或返回了验证页）');
      return;
    }
    const out = path.join(__dirname, '..', 'data', 'knowledge-inbox.json');
    let inbox = [];
    try { inbox = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { /* 首次运行 */ }
    const at = new Date().toISOString().slice(0, 10);
    for (const t of titles) {
      if (!inbox.some(x => x.title === t)) inbox.push({ title: t, from: '图拉丁吧', at });
    }
    fs.writeFileSync(out, JSON.stringify(inbox, null, 2));
    console.log(`抓到 ${titles.size} 条帖子标题，收件箱共 ${inbox.length} 条 -> ${out}`);
    console.log('请人工提炼有价值的经验后，补充进 data/knowledge.json');
  });
}).on('error', e => console.error('抓取失败：' + e.message))
  .on('timeout', function () { this.destroy(new Error('timeout')); });
