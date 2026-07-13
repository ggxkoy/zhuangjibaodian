// 老板娘对话 —— 小程序主界面：配置需求、出方案、追问全部在对话流里完成。
// 路由优先级：换一套 > 本地意图解析（预算+用途直接出方案，无需 AI）> AI 解析/闲聊 > 引导话术。
// 消息类型：text（气泡）| plan（配置单卡片，点开进明细页）| chips（快捷选项）。

const { getRecommend } = require('../../utils/api');
const { parseRequirement, reviewBuild, bossChat } = require('../../utils/ai');
const { parseIntent, USAGE_LABEL } = require('../../utils/intent');

const GREETING = '来啦！想配台什么样的机子？预算多少、干啥用，一句话告诉姐～比如「12000 玩3A」';
const START_CHIPS = ['6000 玩网游', '12000 玩3A大作', '8000 剪辑生产力', '4000 日常办公', '📋 表单模式'];

let seq = 0;

Page({
  data: { messages: [], input: '', pending: false, scrollInto: '' },

  onLoad() {
    const app = getApp();
    if (!app.globalData.chatMsgs) {
      app.globalData.chatMsgs = [];
      app.globalData.chatHistory = [];
      this.bot(GREETING);
      this.chips(START_CHIPS);
    }
    this.sync();
  },

  // ---------- 消息流 ----------
  push(msg) {
    getApp().globalData.chatMsgs.push({ id: 'm' + (seq++) + '_' + Date.now(), ...msg });
    this.sync();
  },
  sync() {
    const msgs = getApp().globalData.chatMsgs;
    this.setData({ messages: msgs, scrollInto: msgs.length ? msgs[msgs.length - 1].id : '' });
  },
  bot(content) {
    this.push({ role: 'assistant', type: 'text', content });
    getApp().globalData.chatHistory.push({ role: 'assistant', content });
  },
  user(content) {
    this.push({ role: 'user', type: 'text', content });
    getApp().globalData.chatHistory.push({ role: 'user', content });
  },
  chips(list) { this.push({ role: 'assistant', type: 'chips', chips: list }); },

  planCard(plan) {
    const keyParts = plan.parts
      .filter(p => ['cpu', 'gpu', 'ram'].includes(p.category))
      .map(p => ({ id: p.id, icon: p.icon, name: p.name }));
    this.push({ role: 'assistant', type: 'plan', plan, keyParts });
    // 让 AI 上下文也知道这套方案出过
    getApp().globalData.chatHistory.push({
      role: 'assistant',
      content: `（已给顾客生成${plan.usageLabel}配置：预算¥${plan.budget}，合计¥${plan.total}）`
    });
  },

  // ---------- 输入 ----------
  onInput(e) { this.setData({ input: e.detail.value }); },
  onChip(e) {
    const t = e.currentTarget.dataset.t;
    if (t === '📋 表单模式') return wx.navigateTo({ url: '/pages/index/index' });
    this.handle(t);
  },
  onSend() {
    const t = this.data.input.trim();
    if (!t) return;
    this.setData({ input: '' });
    this.handle(t);
  },

  // ---------- 路由 ----------
  async handle(text) {
    if (this.data.pending) return;
    this.user(text);
    const app = getApp();
    const aiOn = !!app.globalData.config.deepseek;
    this.setData({ pending: true });
    try {
      // 1. 换一套
      if (/^(换一套|再换|换个|再来一套|不满意)/.test(text) && app.globalData.plan) {
        return await this.regen();
      }
      if (/^(完整配置单|看明细|配置单)$/.test(text) && app.globalData.plan) {
        return wx.navigateTo({ url: '/pages/result/result' });
      }
      // 2. 本地意图
      const it = parseIntent(text);
      if (it.budget && it.usage) return await this.makePlan(it.budget, it.usage, '');
      if (it.budget) {
        this.pendingBudget = it.budget;
        this.bot(`预算 ¥${it.budget} 姐记下了，主要拿来干啥？`);
        return this.chips(['玩游戏', '剪辑/编程生产力', '日常办公']);
      }
      if (it.usage && this.pendingBudget) {
        const b = this.pendingBudget;
        this.pendingBudget = null;
        return await this.makePlan(b, it.usage, '');
      }
      // 3. AI 路径：有方案在手 → 当追问闲聊；像配机需求 → AI 解析
      if (aiOn) {
        if (!app.globalData.plan && /\d{4,}/.test(text) && /(配|装|套|预算|主机|电脑)/.test(text)) {
          const p = await parseRequirement(text);
          app.globalData.aiNote = p.note || '';
          return await this.makePlan(p.budget, p.usage, p.note);
        }
        const reply = await bossChat(app.globalData.chatHistory, app.globalData.plan);
        return this.bot(reply);
      }
      // 4. 无 AI 的引导
      this.bot('姐没太听懂😅 一句话告诉我预算和用途就行，比如「8000 打游戏」「1.5万 剪辑」');
      this.chips(START_CHIPS.slice(0, 4));
    } catch (e) {
      this.bot('哎呀出岔子了：' + e.message);
    } finally {
      this.setData({ pending: false });
      this.sync();
    }
  },

  // ---------- 出方案 ----------
  async makePlan(budget, usage, note) {
    const app = getApp();
    const plan = await getRecommend(budget, usage);
    app.globalData.plan = plan;
    app.globalData.excludeHistory = [plan.keyIds.cpu, plan.keyIds.gpu].filter(Boolean);
    const saved = plan.budget - plan.total;
    this.bot(`${budget} 块的${USAGE_LABEL[usage]}机是吧？姐给你配好了：合计 ¥${plan.total}` +
      (saved > 0 ? `，还给你留了 ¥${saved} 余量` : '，预算用得刚刚好') +
      `。${plan.summary}`);
    this.planCard(plan);
    this.chips(['换一套', '完整配置单', '内存现在能买吗']);
    if (app.globalData.config.deepseek) {
      reviewBuild(plan, note || app.globalData.aiNote)
        .then(advice => { this.bot('姐再多说两句：\n' + advice); })
        .catch(() => {});
    }
  },

  async regen() {
    const app = getApp();
    const plan = app.globalData.plan;
    try {
      const next = await getRecommend(plan.budget, plan.usage, app.globalData.excludeHistory);
      app.globalData.plan = next;
      [next.keyIds.cpu, next.keyIds.gpu].filter(Boolean)
        .forEach(id => app.globalData.excludeHistory.push(id));
      this.bot('成，换个搭配给你：');
      this.planCard(next);
      this.chips(['换一套', '完整配置单']);
    } catch (e) {
      app.globalData.excludeHistory = [];
      this.bot('好搭配都让你看遍啦，姐从头再给你配一套：');
      await this.makePlan(plan.budget, plan.usage, '');
    }
  },

  onOpenPlan(e) {
    const idx = e.currentTarget.dataset.idx;
    const msg = getApp().globalData.chatMsgs[idx];
    if (msg && msg.plan) getApp().globalData.plan = msg.plan;
    wx.navigateTo({ url: '/pages/result/result' });
  }
});
