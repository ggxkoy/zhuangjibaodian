'use strict';
// 多源装机经验线索抓取 -> data/knowledge-inbox.json（仅供人工筛选，不自动入库）
//
// 用法：
//   node scripts/fetch-knowledge.js                    # 默认抓 B站专栏，关键词“装机”
//   node scripts/fetch-knowledge.js bilibili 装机避坑   # 指定源和关键词
//   node scripts/fetch-knowledge.js tieba 内存
//   node scripts/fetch-knowledge.js all 装机教程
//
// 源说明：
//   bilibili  B站专栏图文（公开 JSON API，先领游客 cookie 再搜索，成功率高）
//   tieba     百度图拉丁吧（无公开 API，反爬严格，数据中心 IP 基本 403，家用网络成功率高）
// 新增源只需在 SOURCES 里加一个 async 函数，返回 [{title, url, from}]。
//
// 抓到的只是候选线索，人工提炼成经验条目加进 data/knowledge.json 才会生效——
// 论坛/图文内容质量参差，自动入库只会污染经验库。

const https = require('https');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function get(url, { headers = {}, cookies = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', ...(cookies ? { Cookie: cookies } : {}), ...headers },
      timeout: 10000
    }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ body, setCookies: res.headers['set-cookie'] || [] }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const stripEm = s => s.replace(/<\/?em[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const SOURCES = {
  // B站专栏图文搜索：先访问主页领游客 cookie（buvid3），再调搜索接口
  async bilibili(keyword) {
    const home = await get('https://www.bilibili.com/');
    const cookies = home.setCookies.map(c => c.split(';')[0]).join('; ');
    const url = 'https://api.bilibili.com/x/web-interface/search/type?search_type=article'
      + `&keyword=${encodeURIComponent(keyword)}&page=1&page_size=20`;
    const { body } = await get(url, { cookies, headers: { Referer: 'https://search.bilibili.com/' } });
    const data = JSON.parse(body);
    if (data.code !== 0) throw new Error('B站接口返回 ' + data.code + ': ' + data.message);
    return (data.data.result || []).map(it => ({
      title: stripEm(it.title || ''),
      url: `https://www.bilibili.com/read/cv${it.id}`,
      from: 'B站专栏'
    })).filter(x => x.title.length >= 6);
  },

  // 百度图拉丁吧：网页版帖子列表/吧内搜索，反爬严格属正常现象
  async tieba(keyword) {
    const url = keyword
      ? `https://tieba.baidu.com/f/search/res?ie=utf-8&kw=%E5%9B%BE%E6%8B%89%E4%B8%81&qw=${encodeURIComponent(keyword)}`
      : 'https://tieba.baidu.com/f?kw=%E5%9B%BE%E6%8B%89%E4%B8%81&ie=utf-8';
    const { body } = await get(url);
    const out = [];
    for (const m of body.matchAll(/class="j_th_tit[^"]*"[^>]*title="([^"]{6,80})"[^>]*href="(\/p\/\d+)"/g)) {
      out.push({ title: m[1], url: 'https://tieba.baidu.com' + m[2], from: '图拉丁吧' });
    }
    for (const m of body.matchAll(/href="(\/p\/\d+[^"]*)"[^>]*data-tid[^>]*>([^<]{6,80})</g)) {
      out.push({ title: m[2], url: 'https://tieba.baidu.com' + m[1].replace(/&amp;/g, '&'), from: '图拉丁吧' });
    }
    if (out.length === 0) throw new Error('未解析到帖子（可能返回了验证页）');
    return out;
  }
};

(async () => {
  const arg1 = process.argv[2] || 'bilibili';
  const keyword = process.argv[3] || '装机';
  const names = arg1 === 'all' ? Object.keys(SOURCES) : [arg1];
  if (names.some(n => !SOURCES[n])) {
    console.error(`未知来源 "${arg1}"，可用：${Object.keys(SOURCES).join(' / ')} / all`);
    process.exit(1);
  }

  const found = [];
  for (const name of names) {
    try {
      const items = await SOURCES[name](keyword);
      console.log(`[${name}] 抓到 ${items.length} 条`);
      found.push(...items);
    } catch (e) {
      console.error(`[${name}] 抓取失败：${e.message}`);
    }
  }
  if (found.length === 0) { console.error('所有来源均无结果'); process.exit(1); }

  const out = path.join(__dirname, '..', 'data', 'knowledge-inbox.json');
  let inbox = [];
  try { inbox = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { /* 首次运行 */ }
  const at = new Date().toISOString().slice(0, 10);
  let added = 0;
  for (const it of found) {
    if (!inbox.some(x => x.title === it.title)) { inbox.push({ ...it, at }); added++; }
  }
  fs.writeFileSync(out, JSON.stringify(inbox, null, 2));
  console.log(`新增 ${added} 条，收件箱共 ${inbox.length} 条 -> ${out}`);
  console.log('请人工提炼有价值的经验后，补充进 data/knowledge.json');
})();
