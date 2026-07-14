// 老板娘 galgame 主界面：
// 立绘舞台 + 底部对话框 + 打字机逐字 + 点击画面推进 + 居中选项肢 + 📜回想（backlog）。
// 业务路由与 chat-first 版一致：换一套 > 本地意图 > AI 解析/闲聊 > 引导。
// 立绘素材：miniprogram/assets/boss.jpg（竖构图，背景合入图内，JPG 控制包体）；缺图自动降级为渐变场景。

const { getRecommend, getConfig } = require('../../utils/api');
const { elicit, reviewBuild, bossChat } = require('../../utils/ai');
const { parseIntent, USAGE_LABEL } = require('../../utils/intent');
const { PRESETS, loadCharacter, saveCharacter, isUnlocked, unlock } = require('../../utils/characters');
const { rewardedEnabled, showRewarded, takeSplashUnit } = require('../../utils/ads');

const FREE_REGEN = 2; // 每套需求免费“换一套”次数（激励视频未配置时不限）

const USAGE_ASK = '主要拿来干啥？打游戏、做视频剪辑这类创作，还是日常办公上网？';
const BUDGET_ASK = '预算大概多少？直接说个数就行，8000、1.5万 都可以。';

Page({
  data: {
    hasSprite: true, spriteSrc: '/assets/boss.jpg', mood: 'normal',
    bossName: '老板娘',
    speaker: '老板娘', shownText: '', typing: false, hasMore: false, waiting: false,
    choices: [], planMsg: null,
    inputOpen: false, input: '',
    backlogOpen: false, backlog: [], scrollInto: '',
    panelOpen: false, presets: PRESETS, curId: 'jie', customName: '', customStyle: '', customPicked: false,
    splashUnit: '', splashCount: 5
  },

  onLoad() {
    const app = getApp();
    if (!app.globalData.chatMsgs) { app.globalData.chatMsgs = []; app.globalData.chatHistory = []; }
    if (!app.globalData.character) app.globalData.character = loadCharacter();
    this.queue = [];
    this.full = '';
    this.idle = true;   // 舞台上没有正在播/待推进的内容
    this.busy = false;  // 请求进行中
    this.startSplash();
    this.applyCharacterUI();
    // 启动时的 config 拉取可能失败（云函数刚部署/网络抖动），进对话页再刷一次
    getConfig().then(cfg => { app.globalData.config = cfg; }).catch(() => {});
    if (app.globalData.chatMsgs.length === 0) {
      this.say(this.ch().greeting || '想配台什么机子？预算和用途说说看～');
    } else {
      this.restore();
    }
  },
  onUnload() { this.clearTimer(); this.clearSplashTimer(); },

  // ---------- 开屏广告（未配置广告位时不出现；广告加载失败立即放行） ----------
  startSplash() {
    const unit = takeSplashUnit();
    if (!unit) return;
    this.setData({ splashUnit: unit, splashCount: 5 });
    this.splashTimer = setInterval(() => {
      const n = this.data.splashCount - 1;
      if (n <= 0) return this.onSplashSkip();
      this.setData({ splashCount: n });
    }, 1000);
  },
  clearSplashTimer() { if (this.splashTimer) { clearInterval(this.splashTimer); this.splashTimer = null; } },
  onSplashSkip() {
    this.clearSplashTimer();
    this.setData({ splashUnit: '' });
  },

  // ---------- 店主角色（自定义老板娘） ----------
  ch() { return getApp().globalData.character || PRESETS[0]; },
  applyCharacterUI() {
    const ch = this.ch();
    this.setData({ bossName: ch.name, curId: ch.id || 'custom' });
    this.updateSprite();
  },
  setMood(mood) {
    if (this.data.mood === mood) return;
    this.setData({ mood });
    this.updateSprite();
  },
  updateSprite() {
    const ch = this.ch();
    let src;
    if (ch.customSprite) src = ch.customSprite; // 用户上传的立绘（无表情差分）
    else {
      const base = ch.sprite || 'boss';
      src = `/assets/${base}${this.data.mood !== 'normal' ? '-' + this.data.mood : ''}.jpg`;
    }
    this.setData({ spriteSrc: src, hasSprite: true });
  },
  onSpriteErr() {
    // 降级链：表情差分 → 该角色常态图 → 默认 boss.jpg → emoji 场景
    const ch = this.ch();
    if (this.data.spriteSrc === '/assets/boss.jpg') return this.setData({ hasSprite: false });
    if (ch.customSprite) { ch.customSprite = ''; saveCharacter(ch); return this.updateSprite(); }
    if (this.data.mood !== 'normal') { this.setData({ mood: 'normal' }); return this.updateSprite(); }
    this.setData({ spriteSrc: '/assets/boss.jpg' });
  },

  onOpenPanel() {
    const ch = this.ch();
    this.setData({
      panelOpen: true,
      // premium 角色带锁标记（激励视频未配置时全员免费）
      presets: PRESETS.map(p => ({ ...p, locked: !!p.premium && rewardedEnabled() && !isUnlocked(p.id) })),
      curId: ch.id || 'custom',
      customName: ch.id === 'custom' ? ch.name : '',
      customStyle: ch.id === 'custom' ? ch.style : '',
      customPicked: !!(ch.id === 'custom' && ch.customSprite)
    });
  },
  onClosePanel() { this.setData({ panelOpen: false }); },
  async onPickPreset(e) {
    const preset = PRESETS.find(p => p.id === e.currentTarget.dataset.id);
    if (!preset) return;
    if (preset.premium && rewardedEnabled() && !isUnlocked(preset.id)) {
      const ok = await new Promise(r => wx.showModal({
        title: '解锁' + preset.name,
        content: '看一个小广告，永久解锁这位店主～',
        confirmText: '看广告', cancelText: '算了',
        success: res => r(res.confirm), fail: () => r(false)
      }));
      if (!ok) return;
      const done = await showRewarded();
      if (!done) return wx.showToast({ title: '广告没看完，下次再来~', icon: 'none' });
      unlock(preset.id);
    }
    this.switchCharacter({ ...preset });
  },
  onCustomName(e) { this.setData({ customName: e.detail.value }); },
  onCustomStyle(e) { this.setData({ customStyle: e.detail.value }); },
  onPickSprite() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'],
      success: res => {
        wx.getFileSystemManager().saveFile({
          tempFilePath: res.tempFiles[0].tempFilePath,
          success: r => { this.tmpSprite = r.savedFilePath; this.setData({ customPicked: true }); },
          fail: () => wx.showToast({ title: '保存图片失败', icon: 'none' })
        });
      }
    });
  },
  onSaveCustom() {
    const name = this.data.customName.trim().slice(0, 12);
    const style = this.data.customStyle.trim().slice(0, 200);
    if (!name || !style) return wx.showToast({ title: '起个名字，再写一句性格~', icon: 'none' });
    const old = this.ch();
    this.switchCharacter({
      id: 'custom', name, style, sprite: 'boss',
      customSprite: this.tmpSprite || (old.id === 'custom' ? old.customSprite : '') || '',
      greeting: `${name}来接待你啦～预算多少、干啥用，说说看？`
    });
  },
  switchCharacter(ch) {
    getApp().globalData.character = ch;
    saveCharacter(ch);
    this.setData({ panelOpen: false, mood: 'normal' });
    this.applyCharacterUI();
    this.say(ch.greeting || `${ch.name}来接待你啦～预算多少、干啥用，说说看？`);
  },

  restore() { // 从明细页返回时恢复最后画面
    const msgs = getApp().globalData.chatMsgs;
    const lastText = [...msgs].reverse().find(m => m.type === 'text');
    const lastPlan = [...msgs].reverse().find(m => m.type === 'plan');
    const last = msgs[msgs.length - 1];
    this.idle = false;
    this.setData({
      speaker: lastText ? (lastText.role === 'user' ? '我' : this.ch().name) : this.ch().name,
      shownText: lastText ? lastText.content : (this.ch().greeting || ''),
      planMsg: lastPlan || null,
      choices: last && last.type === 'chips' ? last.chips : []
    });
  },

  clearTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },

  // ---------- 台词队列（galgame 表现层） ----------
  say(text) {
    getApp().globalData.chatMsgs.push({ type: 'text', role: 'assistant', content: text });
    getApp().globalData.chatHistory.push({ role: 'assistant', content: text });
    this.enqueue({ kind: 'text', speaker: this.ch().name, text });
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
    if (this.data.backlogOpen || this.data.panelOpen) return;
    if (this.data.typing) {
      this.clearTimer();
      this.setData({ shownText: this.full, typing: false, hasMore: this.queue.length > 0 });
      return;
    }
    if (this.queue.length) this.step();
  },

  // 仅阻止遮罩内部点击冒泡，不触发任何业务逻辑。
  onSwallow() {},

  // ---------- 输入与选项 ----------
  onInput(e) { this.setData({ input: e.detail.value }); },
  onSend() {
    const t = this.data.input.trim();
    if (!t) return;
    this.setData({ input: '' });
    this.handle(t);
  },
  onChoice(e) { this.handle(e.currentTarget.dataset.t); },
  onOpenForm() { wx.navigateTo({ url: '/pages/index/index' }); },

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
  // 需求确立完全走对话：AI 在场时由模型自然追问（elicit），
  // 无 AI 时用本地槽位填充 + 自然问句兜底，两条路都不出固定选项。
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
    this.setMood('think');

    const aiOn = !!app.globalData.config.deepseek;
    try {
      if (/^📺/.test(text) && app.globalData.plan) { // 看广告解锁继续换
        const done = await showRewarded();
        if (!done) return this.say('广告没看完哦，看完姐才能给你翻新货～');
        this.regenCount = 0;
        return await this.regen();
      }
      if (/^(换一套|再换|换个|再来一套|不满意)/.test(text) && app.globalData.plan) {
        if (rewardedEnabled() && (this.regenCount || 0) >= FREE_REGEN) {
          this.say('姐都给你翻了' + this.regenCount + '套啦～看个小广告，姐接着给你配？');
          return this.offer(['📺 看广告继续换', '看完整配置单']);
        }
        return await this.regen();
      }
      if (/^(完整配置单|看明细|看完整配置单|配置单)$/.test(text) && app.globalData.plan) {
        this.setData({ waiting: false });
        return wx.navigateTo({ url: '/pages/result/result' });
      }
      // 本地快路径：一句话里预算用途齐了直接开配（不耗 AI）
      const it = parseIntent(text);
      if (it.budget) this.pendingBudget = it.budget;
      if (it.usage) this.pendingUsage = it.usage;
      if (this.pendingBudget && this.pendingUsage) {
        const b = this.pendingBudget, u = this.pendingUsage;
        this.pendingBudget = this.pendingUsage = null;
        return await this.makePlan(b, u, app.globalData.aiNote || '');
      }
      if (aiOn) {
        // 已有方案且这句不是新需求 → 当追问闲聊；否则 AI 驱动需求确立
        if (app.globalData.plan && !it.budget && !it.usage) {
          const reply = await bossChat(app.globalData.chatHistory, app.globalData.plan);
          return this.say(reply);
        }
        const r = await elicit(app.globalData.chatHistory);
        if (r.note) app.globalData.aiNote = r.note;
        if (r.ready) {
          this.pendingBudget = this.pendingUsage = null;
          return await this.makePlan(r.budget, r.usage, r.note, r.reply);
        }
        if (r.budget) this.pendingBudget = r.budget;
        if (r.usage) this.pendingUsage = r.usage;
        return this.say(r.reply || USAGE_ASK);
      }
      // 无 AI 的本地引导（自然问句，不给选项）
      if (this.pendingBudget) return this.say(`预算 ¥${this.pendingBudget} 记下了。${USAGE_ASK}`);
      if (this.pendingUsage) return this.say(`${USAGE_LABEL[this.pendingUsage]}是吧，明白。${BUDGET_ASK}`);
      if (app.globalData.plan) {
        return this.say('这个问题店里的智能助手还没接上（AI 未配置），答不准。想调整配置就说「换一套」，或者直接告诉我新的预算和用途。');
      }
      this.say(`想配机的话，告诉我预算和用途就行——${BUDGET_ASK}`);
    } catch (e) {
      this.setMood('surprise');
      this.say('哎呀出岔子了：' + e.message);
    } finally {
      this.busy = false;
      if (this.data.waiting) this.setData({ waiting: false });
    }
  },

  async makePlan(budget, usage, note, transition) {
    const app = getApp();
    this.regenCount = 0; // 新需求重置免费换一套额度
    const plan = await getRecommend(budget, usage);
    app.globalData.plan = plan;
    app.globalData.excludeHistory = [plan.keyIds.cpu, plan.keyIds.gpu].filter(Boolean);
    const saved = plan.budget - plan.total;
    this.setMood('happy');
    this.say((transition ? transition + '\n' : '') +
      `合计 ¥${plan.total}` +
      (saved > 0 ? `，还给你留了 ¥${saved} 余量` : '，预算用得刚刚好') +
      `。${plan.summary}`);
    this.showPlanCard(plan);
    this.offer(['换一套', '看完整配置单']);
    if (app.globalData.config.deepseek) {
      reviewBuild(plan, note || app.globalData.aiNote)
        .then(advice => { this.say('姐再多说两句：\n' + advice); })
        .catch(() => {});
    }
  },

  async regen() {
    const app = getApp();
    const plan = app.globalData.plan;
    this.regenCount = (this.regenCount || 0) + 1;
    try {
      const next = await getRecommend(plan.budget, plan.usage, app.globalData.excludeHistory);
      app.globalData.plan = next;
      [next.keyIds.cpu, next.keyIds.gpu].filter(Boolean)
        .forEach(id => app.globalData.excludeHistory.push(id));
      this.say('成，换个搭配给你：');
      this.showPlanCard(next);
      this.offer(['换一套', '看完整配置单']);
    } catch (e) {
      app.globalData.excludeHistory = [];
      this.say('好搭配都让你看遍啦，姐从头再给你配一套：');
      await this.makePlan(plan.budget, plan.usage, '');
    }
  }
});
