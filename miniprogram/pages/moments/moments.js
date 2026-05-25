// ── 心动瞬间 ──
const api = require('../../utils/api');

Page({
  data: {
    moments: [],
    newContent: '',
    newMood: '🥰'
  },

  onShow() { this.loadMoments(); },

  async loadMoments() {
    try {
      const res = await api.getMoments(30);
      this.setData({ moments: res.data || [] });
    } catch (err) { console.log('加载失败:', err); }
  },

  onInput(e) { this.setData({ newContent: e.detail.value }); },
  pickMood(e) { this.setData({ newMood: e.currentTarget.dataset.mood }); },

  async addMoment() {
    const content = this.data.newContent.trim();
    if (!content) { wx.showToast({ title: '写下点什么吧～', icon: 'none' }); return; }

    try {
      await api.addMoment({
        content,
        mood: this.data.newMood,
        date: new Date().toISOString().slice(0, 10)
      });
      wx.showToast({ title: '已珍藏 💝', icon: 'success' });
      this.setData({ newContent: '' });
      this.loadMoments();
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  async deleteMoment(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除瞬间',
      content: '确定要删除吗？30天内可在回收站恢复。',
      confirmText: '删除',
      confirmColor: '#E8668A',
      success: async (r) => {
        if (r.confirm) {
          await api.deleteMoment(id);
          this.loadMoments();
          wx.showToast({ title: '已移入回收站', icon: 'success' });
        }
      }
    });
  },

  async generateCollection() {
    wx.showLoading({ title: '小爱创作中...' });
    try {
      const res = await api.chat(
        `请根据以下心动瞬间，帮我写一段温暖的心动合集，像一篇微型恋爱故事。${JSON.stringify(this.data.moments.map(m => ({ date: m.date, mood: m.mood, content: m.content })))}。150-250字，温暖叙事风格。`
      );
      wx.hideLoading();
      wx.showModal({
        title: '心动集 💝',
        content: res.reply || '生成失败',
        showCancel: false,
        confirmText: '太棒了'
      });
    } catch (err) {
      wx.hideLoading();
    }
  }
});
