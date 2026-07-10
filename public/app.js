'use strict';

const $ = sel => document.querySelector(sel);

const state = {
  usage: 'gaming',
  plan: null,
  excludeHistory: [] // “换一套”时排除已出过的核心件
};

const PLATFORM_NAMES = { jd: '京东', taobao: '淘宝', pdd: '拼多多', ref: '参考价' };

// ---------- 表单交互 ----------
$('#budget-chips').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  $('#budget').value = chip.dataset.v;
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('selected', c === chip));
});

$('#budget').addEventListener('input', () => {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
});

$('#usage-grid').addEventListener('click', e => {
  const item = e.target.closest('.usage-item');
  if (!item) return;
  state.usage = item.dataset.usage;
  document.querySelectorAll('.usage-item').forEach(u => u.classList.toggle('selected', u === item));
});

$('#btn-generate').addEventListener('click', () => generate(false));
$('#btn-regen').addEventListener('click', () => generate(true));
$('#btn-back').addEventListener('click', () => showPage('form'));
$('#btn-refresh-price').addEventListener('click', () => state.plan && loadPrices(state.plan, true));

function showPage(name) {
  $('#page-form').hidden = name !== 'form';
  $('#page-result').hidden = name !== 'result';
  window.scrollTo(0, 0);
}

function showError(msg) {
  const el = $('#form-error');
  el.textContent = msg;
  el.hidden = !msg;
}

// ---------- 生成方案 ----------
async function generate(regen) {
  const budget = parseInt($('#budget').value, 10);
  if (!budget || budget < 1000) {
    showPage('form');
    return showError('请输入有效预算（至少 1000 元）');
  }
  showError('');
  const btn = regen ? $('#btn-regen') : $('#btn-generate');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '正在生成…';

  if (!regen) state.excludeHistory = [];
  const exclude = state.excludeHistory.join(',');

  try {
    const res = await fetch(`/api/recommend?budget=${budget}&usage=${state.usage}&exclude=${exclude}`);
    const plan = await res.json();
    if (plan.error) {
      // 换一套时排除项可能耗尽候选，重置后再试一次
      if (regen && state.excludeHistory.length) {
        state.excludeHistory = [];
        return generate(true);
      }
      showPage('form');
      return showError(plan.error);
    }
    state.plan = plan;
    if (plan.keyIds.cpu) state.excludeHistory.push(plan.keyIds.cpu);
    if (plan.keyIds.gpu) state.excludeHistory.push(plan.keyIds.gpu);
    renderPlan(plan);
    showPage('result');
    loadPrices(plan, false);
  } catch (e) {
    showPage('form');
    showError('网络异常，请重试');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// ---------- 渲染 ----------
function renderPlan(plan) {
  $('#result-usage').textContent = `${plan.usageLabel}配置 · 预算 ¥${plan.budget}`;
  $('#result-total').textContent = plan.total;
  $('#result-budget').textContent = plan.budget;
  $('#result-remaining').textContent = plan.remaining > 0 ? `还剩 ¥${plan.remaining}` : '预算刚好用满';
  $('#result-summary').textContent = plan.summary;
  $('#budget-bar-fill').style.width = Math.min(100, (plan.total / plan.budget) * 100) + '%';

  $('#parts-list').innerHTML = plan.parts.map(p => `
    <div class="part-card" data-part="${p.id}">
      <div class="part-head">
        <span class="part-icon">${p.icon}</span>
        <span class="part-cat">${p.categoryLabel}</span>
      </div>
      <div class="part-name">${p.name}</div>
      <div class="part-spec">${p.spec}</div>
      <div class="part-price-row">
        <div class="part-price">
          <small>¥</small><span class="price-num skeleton">${p.refPrice}</span><span class="price-badge-slot"></span>
        </div>
        <div class="buy-links"></div>
      </div>
    </div>`).join('');
}

async function loadPrices(plan, force) {
  const statusEl = $('#price-status');
  statusEl.className = 'price-status';
  statusEl.textContent = '正在拉取京东 / 淘宝 / 拼多多最低价…';
  const ids = plan.parts.map(p => p.id).join(',');

  try {
    const res = await fetch(`/api/prices?ids=${ids}${force ? '&t=' + Date.now() : ''}`);
    const data = await res.json();
    let liveCount = 0;
    let total = 0;

    for (const q of data.prices) {
      const card = document.querySelector(`.part-card[data-part="${q.partId}"]`);
      if (!card) continue;
      total += q.price;
      if (q.live) liveCount++;

      const numEl = card.querySelector('.price-num');
      numEl.textContent = q.price;
      numEl.classList.remove('skeleton');

      card.querySelector('.price-badge-slot').innerHTML = q.live
        ? `<span class="price-badge live">${PLATFORM_NAMES[q.platform]}实时最低</span>`
        : `<span class="price-badge ref">参考价</span>`;

      card.querySelector('.buy-links').innerHTML = `
        <a class="buy-link jd" href="${q.links.jd}" target="_blank" rel="noopener">京东</a>
        <a class="buy-link tb" href="${q.links.taobao}" target="_blank" rel="noopener">淘宝</a>
        <a class="buy-link pdd" href="${q.links.pdd}" target="_blank" rel="noopener">拼多多</a>`;
    }

    $('#result-total').textContent = Math.round(total);
    const remaining = plan.budget - total;
    $('#result-remaining').textContent = remaining > 0 ? `还剩 ¥${Math.round(remaining)}` : '预算刚好用满';
    $('#budget-bar-fill').style.width = Math.min(100, (total / plan.budget) * 100) + '%';

    if (liveCount > 0) {
      statusEl.className = 'price-status live';
      statusEl.textContent = `✓ 已获取 ${liveCount}/${data.prices.length} 件实时最低价，其余为参考价 · 点击平台按钮可直达比价`;
    } else {
      statusEl.textContent = '暂未获取到实时报价，以下为参考价 · 点击平台按钮可直达比价';
    }
  } catch (e) {
    statusEl.textContent = '比价服务暂不可用，显示参考价';
    document.querySelectorAll('.price-num').forEach(el => el.classList.remove('skeleton'));
  }
}
