// 广告位配置与封装（流量主）
//
// 开通流量主（累计UV≥1000后在 mp 后台申请）→ 创建对应类型广告位 → 把 adUnitId 填进
// AD_UNITS → 发版。任何一项留空即该广告完全隐身，功能回到免费无广告形态：
//   banner        明细页底部横幅
//   interstitial  离开明细页时的插屏（每次启动最多弹 1 次）
//   rewarded      激励视频（解锁预设角色皮肤 / 第3次起的“换一套”）
//
// 设计原则：广告失败绝不拦用户——激励视频拉取失败直接放行视为已解锁。

const AD_UNITS = {
  banner: '',
  interstitial: '',
  rewarded: ''
};

function bannerUnit() { return AD_UNITS.banner; }
function rewardedEnabled() { return !!AD_UNITS.rewarded && !!wx.createRewardedVideoAd; }

let rewardedAd = null;
// 播放激励视频；resolve(true)=看完发奖 / false=中途退出；未配置或拉取失败=直接放行
function showRewarded() {
  return new Promise(resolve => {
    if (!rewardedEnabled()) return resolve(true);
    if (!rewardedAd) rewardedAd = wx.createRewardedVideoAd({ adUnitId: AD_UNITS.rewarded });
    const ad = rewardedAd;
    const onClose = res => {
      ad.offClose(onClose);
      resolve(!!(res && (res.isEnded || res.isEnded === undefined)));
    };
    ad.onClose(onClose);
    ad.show().catch(() =>
      ad.load().then(() => ad.show()).catch(() => { ad.offClose(onClose); resolve(true); })
    );
  });
}

let interstitialShown = false;
let interstitialAd = null;
function maybeShowInterstitial() {
  if (!AD_UNITS.interstitial || interstitialShown || !wx.createInterstitialAd) return;
  interstitialShown = true; // 频控：每次启动最多一次，别烦用户
  try {
    if (!interstitialAd) interstitialAd = wx.createInterstitialAd({ adUnitId: AD_UNITS.interstitial });
    interstitialAd.show().catch(() => {});
  } catch (e) { /* 忽略 */ }
}

module.exports = { AD_UNITS, bannerUnit, rewardedEnabled, showRewarded, maybeShowInterstitial };
