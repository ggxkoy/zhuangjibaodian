// 装机宝典小程序入口 —— 双模式：
//
// mode: 'cloud'（推荐，纯小程序生态）
//   微信云开发承载一切：云函数 zhuangji 出方案/比价，老板娘走云开发内置
//   DeepSeek（wx.cloud.extend.AI）。免服务器、免备案域名、免 API key。
//   使用前：开发者工具开通云开发 → 上传部署 cloudfunctions/zhuangji →
//   把下面 cloudEnv 填成你的环境 ID（留空则用默认环境）。
//
// mode: 'server'（自建后端）
//   apiBase 指向 node server.js 的地址；本地联调用 127.0.0.1，
//   上线需已备案的 HTTPS 域名并配置 request 合法域名。
//   所有密钥只在服务端，小程序端零凭据。
App({
  globalData: {
    mode: 'cloud',
    cloudEnv: '',
    apiBase: 'http://127.0.0.1:3000',
    config: { deepseek: false, platforms: {} },
    plan: null,
    aiNote: '',
    excludeHistory: [],
    chatHistory: null,
    character: null // 当前店主角色，onLaunch 从本地存储恢复
  },
  onLaunch() {
    this.globalData.character = require('./utils/characters').loadCharacter();
    if (this.globalData.mode === 'cloud') {
      wx.cloud.init({ env: this.globalData.cloudEnv || undefined });
    }
    const app = this;
    require('./utils/api').getConfig()
      .then(cfg => { app.globalData.config = cfg; })
      .catch(() => {});
  }
});
