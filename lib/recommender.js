'use strict';
// 装机方案推荐引擎：根据预算 + 用途，枚举 CPU×显卡 组合并补全兼容配件，选出总分最高的方案

const fs = require('fs');
const path = require('path');

const PARTS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'parts.json'), 'utf8'));

const USAGE_PROFILES = {
  gaming: {
    label: '游戏',
    cpuWeight: { game: 0.8, work: 0.2 },
    score: b => b.gpu.game * 0.7 + b.cpu.game * 0.3 + Math.min(b.ram.capacity, 32) * 0.15,
    needGpu: true,
    ramTarget: 0.14, ssdTarget: 0.1,
    minBudget: 4000
  },
  productivity: {
    label: '生产力',
    cpuWeight: { game: 0.2, work: 0.8 },
    score: b => b.cpu.work * 0.55 + (b.gpu ? b.gpu.work : 0) * 0.3 + Math.min(b.ram.capacity, 96) * 0.12,
    needGpu: false,
    ramTarget: 0.2, ssdTarget: 0.12,
    minBudget: 3200
  },
  office: {
    label: '办公',
    cpuWeight: { game: 0.1, work: 0.9 },
    score: b => b.cpu.work * 0.7 + Math.min(b.ram.capacity, 32) * 0.3,
    needGpu: false, igpuOnly: true,
    ramTarget: 0.25, ssdTarget: 0.18,
    minBudget: 3000
  }
};

function pickBestUnder(list, target, valueFn) {
  // 优先选 target 价位（放宽10%）内“价值”最高的；全都超价则选最便宜的兜底
  const affordable = list.filter(p => p.refPrice <= target * 1.1);
  if (affordable.length === 0) return list.slice().sort((a, b) => a.refPrice - b.refPrice)[0];
  return affordable.sort((a, b) => valueFn(b) - valueFn(a))[0];
}

function pickBoard(cpu, target) {
  const boards = PARTS.motherboard.filter(m => m.socket === cpu.socket);
  return pickBestUnder(boards, Math.max(target, Math.min(...boards.map(b => b.refPrice))), b => -Math.abs(b.refPrice - target));
}

function pickRam(board, target) {
  const rams = PARTS.ram.filter(r => r.type === board.ramType);
  return pickBestUnder(rams, target, r => r.capacity);
}

function pickSsd(target) {
  return pickBestUnder(PARTS.ssd, target, s => s.refPrice);
}

function pickPsu(cpu, gpu) {
  const need = Math.ceil((cpu.tdp + (gpu ? gpu.power : 30) + 100) * 1.35);
  const ok = PARTS.psu.filter(p => p.watts >= need).sort((a, b) => a.refPrice - b.refPrice);
  return ok[0] || PARTS.psu[PARTS.psu.length - 1];
}

function pickCooler(cpu) {
  const ok = PARTS.cooler.filter(c => c.maxTdp >= cpu.tdp + 25).sort((a, b) => a.refPrice - b.refPrice);
  return ok[0] || PARTS.cooler[PARTS.cooler.length - 1];
}

function pickCase(board, budget) {
  const ok = PARTS.case.filter(c => c.fits.includes(board.formFactor)).sort((a, b) => a.refPrice - b.refPrice);
  if (budget >= 10000 && ok.length > 1) return ok[ok.length - 1]; // 高预算给海景房
  return ok[0];
}

function buildTotal(b) {
  return ['cpu', 'gpu', 'motherboard', 'ram', 'ssd', 'psu', 'cooler', 'case']
    .reduce((sum, k) => sum + (b[k] ? b[k].refPrice : 0), 0);
}

function assemble(cpu, gpu, budget, profile) {
  const spent = cpu.refPrice + (gpu ? gpu.refPrice : 0);
  if (spent > budget * 0.85) return null;
  const rest = budget - spent;
  const board = pickBoard(cpu, Math.min(rest * 0.28, budget * 0.14));
  if (!board) return null;
  const build = {
    cpu, gpu, motherboard: board,
    ram: pickRam(board, Math.max(budget * profile.ramTarget, 249)),
    ssd: pickSsd(Math.max(budget * profile.ssdTarget, 299)),
    psu: pickPsu(cpu, gpu),
    cooler: pickCooler(cpu),
    case: pickCase(board, budget)
  };
  build.total = buildTotal(build);
  if (build.total > budget) return null;
  // 剩余预算依次尝试升级内存、固态，高预算再升级散热（不超预算）
  const upgrades = [
    ['ram', PARTS.ram.filter(r => r.type === board.ramType), (a, b) => a.capacity > b.capacity],
    ['ssd', PARTS.ssd, (a, b) => a.refPrice > b.refPrice]
  ];
  if (budget >= 12000) {
    upgrades.push(['cooler', PARTS.cooler.filter(c => c.maxTdp >= cpu.tdp + 25), (a, b) => a.maxTdp > b.maxTdp]);
  }
  for (const [key, list, better] of upgrades) {
    for (const cand of list.slice().sort((a, b) => a.refPrice - b.refPrice)) {
      if (better(cand, build[key]) && build.total - build[key].refPrice + cand.refPrice <= budget * 0.99) {
        build.total += cand.refPrice - build[key].refPrice;
        build[key] = cand;
      }
    }
  }
  build.score = profile.score(build) * (1 + 0.06 * (build.total / budget));
  return build;
}

function recommend(budget, usage, exclude = []) {
  const profile = USAGE_PROFILES[usage];
  if (!profile) throw new Error('未知用途：' + usage);
  if (budget < profile.minBudget) {
    return { error: `预算过低：${profile.label}主机建议至少 ¥${profile.minBudget}` };
  }
  const excl = new Set(exclude);
  const cpus = PARTS.cpu.filter(c => !excl.has(c.id) && (!profile.igpuOnly || c.hasIGPU));
  const gpus = profile.igpuOnly ? [null] : PARTS.gpu.filter(g => !excl.has(g.id));
  if (!profile.needGpu && !profile.igpuOnly) gpus.push(null); // 生产力可用核显

  let best = null;
  for (const cpu of cpus) {
    for (const gpu of gpus) {
      if (gpu === null && !cpu.hasIGPU) continue;
      const b = assemble(cpu, gpu, budget, profile);
      if (b && (!best || b.score > best.score)) best = b;
    }
  }
  if (!best) return { error: '该预算下未能生成可行方案，请调整预算后重试' };
  return formatBuild(best, budget, usage, profile);
}

const CATEGORY_META = {
  cpu: { label: '处理器 CPU', icon: '🧠' },
  motherboard: { label: '主板', icon: '🔲' },
  gpu: { label: '显卡', icon: '🎮' },
  ram: { label: '内存', icon: '📗' },
  ssd: { label: '固态硬盘', icon: '💾' },
  psu: { label: '电源', icon: '🔌' },
  cooler: { label: '散热器', icon: '❄️' },
  case: { label: '机箱', icon: '📦' }
};

function specLine(cat, p) {
  switch (cat) {
    case 'cpu': return `${p.cores} · ${p.socket}${p.hasIGPU ? ' · 带核显' : ''}`;
    case 'motherboard': return `${p.formFactor} · ${p.ramType}`;
    case 'gpu': return `显存 ${p.vram} · 功耗 ${p.power}W`;
    case 'ram': return p.type;
    case 'ssd': return `容量 ${p.capacity}`;
    case 'psu': return `额定 ${p.watts}W`;
    case 'cooler': return `${p.type} · 解热 ${p.maxTdp}W`;
    case 'case': return `支持 ${p.fits.join('/')}`;
    default: return '';
  }
}

function perfSummary(build, usage) {
  if (usage === 'office') {
    return `${build.cpu.cores}处理器 + ${build.ram.capacity}GB 内存，日常办公、网页多开、视频会议流畅无压力。`;
  }
  const g = build.gpu ? build.gpu.game : build.cpu.game * 0.5;
  let gameDesc;
  if (g >= 90) gameDesc = '4K 光追全高特效畅玩一切 3A 大作';
  else if (g >= 75) gameDesc = '2K~4K 高特效流畅运行 3A 大作';
  else if (g >= 60) gameDesc = '2K 高画质流畅运行主流 3A 大作';
  else if (g >= 48) gameDesc = '1080P 高画质运行 3A，电竞网游高帧率';
  else gameDesc = '1080P 流畅运行主流电竞网游';
  if (usage === 'productivity') {
    return `${build.cpu.cores}处理器 + ${build.ram.capacity}GB 内存，适合视频剪辑、编程编译、3D 渲染等生产力场景；${gameDesc}。`;
  }
  return gameDesc + '。';
}

function formatBuild(build, budget, usage, profile) {
  const parts = [];
  for (const cat of Object.keys(CATEGORY_META)) {
    const p = build[cat];
    if (!p) continue;
    parts.push({
      category: cat,
      categoryLabel: CATEGORY_META[cat].label,
      icon: CATEGORY_META[cat].icon,
      id: p.id,
      name: p.name,
      spec: specLine(cat, p),
      refPrice: p.refPrice,
      keyword: p.keyword
    });
  }
  return {
    usage, usageLabel: profile.label, budget,
    total: build.total,
    remaining: budget - build.total,
    summary: perfSummary(build, usage),
    parts,
    keyIds: { cpu: build.cpu.id, gpu: build.gpu ? build.gpu.id : null }
  };
}

module.exports = { recommend, PARTS };
