// 装机宝典个人主体审核版入口。
//
// mode: 'cloud'（推荐，纯小程序生态）
//   微信云开发承载规则推荐与价格查询，仅提供固定资料与确定性计算。
//   使用前：开发者工具开通云开发 → 上传部署 cloudfunctions/zhuangji →
//   把下面 cloudEnv 填成你的环境 ID（留空则用默认环境）。
//
// mode: 'server'（自建后端）
//   apiBase 指向 node server.js 的地址；本地联调用 127.0.0.1，
//   上线需已备案的 HTTPS 域名并配置 request 合法域名。
//   电商平台凭据只在服务端，小程序端零凭据。
App({
  globalData: {
    mode: 'cloud',
    cloudEnv: 'cloud1-d2gf7m4m8eebee14e',
    apiBase: 'http://127.0.0.1:3000',
    plan: null,
    excludeHistory: []
  },
  onLaunch() {
    if (this.globalData.mode === 'cloud') {
      wx.cloud.init({ env: this.globalData.cloudEnv || undefined });
    }
  }
});
