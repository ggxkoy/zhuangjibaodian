'use strict';
// 多平台比价服务：并发向各电商平台开放接口拉取实时价格，取最低价。
//
// 三个适配器均为官方开放平台接口的完整实现（含签名），配置对应环境变量即启用：
//   京东联盟   JD_APP_KEY / JD_APP_SECRET            （union.jd.com 免费申请）
//   淘宝联盟   TAOBAO_APP_KEY / TAOBAO_APP_SECRET / TAOBAO_ADZONE_ID
//   多多进宝   PDD_CLIENT_ID / PDD_CLIENT_SECRET      （jinbao.pinduoduo.com）
//
// 未配置凭据或拉取失败时回退到本地参考价，结果中 live=false 明确标注，
// /api/prices 同时返回各平台接入状态，前端据此提示误差风险。

const https = require('https');
const crypto = require('crypto');
const querystring = require('querystring');
const { PARTS } = require('./recommender');
const history = require('./price-history');

const FETCH_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 实时价缓存10分钟
const cache = new Map(); // partId -> { at, data }

const ALL_PARTS = {};
for (const list of Object.values(PARTS)) {
  for (const p of list) ALL_PARTS[p.id] = p;
}

const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex');

// 京东/淘宝/拼多多开放平台同款签名：MD5(secret + 排序键值串 + secret) 大写
function md5Sign(params, secret) {
  const base = Object.keys(params).sort().map(k => k + params[k]).join('');
  return md5(secret + base + secret).toUpperCase();
}

// 东八区 "yyyy-MM-dd HH:mm:ss"（京东/淘宝签名要求北京时间）
function cnTimestamp() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function httpPostForm(url, params) {
  const body = querystring.stringify(params);
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'zhuangjibaodian/1.0'
      },
      timeout: FETCH_TIMEOUT_MS
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('响应非JSON: ' + data.slice(0, 120))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

// 关键词搜索结果里挑出“确实是这个零件”的最低价：
// 含数字的规格分词（容量/频率/型号，如 32G、6000、7500F）必须全部命中，
// 纯文字分词命中 60% 即可；价格须在参考价合理区间内（防止配件/错配/低配版本混入）
function lowestMatched(items, part) {
  const tokens = (part.keyword || part.name).toLowerCase().split(/\s+/).filter(Boolean);
  const specTokens = tokens.filter(t => /\d/.test(t));
  const textTokens = tokens.filter(t => !/\d/.test(t));
  const needText = Math.ceil(textTokens.length * 0.6);
  let best = null;
  for (const it of items) {
    const title = (it.title || '').toLowerCase();
    if (!specTokens.every(t => title.includes(t))) continue;
    if (textTokens.filter(t => title.includes(t)).length < needText) continue;
    if (!(it.price > 0)) continue;
    if (it.price < part.refPrice * 0.3 || it.price > part.refPrice * 4) continue;
    if (!best || it.price < best.price) best = it;
  }
  if (!best) throw new Error('搜索结果无可信匹配');
  return best; // 返回完整条目（含转链所需的 materialUrl/goods_sign 等平台字段）
}

// ---------- CPS 返佣转链（配置联盟推广位后，比价链接自动变成带佣金的推广链接） ----------

// 京东联盟：materialId(商品/搜索页URL) -> 推广短链；需 JD_UNION_ID（联盟后台的联盟ID）
async function jdPromoUrl(materialId, key, secret) {
  const params = {
    method: 'jd.union.open.promotion.byunionid.get',
    app_key: key, timestamp: cnTimestamp(),
    format: 'json', v: '1.0', sign_method: 'md5',
    '360buy_param_json': JSON.stringify({
      promotionCodeReq: { materialId, unionId: Number(process.env.JD_UNION_ID) }
    })
  };
  params.sign = md5Sign(params, secret);
  const res = await httpPostForm('https://api.jd.com/routerjson', params);
  if (res.error_response) throw new Error(res.error_response.zh_desc || res.error_response.code);
  const r = JSON.parse(res.jd_union_open_promotion_byunionid_get_responce.getResult);
  if (r.code !== 200 || !r.data) throw new Error(r.message || r.code);
  return r.data.shortURL || r.data.clickURL;
}

// 多多进宝：goods_sign -> 推广链接；需 PDD_PID（多多进宝推广位ID）
async function pddPromoUrl(goodsSign, cid, secret) {
  const params = {
    type: 'pdd.ddk.goods.promotion.url.generate',
    client_id: cid, timestamp: String(Math.floor(Date.now() / 1000)),
    data_type: 'JSON',
    p_id: process.env.PDD_PID,
    goods_sign_list: JSON.stringify([goodsSign])
  };
  params.sign = md5Sign(params, secret);
  const res = await httpPostForm('https://gw-api.pinduoduo.com/api/router', params);
  if (res.error_response) throw new Error(res.error_response.error_msg || res.error_response.error_code);
  const list = res.goods_promotion_url_generate_response
    && res.goods_promotion_url_generate_response.goods_promotion_url_list;
  if (!list || !list.length) throw new Error('转链无结果');
  return list[0].mobile_short_url || list[0].short_url || list[0].mobile_url || list[0].url;
}

// ---------- 平台适配器 ----------

const adapters = {
  // 京东联盟开放平台 jd.union.open.goods.query
  async jd(part) {
    const key = process.env.JD_APP_KEY, secret = process.env.JD_APP_SECRET;
    if (!key || !secret) throw new Error('未配置京东联盟凭据');
    const goodsReq = part.jdSku
      ? { skuIds: [Number(part.jdSku)] }
      : { keyword: part.keyword || part.name, pageIndex: 1, pageSize: 10, sortName: 'price', sort: 'asc' };
    const params = {
      method: 'jd.union.open.goods.query',
      app_key: key,
      timestamp: cnTimestamp(),
      format: 'json', v: '1.0', sign_method: 'md5',
      '360buy_param_json': JSON.stringify({ goodsReqDTO: goodsReq })
    };
    params.sign = md5Sign(params, secret);
    const res = await httpPostForm('https://api.jd.com/routerjson', params);
    if (res.error_response) throw new Error('京东: ' + (res.error_response.zh_desc || res.error_response.msg || res.error_response.code));
    const result = JSON.parse(res.jd_union_open_goods_query_responce.queryResult);
    if (result.code !== 200 || !result.data) throw new Error('京东: ' + (result.message || result.code));
    const items = result.data.map(g => ({
      title: g.skuName,
      price: g.priceInfo && (g.priceInfo.lowestPrice || g.priceInfo.price),
      materialUrl: g.materialUrl,
      skuId: g.skuId
    }));
    const best = lowestMatched(items, part);
    let promo;
    if (process.env.JD_UNION_ID) {
      try {
        promo = await jdPromoUrl(best.materialUrl || `https://item.jd.com/${best.skuId}.html`, key, secret);
      } catch (e) { /* 转链失败回退搜索链接，不影响取价 */ }
    }
    return { price: best.price, promo };
  },

  // 淘宝联盟 taobao.tbk.dg.material.optional
  async taobao(part) {
    const key = process.env.TAOBAO_APP_KEY, secret = process.env.TAOBAO_APP_SECRET;
    const adzone = process.env.TAOBAO_ADZONE_ID;
    if (!key || !secret || !adzone) throw new Error('未配置淘宝联盟凭据');
    const params = {
      method: 'taobao.tbk.dg.material.optional',
      app_key: key,
      timestamp: cnTimestamp(),
      format: 'json', v: '2.0', sign_method: 'md5',
      adzone_id: adzone,
      q: part.keyword || part.name,
      page_size: 10, sort: 'price_asc'
    };
    params.sign = md5Sign(params, secret);
    const res = await httpPostForm('https://eco.taobao.com/router/rest', params);
    if (res.error_response) throw new Error('淘宝: ' + (res.error_response.sub_msg || res.error_response.msg));
    const list = res.tbk_dg_material_optional_response
      && res.tbk_dg_material_optional_response.result_list
      && res.tbk_dg_material_optional_response.result_list.map_data;
    if (!list || !list.length) throw new Error('淘宝: 无结果');
    const items = list.map(g => ({
      title: g.title,
      price: parseFloat(g.zk_final_price),
      url: g.coupon_share_url || g.url || ''
    }));
    const best = lowestMatched(items, part);
    // 淘宝联盟接口返回的本就是带 adzone 的推广链接，直接用
    const promo = best.url ? (best.url.indexOf('//') === 0 ? 'https:' + best.url : best.url) : undefined;
    return { price: best.price, promo };
  },

  // 多多进宝 pdd.ddk.goods.search
  async pdd(part) {
    const cid = process.env.PDD_CLIENT_ID, secret = process.env.PDD_CLIENT_SECRET;
    if (!cid || !secret) throw new Error('未配置多多进宝凭据');
    const params = {
      type: 'pdd.ddk.goods.search',
      client_id: cid,
      timestamp: String(Math.floor(Date.now() / 1000)),
      data_type: 'JSON',
      keyword: part.keyword || part.name,
      page_size: '10'
    };
    if (process.env.PDD_PID) params.pid = process.env.PDD_PID;
    params.sign = md5Sign(params, secret);
    const res = await httpPostForm('https://gw-api.pinduoduo.com/api/router', params);
    if (res.error_response) throw new Error('拼多多: ' + (res.error_response.error_msg || res.error_response.error_code));
    const list = res.goods_search_response && res.goods_search_response.goods_list;
    if (!list || !list.length) throw new Error('拼多多: 无结果');
    const items = list.map(g => ({
      title: g.goods_name,
      price: (g.min_group_price || g.min_normal_price) / 100, // 接口返回单位为分
      goodsSign: g.goods_sign
    }));
    const best = lowestMatched(items, part);
    let promo;
    if (process.env.PDD_PID && best.goodsSign) {
      try { promo = await pddPromoUrl(best.goodsSign, cid, secret); } catch (e) { /* 转链失败回退 */ }
    }
    return { price: best.price, promo };
  }
};

function configuredPlatforms() {
  return {
    jd: !!(process.env.JD_APP_KEY && process.env.JD_APP_SECRET),
    taobao: !!(process.env.TAOBAO_APP_KEY && process.env.TAOBAO_APP_SECRET && process.env.TAOBAO_ADZONE_ID),
    pdd: !!(process.env.PDD_CLIENT_ID && process.env.PDD_CLIENT_SECRET)
  };
}

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
      quotes.push({ platform: platforms[i], price: r.value.price, live: true, promo: r.value.promo });
    }
  });

  let best;
  if (quotes.length > 0) {
    best = quotes.slice().sort((a, b) => a.price - b.price)[0];
  } else {
    best = { platform: 'ref', price: part.refPrice, live: false };
  }
  history.record(part.id, best.price, best.live);
  const stats = history.stats(part.id);
  // 有推广链接（CPS返佣）的平台覆盖默认搜索链接
  const links = searchLinks(part);
  for (const q of quotes) if (q.promo) links[q.platform] = q.promo;
  const data = {
    partId: part.id,
    price: best.price,
    platform: best.platform,
    live: best.live,
    quotes,
    links,
    history: stats ? { ...stats, verdict: history.verdict(best.price, stats) } : null
  };
  cache.set(part.id, { at: Date.now(), data });
  return data;
}

async function getPrices(partIds) {
  const parts = partIds.map(id => ALL_PARTS[id]).filter(Boolean);
  const prices = await Promise.all(parts.map(fetchPartPrice));
  return { prices, sources: configuredPlatforms() };
}

module.exports = { getPrices, adapters, lowestMatched, configuredPlatforms };
