// 预设店主角色（与 data/characters.json 保持同步，改动请两边一起改）。
// 自定义角色在此基础上生成：{ id:'custom', name, style, sprite:'boss', customSprite? }
const PRESETS = [
  {
    id: 'jie', name: '老板娘', title: '姐系店长（默认）', sprite: 'boss',
    style: '热情爽快、特别懂行、实在不忽悠，偶尔用电脑城行话和生活化比喻，自称“姐”',
    greeting: '来啦！想配台什么样的机子？预算多少、干啥用，一句话告诉姐～比如「12000 玩3A」'
  },
  {
    id: 'yuanqi', name: '小雫', title: '元气学妹', sprite: 'char-yuanqi', premium: true,
    style: '元气满满的电脑社学妹，语气活泼爱用感叹号，偶尔冒二次元梗，但一讲到参数立刻认真起来',
    greeting: '欢迎光临装机宝典！！想配什么机子呀？预算和用途告诉我嘛，比如「8000 打游戏」！'
  },
  {
    id: 'yujie', name: '绫姐', title: '毒舌御姐', sprite: 'char-yujie', premium: true,
    style: '毒舌但极其靠谱的御姐，说话简短带刺，爱吐槽杂牌和智商税，推荐一针见血，刀子嘴豆腐心',
    greeting: '站着干嘛？预算、用途，报来。……放心，预算再少我也给你配得体面。'
  }
];

// premium 角色解锁记录（激励视频看完解锁，永久保存；未配置广告位时全员免费）
const UNLOCK_KEY = 'zjbd-unlocked';
function isUnlocked(id) {
  try { return (wx.getStorageSync(UNLOCK_KEY) || []).indexOf(id) >= 0; } catch (e) { return false; }
}
function unlock(id) {
  try {
    const list = wx.getStorageSync(UNLOCK_KEY) || [];
    if (list.indexOf(id) < 0) { list.push(id); wx.setStorageSync(UNLOCK_KEY, list); }
  } catch (e) { /* 忽略 */ }
}

const STORAGE_KEY = 'zjbd-character';

function loadCharacter() {
  try {
    const saved = wx.getStorageSync(STORAGE_KEY);
    if (saved && saved.name) return saved;
  } catch (e) { /* 忽略 */ }
  return PRESETS[0];
}

function saveCharacter(ch) {
  try { wx.setStorageSync(STORAGE_KEY, ch); } catch (e) { /* 忽略 */ }
}

module.exports = { PRESETS, loadCharacter, saveCharacter, isUnlocked, unlock };
