// 老板娘 galgame 主界面：
// 立绘舞台 + 底部对话框 + 打字机逐字 + 点击画面推进 + 居中选项肢 + 📜回想（backlog）。
// 业务路由与 chat-first 版一致：换一套 > 本地意图 > AI 解析/闲聊 > 引导。
// 立绘素材：miniprogram/assets/boss.png（竖构图，背景合入图内）；缺图自动降级为渐变场景。

const { getRecommend } = require('../../utils/api');
const { parseRequirement, reviewBuild, bossChat } = require('../../utils/ai');
const { parseIntent, USAGE_LABEL } = require('../../utils/intent');

const GREETING = '来啦！想配台什么样的机子？预算多少、干啥用，一句话告诉姐～比如「12000 玩3A」';
const START_CHIPS = ['6000 玩网游', '12000 玩3A大作', '8000 剪辑生产力', '4000 日常办公', '📋 表单模式'];

Page({
  data: {
    hasSprite: true,
    speaker: '老板娘', shownText: '', typing: false, hasMore: false, waiting: false,
    choices: [], planMsg: null,
    inputOpen: false, input: '',
    backlogOpen: false, backlog: [], scrollInto: ''
  },

  onLoad() {
    const app = getApp();
    if (!app.globalData.chatMsgs) { app.globalData.chatMsgs = []; app.globalData.chatHistory = []; }
    this.queue = [];
    this.full = '';
    this.idle = true;   // 舞台上没有正在播/待推进的内容
    this.busy = false;  // 请求进行中
    if (app.globalData.chatMsgs.length === 0) {
      this.say(GREETING);
      this.offer(START_CHIPS);
    } else {
      this.restore();
    }
  },
  onUnload() { this.clearTimer(); },

  restore() { // 从明细页返回时恢复最后画面
    const msgs = getApp().globalData.chatMsgs;
    const lastText = [...msgs].reverse().find(m => m.type === 'text');
    const lastPlan = [...msgs].reverse().find(m => m.type === 'plan');
    const last = msgs[msgs.length - 1];
    this.idle = false;
    this.setData({
      speaker: lastText ? (lastText.role === 'user' ? '我' : '老板娘') : '老板娘',
      shownText: lastText ? lastText.content : GREETING,
      planMsg: lastPlan || null,
      choices: last && last.type === 'chips' ? last.chips : []
    });
  },

  clearTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },

  // ---------- 台词队列（galgame 表现层） ----------
  say(text) {
    getApp().globalData.chatMsgs.push({ type: 'text', role: 'assistant', content: text });
    getApp().globalData.chatHistory.push({ role: 'assistant', content: text });
    this.enqueue({ kind: 'text', speaker: '老板娘', text });
  },
  offer(chips) {
    getApp().globalData.chatMsgs.push({ type: 'chips', chips });
    this.enqueue({ kind: 'chips', chips });
  },
  showPlanCard(plan) {
    const keyParts = plan.parts
      .filter(p => ['cpu', 'gpu', 'ram'].includes(p.category))
      .map(p => ({ id: p.id, icon: p.icon, name: p.name }));
    getApp().globalData.chatMsgs.push({ type: 'plan', plan, keyParts });
    getApp().globalData.chatHistory.push({
      role: 'assistant',
      content: `（已给顾客生成${plan.usageLabel}配置：预算¥${plan.budget}，合计¥${plan.total}）`
    });
    this.enqueue({ kind: 'plan', plan, keyParts });
  },

  enqueue(item) {
    this.queue.push(item);
    if (this.idle || this.data.waiting) {
      this.setData({ waiting: false });
      this.step();
    } else if (!this.data.typing) {
      this.setData({ hasMore: true });
    }
  },
  step() {
    const item = this.queue.shift();
    if (!item) { this.idle = true; this.setData({ hasMore: false }); return; }
    this.idle = false;
    if (item.kind === 'plan') { this.setData({ planMsg: item }); return this.step(); }
    if (item.kind === 'chips') { this.setData({ choices: item.chips }); return this.step(); }
    // 文字台词：打字机
    this.full = item.text;
    this.setData({ speaker: item.speaker, shownText: '', typing: true, hasMore: false });
    this.clearTimer();
    this.timer = setInterval(() => {
      const n = this.data.shownText.length + 2;
      if (n >= this.full.length) {
        this.clearTimer();
        this.setData({ shownText: this.full, typing: false, hasMore: this.queue.length > 0 });
      } else {
        this.setData({ shownText: this.full.slice(0, n) });
      }
    }, 40);
  },
  onAdvance() { // 点击画面：跳过打字 / 推进下一句
    if (this.data.backlogOpen || this.data.inputOpen) return;
    if (this.data.typing) {
      this.clearTimer();
      this.setData({ shownText: this.full, typing: false, hasMore: this.queue.length > 0 });
      return;
    }
    if (this.queue.length) this.step();
  },

  onSpriteErr() { this.setData({ hasSprite: false }); },

  // ---------- 输入与选项 ----------
  onToggleInput() { this.setData({ inputOpen: !this.data.inputOpen }); },
  onInput(e) { this.setData({ input: e.detail.value }); },
  onSend() {
    const t = this.data.input.trim();
    if (!t) return;
    this.setData({ input: '', inputOpen: false });
    this.handle(t);
  },
  onChoice(e) {
    const t = e.currentTarget.dataset.t;
    if (t === '📋 表单模式') return wx.navigateTo({ url: '/pages/index/index' });
    this.handle(t);
  },

  onOpenBacklog() {
    const backlog = getApp().globalData.chatMsgs
      .filter(m => m.type === 'text')
      .map((m, i) => ({ id: 'b' + i, role: m.role, content: m.content }));
    this.setData({ backlogOpen: true, backlog, scrollInto: backlog.length ? backlog[backlog.length - 1].id : '' });
  },
  onCloseBacklog() { this.setData({ backlogOpen: false }); },

  onOpenPlan() {
    if (this.data.planMsg) getApp().globalData.plan = this.data.planMsg.plan;
    wx.navigateTo({ url: '/pages/result/result' });
  },

  // ---------- 业务路由 ----------
  async handle(text) {
    if (this.busy) return;
    this.busy = true;
    const app = getApp();
    // 玩家台词直接上屏（不走打字机），随后进入等待
    getApp().globalData.chatMsgs.push({ type: 'text', role: 'user', content: text });
    app.globalData.chatHistory.push({ role: 'user', content: text });
    this.clearTimer();
    this.queue = [];
    this.idle = false;
    this.setData({ speaker: '我', shownText: text, typing: false, choices: [], hasMore: false, waiting: true });

    const aiOn = !!app.globalData.config.deepseek;
    try {
      if (/^(换一套|再换|换个|再来一套|不满意)/.test(text) && app.globalData.plan) {
        return await this.regen();
      }
      if (/^(完整配置单|看明细|配置单)$/.test(text) && app.globalData.plan) {
        this.setData({ waiting: false });
        return wx.navigateTo({ url: '/pages/result/result' });
      }
      const it = parseIntent(text);
      if (it.budget && it.usage) return await this.makePlan(it.budget, it.usage, '');
      if (it.budget) {
        this.pendingBudget = it.budget;
        this.say(`预算 ¥${it.budget} 姐记下了，主要拿来干啥？`);
        return this.offer(['玩游戏', '剪辑/编程生产力', '日常办公']);
      }
      if (it.usage && this.pendingBudget) {
        const b = this.pendingBudget;
        this.pendingBudget = null;
        return await this.makePlan(b, it.usage, '');
      }
      if (aiOn) {
        if (!app.globalData.plan && /\d{4,}/.test(text) && /(配|装|套|预算|主机|电脑)/.test(text)) {
          const p = await parseRequirement(text);
          app.globalData.aiNote = p.note || '';
          return await this.makePlan(p.budget, p.usage, p.note);
        }
        const reply = await bossChat(app.globalData.chatHistory, app.globalData.plan);
        return this.say(reply);
      }
      this.say('姐没太听懂😅 一句话告诉我预算和用途就行，比如「8000 打游戏」「1.5万 剪辑」');
      this.offer(START_CHIPS.slice(0, 4));
    } catch (e) {
      this.say('哎呀出岔子了：' + e.message);
    } finally {
      this.busy = false;
      if (this.data.waiting) this.setData({ waiting: false });
    }
  },

  async makePlan(budget, usage, note) {
    const app = getApp();
    const plan = await getRecommend(budget, usage);
    app.globalData.plan = plan;
    app.globalData.excludeHistory = [plan.keyIds.cpu, plan.keyIds.gpu].filter(Boolean);
    const saved = plan.budget - plan.total;
    this.say(`${budget} 块的${USAGE_LABEL[usage]}机是吧？姐给你配好了：合计 ¥${plan.total}` +
      (saved > 0 ? `，还给你留了 ¥${saved} 余量` : '，预算用得刚刚好') +
      `。${plan.summary}`);
    this.showPlanCard(plan);
    this.offer(['换一套', '完整配置单', '内存现在能买吗']);
    if (app.globalData.config.deepseek) {
      reviewBuild(plan, note || app.globalData.aiNote)
        .then(advice => { this.say('姐再多说两句：\n' + advice); })
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
      this.say('成，换个搭配给你：');
      this.showPlanCard(next);
      this.offer(['换一套', '完整配置单']);
    } catch (e) {
      app.globalData.excludeHistory = [];
      this.say('好搭配都让你看遍啦，姐从头再给你配一套：');
      await this.makePlan(plan.budget, plan.usage, '');
    }
  }
});
