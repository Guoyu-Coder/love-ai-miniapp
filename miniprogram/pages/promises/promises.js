// ── 私密约定 ──
const api = require('../../utils/api');

Page({
  data: {
    promises: [],
    newTitle: '',
    newContent: '',
    newFreq: '随时'
  },

  onShow() { this.loadPromises(); },

  async loadPromises() {
    try {
      const res = await api.getPromises('all');
      this.setData({ promises: res.data || [] });
    } catch (err) { console.log('加载约定失败:', err); }
  },

  onTitleInput(e) { this.setData({ newTitle: e.detail.value }); },
  onContentInput(e) { this.setData({ newContent: e.detail.value }); },
  pickFreq(e) { this.setData({ newFreq: e.currentTarget.dataset.freq }); },

  async addPromise() {
    const title = this.data.newTitle.trim();
    if (!title) { wx.showToast({ title: '写个约定吧～', icon: 'none' }); return; }

    try {
      await api.addPromise({
        title,
        content: this.data.newContent,
        frequency: this.data.newFreq
      });
      wx.showToast({ title: '约定已立 🤝', icon: 'success' });
      this.setData({ newTitle: '', newContent: '', newFreq: '随时' });
      this.loadPromises();
    } catch (err) {
      wx.showToast({ title: '添加失败', icon: 'none' });
    }
  },

  async deletePromise(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除约定',
      content: '确定要删除吗？30天内可在回收站恢复。',
      confirmText: '删除',
      confirmColor: '#E8668A',
      success: async (r) => {
        if (r.confirm) {
          await api.deletePromise(id);
          this.loadPromises();
          wx.showToast({ title: '已移入回收站', icon: 'success' });
        }
      }
    });
  },

  async checkPromise(e) {
    const id = e.currentTarget.dataset.id;
    try {
      const res = await api.checkinPromise(id);
      if (res.success) {
        const promises = this.data.promises.map(p =>
          p._id === id ? { ...p, streak: res.streak } : p
        );
        this.setData({ promises });
        wx.showToast({ title: '打卡成功 🔥', icon: 'success' });
      } else {
        wx.showToast({ title: res.error || '打卡失败', icon: 'none' });
      }
    } catch {
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  }
});
