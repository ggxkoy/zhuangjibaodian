// 装机宝典小程序入口
// apiBase：开发者工具本地联调用 127.0.0.1（project.config.json 已关闭域名校验）；
// 真机预览改为电脑的局域网 IP；上线改为已备案的公网 HTTPS 域名并在小程序后台配置 request 合法域名。
// 所有密钥（DeepSeek/电商联盟）只存在于服务端，小程序端零凭据。
App({
  globalData: {
    apiBase: 'http://127.0.0.1:3000',
    config: { deepseek: false, platforms: {} },
    plan: null,
    aiNote: '',
    excludeHistory: []
  },
  onLaunch() {
    const app = this;
    wx.request({
      url: this.globalData.apiBase + '/api/config',
      success(res) { if (res.data && !res.data.error) app.globalData.config = res.data; }
    });
  }
});
