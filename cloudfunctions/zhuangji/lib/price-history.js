'use strict';
// 价格历史与好价判定（参考“什么值得买”的历史价格曲线玩法）：
// 每次取到价格（实时或参考价）按天记录一个点，据此计算历史最低/均价，
// 判定当前价处于什么位置（接近历史低点 / 低于均价 / 平稳 / 历史高位）。

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'price-history.json');
const MAX_POINTS = 400; // 每个零件最多保留的天级数据点

let hist = {};
try { hist = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { hist = {}; }

let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(FILE, JSON.stringify(hist), err => { if (err) console.error('价格历史保存失败:', err.message); });
  }, 2000);
}

function today() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 每零件每天一个点：实时价优先于参考价，同源取更低价
function record(partId, price, live) {
  if (!(price > 0)) return;
  const arr = hist[partId] || (hist[partId] = []);
  const d = today();
  const last = arr[arr.length - 1];
  if (last && last.d === d) {
    if ((live && !last.live) || (live === !!last.live && price < last.p)) {
      last.p = price;
      last.live = !!live;
      saveSoon();
    }
    return;
  }
  arr.push({ d, p: price, live: !!live });
  if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS);
  saveSoon();
}

function stats(partId) {
  const arr = hist[partId];
  if (!arr || arr.length < 2) return null;
  const ps = arr.map(x => x.p);
  const min = Math.min(...ps);
  const max = Math.max(...ps);
  const avg = ps.reduce((a, b) => a + b, 0) / ps.length;
  return { min, max, avg: Math.round(avg), points: arr.slice(-24).map(x => ({ d: x.d, p: x.p })) };
}

// 判定当前价位：返回 { level, label }
function verdict(cur, s) {
  if (!s) return { level: 'none', label: '' };
  if ((s.max - s.min) / s.avg < 0.06) return { level: 'stable', label: '价格平稳' };
  if (cur <= s.min * 1.03) return { level: 'low', label: '接近历史低点' };
  if (cur <= s.avg) return { level: 'good', label: '低于近一年均价' };
  if (cur >= s.avg * 1.15) return { level: 'high', label: '历史高位' };
  return { level: 'normal', label: '价格正常' };
}

module.exports = { record, stats, verdict };
