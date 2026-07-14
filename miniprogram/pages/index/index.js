const { getRecommend } = require('../../utils/api');
const { parseRequirement } = require('../../utils/ai');
const { bannerBottomUnit } = require('../../utils/ads');

const USAGES = [
  { key: 'gaming', icon: '🎮', name: '游戏', desc: '3A大作 / 电竞网游' },
  { key: 'productivity', icon: '🛠️', name: '生产力', desc: '剪辑 / 编程 / 渲染' },
  { key: 'office', icon: '📄', name: '办公', desc: '文档 / 网页 / 会议' }
];

Page({
  data: {
    usages: USAGES,
    usage: 'gaming',
    budget: '',
    chips: ['3000', '5000', '8000', '12000', '20000'],
    aiEnabled: false,
    aiText: '',
    aiNote: '',
    loading: false,
    errMsg: '',
    bannerBottomUnit: ''
  },

  onShow() {
    this.setData({
      aiEnabled: !!getApp().globalData.config.deepseek,
      bannerBottomUnit: bannerBottomUnit()
    });
  },

  onChat() {
    const pages = getCurrentPages();
    const prev = pages[pages.length - 2];
    if (prev && prev.route.includes('chat')) return wx.navigateBack();
    wx.navigateTo({ url: '/pages/chat/chat' });
  },

  onBudget(e) { this.setData({ budget: e.detail.value, errMsg: '' }); },
  onChip(e) { this.setData({ budget: e.currentTarget.dataset.v, errMsg: '' }); },
  onUsage(e) { this.setData({ usage: e.currentTarget.dataset.usage }); },
  onAiText(e) { this.setData({ aiText: e.detail.value }); },

  async onAiParse() {
    const text = this.data.aiText.trim();
    if (!text) return this.setData({ aiNote: '先描述一下你的需求~' });
    this.setData({ loading: true, aiNote: 'AI 解析中…' });
    try {
      const p = await parseRequirement(text);
      const usageName = (USAGES.find(u => u.key === p.usage) || {}).name || p.usage;
      getApp().globalData.aiNote = p.note || '';
      this.setData({
        budget: String(p.budget),
        usage: p.usage,
        aiNote: `✓ 已解析：预算 ¥${p.budget} · ${usageName}${p.note ? ' · ' + p.note : ''}`
      });
      await this.generate();
    } catch (e) {
      this.setData({ aiNote: '解析失败：' + e.message });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onGenerate() {
    getApp().globalData.aiNote = '';
    this.setData({ loading: true });
    try { await this.generate(); } finally { this.setData({ loading: false }); }
  },

  async generate() {
    const budget = parseInt(this.data.budget, 10);
    if (!budget || budget < 1000) return this.setData({ errMsg: '请输入有效预算（至少 1000 元）' });
    this.setData({ errMsg: '' });
    try {
      const plan = await getRecommend(budget, this.data.usage);
      const app = getApp();
      app.globalData.plan = plan;
      app.globalData.excludeHistory = [plan.keyIds.cpu, plan.keyIds.gpu].filter(Boolean);
      wx.navigateTo({ url: '/pages/result/result' });
    } catch (e) {
      this.setData({ errMsg: e.message });
    }
  }
});
