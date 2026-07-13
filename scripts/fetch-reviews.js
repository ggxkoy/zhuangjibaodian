'use strict';
// 口碑管道·第1层（采集+清洗）：按零件抓取 B站评测视频的高赞评论
// -> data/reviews-inbox.json（原始语料，供第2层 AI 提炼）
//
// 用法：
//   node scripts/fetch-reviews.js gpu-rtx5060        # 指定零件
//   node scripts/fetch-reviews.js gpu                # 整个品类（逐个抓，自带限速）
//
// 清洗规则：长度过滤、水军/引流模式过滤（返现/加微信/链接）、去重、按点赞加权排序。
// 管道全景：fetch-reviews(采集) -> digest-reviews(AI提炼) -> approve-reviews(人工审核入库)

const https = require('https');
const fs = require('fs');
const path = require('path');

const PARTS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'parts.json'), 'utf8'));
const OUT = path.join(__dirname, '..', 'data', 'reviews-inbox.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function get(url, cookies = '') {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', Referer: 'https://www.bilibili.com/', ...(cookies ? { Cookie: cookies } : {}) },
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

// 水军/引流/无信息量评论过滤
const SPAM = /(返现|好评截图|加微|加v|vx|扣扣|qq群|链接|http|专属优惠|下单立减|抽奖|关注我)/i;

function cleanComments(raw) {
  const seen = new Set();
  return raw
    .map(r => ({ text: (r.content && r.content.message || '').replace(/\s+/g, ' ').trim(), like: r.like || 0 }))
    .filter(c => c.text.length >= 10 && c.text.length <= 300)
    .filter(c => !SPAM.test(c.text))
    .filter(c => {
      const key = c.text.slice(0, 20);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.like - a.like)
    .slice(0, 40);
}

// 视频标题相关性过滤：防止同名产品混入（如“白刃”既是内存也是鼠标微动）。
// 含数字的规格分词（DDR5/6000/32G/型号）至少命中一个，纯文字分词命中一半以上。
function titleMatches(title, keyword) {
  const t = title.replace(/<[^>]+>/g, '').toLowerCase();
  const tokens = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  const spec = tokens.filter(x => /\d/.test(x));
  const text = tokens.filter(x => !/\d/.test(x));
  if (spec.length && !spec.some(x => t.includes(x))) return false;
  const hit = text.filter(x => t.includes(x)).length;
  return hit >= Math.ceil(text.length * 0.5);
}

async function fetchForPart(part, cookies) {
  const kw = encodeURIComponent(`${part.keyword} 评测`);
  const search = JSON.parse((await get(
    `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${kw}&page=1&page_size=10`, cookies)).body);
  if (search.code !== 0) throw new Error('B站搜索返回 ' + search.code);
  const videos = (search.data.result || [])
    .filter(v => titleMatches(v.title || '', part.keyword))
    .slice(0, 3);
  const comments = [];
  const sources = [];
  for (const v of videos) {
    await sleep(800); // 限速，做有礼貌的爬虫
    try {
      const rep = JSON.parse((await get(
        `https://api.bilibili.com/x/v2/reply?type=1&oid=${v.aid}&sort=1&ps=20`, cookies)).body);
      if (rep.code !== 0 || !rep.data || !rep.data.replies) continue;
      const title = v.title.replace(/<[^>]+>/g, '');
      const url = `https://www.bilibili.com/video/av${v.aid}`;
      sources.push({ title, url, from: 'B站' });
      for (const c of cleanComments(rep.data.replies)) comments.push({ ...c, source: url });
    } catch (e) { console.error(`  评论抓取失败(av${v.aid})：${e.message}`); }
  }
  return { comments: comments.sort((a, b) => b.like - a.like).slice(0, 40), sources };
}

(async () => {
  const arg = process.argv[2];
  if (!arg) { console.error('用法：node scripts/fetch-reviews.js <零件ID|品类名(如 gpu)>'); process.exit(1); }
  let targets = [];
  if (PARTS[arg]) targets = PARTS[arg];
  else {
    for (const list of Object.values(PARTS)) {
      const hit = list.find(p => p.id === arg);
      if (hit) targets = [hit];
    }
  }
  if (targets.length === 0) { console.error('未找到零件或品类：' + arg); process.exit(1); }

  // 领游客 cookie
  const home = await get('https://www.bilibili.com/');
  const cookies = home.setCookies.map(c => c.split(';')[0]).join('; ');

  let inbox = {};
  try { inbox = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* 首次 */ }

  for (const part of targets) {
    process.stdout.write(`抓取 ${part.name} … `);
    try {
      const { comments, sources } = await fetchForPart(part, cookies);
      inbox[part.id] = { name: part.name, fetchedAt: new Date().toISOString().slice(0, 10), comments, sources };
      console.log(`${comments.length} 条评论（${sources.length} 个视频）`);
    } catch (e) { console.log('失败：' + e.message); }
    if (targets.length > 1) await sleep(1500);
  }
  fs.writeFileSync(OUT, JSON.stringify(inbox, null, 2));
  console.log(`\n语料已写入 ${OUT}`);
  console.log('下一步：DEEPSEEK_API_KEY=sk-xxx node scripts/digest-reviews.js <零件ID|all>');
})();
