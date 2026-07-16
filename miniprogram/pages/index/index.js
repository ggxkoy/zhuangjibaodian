const { getRecommend } = require('../../utils/api');
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
    loading: false,
    errMsg: '',
    bannerBottomUnit: ''
  },

  onShow() {
    this.setData({ bannerBottomUnit: bannerBottomUnit() });
  },

  onBudget(e) { this.setData({ budget: e.detail.value, errMsg: '' }); },
  onChip(e) { this.setData({ budget: e.currentTarget.dataset.v, errMsg: '' }); },
  onUsage(e) { this.setData({ usage: e.currentTarget.dataset.usage }); },

  async onGenerate() {
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
