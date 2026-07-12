// 统一请求封装：GET 带 query，POST 发 JSON；服务端 error 字段转为 reject
function request(path, { method = 'GET', data } = {}) {
  const base = getApp().globalData.apiBase;
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

module.exports = { request };
