// 本地意图解析（无 AI 时的兜底，有 AI 时的快路径）：
// 从口语里抽预算和用途，抽不出就交给 AI 或提示用户。
// 只做保守匹配——预算数字必须有语境（用途词/预算词/纯数字消息），
// 避免把“5070Ti 怎么样”里的型号数字误认成预算。

const USAGE_LABEL = { gaming: '游戏', productivity: '生产力', office: '办公' };

function parseIntent(text) {
  const t = text.toLowerCase().replace(/[,，、]/g, ' ');

  let usage = null;
  if (/(生产力|剪辑|渲染|建模|编程|开发|写代码|直播|修图|设计|ue\d?|blender|跑ai)/.test(t)) usage = 'productivity';
  else if (/(游戏|打游|网游|电竞|3a|吃鸡|steam|fps|moba|lol|csgo|黑猴|大作)/.test(t)) usage = 'gaming';
  else if (/(办公|文档|上网|网课|家用|影音|轻度)/.test(t)) usage = 'office';

  let budget = null;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(万|w|k|千)?/);
  if (m) {
    // 型号数字防误判：数字后紧跟字母（5070ti / 14600kf / 9800x3d）不当预算
    const after = t.charAt(m.index + m[0].length);
    if (!/[a-z]/.test(after)) {
      let v = parseFloat(m[1]);
      if (m[2] === '万' || m[2] === 'w') v *= 10000;
      else if (m[2] === '千' || m[2] === 'k') v *= 1000;
      const pureNumber = /^\d+(\.\d+)?[万w千k]?$/.test(t.trim());
      const hasContext = usage !== null || /(预算|块|元|左右|以内|上下|配|装机|一套|主机|电脑)/.test(t);
      if (v >= 1000 && v <= 500000 && (pureNumber || hasContext)) budget = Math.round(v);
    }
  }
  return { budget, usage };
}

module.exports = { parseIntent, USAGE_LABEL };
