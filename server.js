'use strict';
// 装机宝典 — 零依赖 Node.js 服务：静态页面 + 推荐/比价 API
// 启动：node server.js  （默认 http://localhost:3000）

const http = require('http');
const fs = require('fs');
const path = require('path');
const { recommend } = require('./lib/recommender');
const { getPrices } = require('./lib/price-service');

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
      return sendJson(res, plan.error ? 422 : 200, plan);
    }

    if (url.pathname === '/api/prices') {
      const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0, 20);
      if (ids.length === 0) return sendJson(res, 400, { error: '缺少零件 ID' });
      const prices = await getPrices(ids);
      return sendJson(res, 200, { prices, fetchedAt: new Date().toISOString() });
    }

    return serveStatic(res, url.pathname);
  } catch (e) {
    return sendJson(res, 500, { error: '服务器错误：' + e.message });
  }
});

server.listen(PORT, () => {
  console.log(`装机宝典已启动: http://localhost:${PORT}`);
});
