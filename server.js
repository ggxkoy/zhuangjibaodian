'use strict';
// 装机宝典 — 零依赖 Node.js 服务：静态页面 + 推荐/比价 API
// 启动：node server.js  （默认 http://localhost:3000）

const http = require('http');
const fs = require('fs');
const path = require('path');
const { recommend } = require('./lib/recommender');
const { getPrices, configuredPlatforms } = require('./lib/price-service');
const { tipsForBuild, allKnowledge } = require('./lib/knowledge');
const advisor = require('./lib/llm-advisor');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > 64 * 1024) { req.destroy(); reject(new Error('请求体过大')); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(new Error('请求体非 JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname === '/api/recommend') {
      const budget = parseInt(url.searchParams.get('budget'), 10);
      const usage = url.searchParams.get('usage') || 'gaming';
      const exclude = (url.searchParams.get('exclude') || '').split(',').filter(Boolean);
      if (!Number.isFinite(budget) || budget <= 0 || budget > 500000) {
        return sendJson(res, 400, { error: '请输入有效预算（1 ~ 500000 元）' });
      }
      const plan = recommend(budget, usage, exclude);
      if (!plan.error) plan.tips = tipsForBuild(plan);
      return sendJson(res, plan.error ? 422 : 200, plan);
    }

    if (url.pathname === '/api/config') {
      return sendJson(res, 200, { deepseek: advisor.configured(), platforms: configuredPlatforms() });
    }

    // 自然语言需求解析（DeepSeek）
    if (url.pathname === '/api/parse' && req.method === 'POST') {
      if (!advisor.configured()) return sendJson(res, 501, { error: '未配置 DEEPSEEK_API_KEY，AI 需求解析不可用' });
      const { text } = await readJsonBody(req);
      if (!text || !String(text).trim()) return sendJson(res, 400, { error: '请输入需求描述' });
      const parsed = await advisor.parseRequirement(String(text));
      return sendJson(res, 200, parsed);
    }

    // AI 装机顾问点评（DeepSeek + 经验库）
    if (url.pathname === '/api/review' && req.method === 'POST') {
      if (!advisor.configured()) return sendJson(res, 501, { error: '未配置 DEEPSEEK_API_KEY，AI 点评不可用' });
      const { plan, note } = await readJsonBody(req);
      if (!plan || !Array.isArray(plan.parts)) return sendJson(res, 400, { error: '缺少方案数据' });
      // 附带各零件当前价位判定，让点评能提“该不该现在买”
      const { prices } = await getPrices(plan.parts.map(p => p.id));
      const priceNotes = {};
      for (const q of prices) {
        const v = q.history && q.history.verdict;
        if (v && v.label) priceNotes[q.partId] = v.label;
      }
      const advice = await advisor.reviewBuild(plan, tipsForBuild(plan, 8), priceNotes, note);
      return sendJson(res, 200, { advice });
    }

    // 老板娘多轮对话（DeepSeek + 方案上下文 + 经验库）
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      if (!advisor.configured()) return sendJson(res, 501, { error: '未配置 DEEPSEEK_API_KEY，老板娘暂时不在店里' });
      const { messages, plan } = await readJsonBody(req);
      if (!Array.isArray(messages) || messages.length === 0) return sendJson(res, 400, { error: '缺少对话内容' });
      // 只信任 user/assistant 两种角色，截断长度，防止客户端注入系统提示
      const history = messages
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-12)
        .map(m => ({ role: m.role, content: m.content.slice(0, 600) }));
      if (history.length === 0 || history[history.length - 1].role !== 'user') {
        return sendJson(res, 400, { error: '最后一条应为用户消息' });
      }
      let priceNotes = {};
      if (plan && Array.isArray(plan.parts) && plan.parts.length <= 20) {
        const { prices } = await getPrices(plan.parts.map(p => p.id));
        for (const q of prices) {
          const v = q.history && q.history.verdict;
          priceNotes[q.partId] = `当前最低约¥${q.price}${q.live ? '·实时' : '·参考价'}${v && v.label ? '·' + v.label : ''}`;
        }
      }
      const reply = await advisor.bossChat(history, plan, priceNotes, allKnowledge());
      return sendJson(res, 200, { reply });
    }

    if (url.pathname === '/api/prices') {
      const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0, 20);
      if (ids.length === 0) return sendJson(res, 400, { error: '缺少零件 ID' });
      const { prices, sources } = await getPrices(ids);
      return sendJson(res, 200, { prices, sources, fetchedAt: new Date().toISOString() });
    }

    return serveStatic(res, url.pathname);
  } catch (e) {
    return sendJson(res, 500, { error: '服务器错误：' + e.message });
  }
});

server.listen(PORT, () => {
  console.log(`装机宝典已启动: http://localhost:${PORT}`);
});
