const { bossChat } = require('../../utils/ai');

const GREETING = '来啦？配置上有啥拿不准的尽管问，姐给你说道说道～生成方案之后问，姐还能对着你的配置单聊。';

Page({
  data: {
    messages: [],
    input: '',
    pending: false,
    scrollInto: ''
  },

  onLoad() {
    const app = getApp();
    if (!app.globalData.chatHistory) {
      app.globalData.chatHistory = [{ role: 'assistant', content: GREETING }];
    }
    this.syncMessages();
  },

  syncMessages() {
    const msgs = getApp().globalData.chatHistory.map((m, i) => ({ ...m, id: 'm' + i }));
    this.setData({ messages: msgs, scrollInto: msgs.length ? msgs[msgs.length - 1].id : '' });
  },

  onInput(e) { this.setData({ input: e.detail.value }); },

  async onSend() {
    const text = this.data.input.trim();
    if (!text || this.data.pending) return;
    const app = getApp();
    app.globalData.chatHistory.push({ role: 'user', content: text });
    this.setData({ input: '', pending: true });
    this.syncMessages();
    try {
      const reply = await bossChat(app.globalData.chatHistory, app.globalData.plan);
      app.globalData.chatHistory.push({ role: 'assistant', content: reply });
    } catch (e) {
      app.globalData.chatHistory.push({ role: 'assistant', content: '哎呀店里网卡了：' + e.message });
    } finally {
      this.setData({ pending: false });
      this.syncMessages();
    }
  }
});
