'use strict';
// 多平台比价服务：并发向各电商平台适配器拉取实时价格，取最低价；
// 任一平台拉取失败（超时/风控/无凭据）时自动回退到本地参考价，并在结果中标明来源。

const https = require('https');
const { PARTS } = require('./recommender');

const FETCH_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 实时价缓存10分钟
const cache = new Map(); // partId -> { at, data }

const ALL_PARTS = {};
for (const list of Object.values(PARTS)) {
  for (const p of list) ALL_PARTS[p.id] = p;
}

function httpGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: FETCH_TIMEOUT_MS }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// ---------- 平台适配器 ----------
// 每个适配器：输入零件，返回 { price } 或抛错（由上层回退处理）。

const adapters = {
  // 京东：公开价格接口，需在 parts.json 中为零件填入 jdSku（商品页 URL 中的数字 ID）
  async jd(part) {
    if (!part.jdSku) throw new Error('未配置京东 SKU');
    const data = await httpGetJson(`https://p.3.cn/prices/mgets?skuIds=J_${part.jdSku}`, {
      'User-Agent': 'Mozilla/5.0', Referer: 'https://item.jd.com/'
    });
    const price = parseFloat(data && data[0] && data[0].p);
    if (!(price > 0)) throw new Error('无有效价格');
    return { price };
  },

  // 淘宝/天猫：需接入淘宝开放平台（taobao.tbk.item.info.get 等），
  // 配置环境变量 TAOBAO_APP_KEY / TAOBAO_APP_SECRET 后在此实现签名请求。
  async taobao() {
    if (!process.env.TAOBAO_APP_KEY) throw new Error('未配置淘宝开放平台凭据');
    throw new Error('淘宝适配器待接入');
  },

  // 拼多多：需接入多多进宝开放平台（pdd.ddk.goods.search），
  // 配置环境变量 PDD_CLIENT_ID / PDD_CLIENT_SECRET 后在此实现。
  async pdd() {
    if (!process.env.PDD_CLIENT_ID) throw new Error('未配置拼多多开放平台凭据');
    throw new Error('拼多多适配器待接入');
  }
};

function searchLinks(part) {
  const kw = encodeURIComponent(part.keyword || part.name);
  return {
    jd: part.jdSku ? `https://item.jd.com/${part.jdSku}.html` : `https://search.jd.com/Search?keyword=${kw}`,
    taobao: `https://s.taobao.com/search?q=${kw}`,
    pdd: `https://mobile.yangkeduo.com/search_result.html?search_key=${kw}`
  };
}

async function fetchPartPrice(part) {
  const hit = cache.get(part.id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const platforms = ['jd', 'taobao', 'pdd'];
  const results = await Promise.allSettled(platforms.map(p => adapters[p](part)));
  const quotes = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value && r.value.price > 0) {
      quotes.push({ platform: platforms[i], price: r.value.price, live: true });
    }
  });

  let best;
  if (quotes.length > 0) {
    best = quotes.sort((a, b) => a.price - b.price)[0];
  } else {
    best = { platform: 'ref', price: part.refPrice, live: false };
  }
  const data = {
    partId: part.id,
    price: best.price,
    platform: best.platform,
    live: best.live,
    quotes,
    links: searchLinks(part)
  };
  cache.set(part.id, { at: Date.now(), data });
  return data;
}

async function getPrices(partIds) {
  const parts = partIds.map(id => ALL_PARTS[id]).filter(Boolean);
  return Promise.all(parts.map(fetchPartPrice));
}

module.exports = { getPrices };
