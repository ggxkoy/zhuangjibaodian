const { getRecommend, getPrices } = require('../../utils/api');
const { reviewBuild } = require('../../utils/ai');

const PLATFORM_NAMES = { jd: '京东', taobao: '淘宝', pdd: '拼多多', ref: '参考价' };

Page({
  data: {
    plan: null,
    parts: [],
    total: 0,
    remainText: '',
    percent: 0,
    priceStatus: '正在拉取各平台最低价…',
    priceStatusLevel: '',
    aiEnabled: false,
    advice: '',
    regenLoading: false
  },

  onLoad() {
    const app = getApp();
    this.setData({ aiEnabled: !!app.globalData.config.deepseek });
    this.renderPlan(app.globalData.plan);
  },

  renderPlan(plan) {
    if (!plan) return wx.navigateBack();
    const parts = plan.parts.map(p => ({
      ...p, price: p.refPrice, badge: '', badgeLevel: '', verdict: null, links: null
    }));
    this.setData({
      plan, parts,
      total: plan.total,
      remainText: plan.remaining > 0 ? `还剩 ¥${plan.remaining}` : '预算刚好用满',
      percent: Math.min(100, Math.round((plan.total / plan.budget) * 100)),
      advice: ''
    });
    this.loadPrices(plan);
    this.loadReview(plan);
  },

  async loadPrices(plan) {
    this.setData({ priceStatus: '正在拉取京东 / 淘宝 / 拼多多最低价…', priceStatusLevel: '' });
    try {
      const data = await getPrices(plan.parts.map(p => p.id));
      let live = 0, total = 0, high = 0, deal = 0;
      const parts = this.data.parts.map(p => {
        const q = data.prices.find(x => x.partId === p.id);
        if (!q) return p;
        total += q.price;
        if (q.live) live++;
        const v = q.history && q.history.verdict;
        if (v && v.level === 'high') high++;
        if (v && (v.level === 'low' || v.level === 'good')) deal++;
        return {
          ...p,
          price: q.price,
          badge: q.live ? PLATFORM_NAMES[q.platform] + '实时最低' : '参考价',
          badgeLevel: q.live ? 'live' : 'ref',
          verdict: v && v.label ? v : null,
          hist: q.history ? `年内最低 ¥${q.history.min} · 均价 ¥${q.history.avg}` : '',
          links: q.links
        };
      });
      let status, level;
      if (live > 0) { status = `✓ 已获取 ${live}/${data.prices.length} 件实时最低价`; level = 'live'; }
      else { status = '⚠️ 未接入实时价格源，以下为参考价，误差可能较大，点击平台按钮复制链接核实'; level = 'warn'; }
      const bits = [];
      if (deal) bits.push(`${deal} 件好价`);
      if (high) bits.push(`${high} 件历史高位（急用再买）`);
      if (bits.length) status += ' · ' + bits.join('，');
      this.setData({
        parts, total: Math.round(total),
        remainText: this.data.plan.budget - total > 0 ? `还剩 ¥${Math.round(this.data.plan.budget - total)}` : '预算刚好用满',
        percent: Math.min(100, Math.round((total / this.data.plan.budget) * 100)),
        priceStatus: status, priceStatusLevel: level
      });
    } catch (e) {
      this.setData({ priceStatus: '比价服务暂不可用，显示参考价', priceStatusLevel: 'warn' });
    }
  },

  async loadReview(plan) {
    if (!this.data.aiEnabled) return;
    this.setData({ advice: '老板娘正在看你的配置单…' });
    try {
      const advice = await reviewBuild(plan, getApp().globalData.aiNote);
      this.setData({ advice });
    } catch (e) {
      this.setData({ advice: '点评暂不可用：' + e.message });
    }
  },

  // 小程序不能直接打开外部网页：复制比价链接到剪贴板
  onCopyLink(e) {
    const { url, name } = e.currentTarget.dataset;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: name + '链接已复制', icon: 'none' })
    });
  },

  async onRegen() {
    const app = getApp();
    const plan = this.data.plan;
    this.setData({ regenLoading: true });
    try {
      const next = await getRecommend(plan.budget, plan.usage, app.globalData.excludeHistory);
      app.globalData.plan = next;
      [next.keyIds.cpu, next.keyIds.gpu].filter(Boolean)
        .forEach(id => app.globalData.excludeHistory.push(id));
      this.renderPlan(next);
    } catch (e) {
      app.globalData.excludeHistory = []; // 候选耗尽则重置
      wx.showToast({ title: e.message, icon: 'none' });
    } finally {
      this.setData({ regenLoading: false });
    }
  },

  onChat() {
    const pages = getCurrentPages();
    const prev = pages[pages.length - 2];
    if (prev && prev.route.includes('chat')) return wx.navigateBack();
    wx.navigateTo({ url: '/pages/chat/chat' });
  },

  onBack() { wx.navigateBack(); }
});
