// 数据接口双模式封装：
//   mode 'server' —— wx.request 调自建 Node 后端（app.js 里的 apiBase）
//   mode 'cloud'  —— wx.cloud.callFunction 调云函数 zhuangji（免服务器免备案）
// 页面只用下面的 getConfig/getRecommend/getPrices，不感知模式差异。

function appData(app) {
  const current = app || (typeof getApp === 'function' ? getApp() : null);
  return current && current.globalData ? current.globalData : {};
}

function mode(app) { return appData(app).mode || 'server'; }

function serverRequest(path, { method = 'GET', data } = {}, app) {
  const base = appData(app).apiBase || '';
  return new Promise((resolve, reject) => {
    wx.request({
      url: base + path,
      method,
      data,
      timeout: 40000,
      success(res) {
        if (res.data && res.data.error) return reject(new Error(res.data.error));
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
        resolve(res.data);
      },
      fail(err) { reject(new Error(err.errMsg || '网络错误')); }
    });
  });
}

function cloudCall(action, data = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'zhuangji',
      data: { action, ...data },
      success(r) {
        const d = r.result || {};
        if (d.ok === false) return reject(new Error(d.error || '云函数返回错误'));
        resolve(d);
      },
      fail(e) { reject(new Error(e.errMsg || '云函数调用失败')); }
    });
  });
}

function getConfig(app) {
  return mode(app) === 'cloud' ? cloudCall('config') : serverRequest('/api/config', {}, app);
}

async function getRecommend(budget, usage, exclude = []) {
  if (mode() === 'cloud') return (await cloudCall('recommend', { budget, usage, exclude })).plan;
  return serverRequest(`/api/recommend?budget=${budget}&usage=${usage}&exclude=${exclude.join(',')}`);
}

function getPrices(ids) {
  return mode() === 'cloud'
    ? cloudCall('prices', { ids })
    : serverRequest('/api/prices?ids=' + ids.join(','));
}

module.exports = { mode, serverRequest, cloudCall, getConfig, getRecommend, getPrices };
