// ── 愿望清单 ──
const api = require('../../utils/api');

Page({
  data: {
    wishes: [],
    newTitle: '',
    newDesc: '',
    newCat: '其他'
  },

  onShow() { this.loadWishes(); },

  async loadWishes() {
    try {
      const res = await api.getWishes('all');
      this.setData({ wishes: res.data || [] });
    } catch (err) {
      console.log('加载愿望失败:', err);
    }
  },

  onTitleInput(e) { this.setData({ newTitle: e.detail.value }); },
  onDescInput(e) { this.setData({ newDesc: e.detail.value }); },
  pickCat(e) { this.setData({ newCat: e.currentTarget.dataset.cat }); },

  async addWish() {
    const title = this.data.newTitle.trim();
    if (!title) { wx.showToast({ title: '填个愿望吧～', icon: 'none' }); return; }

    try {
      await api.addWish({
        title,
        description: this.data.newDesc,
        category: this.data.newCat
      });
      wx.showToast({ title: '愿望已加入 ✨', icon: 'success' });
      this.setData({ newTitle: '', newDesc: '', newCat: '其他' });
      this.loadWishes();
    } catch (err) {
      wx.showToast({ title: '添加失败', icon: 'none' });
    }
  },

  async toggleWish(e) {
    const id = e.currentTarget.dataset.id;
    await api.updateWishStatus(id, 'done');
    this.loadWishes();
  },

  async deleteWish(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除愿望',
      content: '确定要删除吗？30天内可在回收站恢复。',
      confirmText: '删除',
      confirmColor: '#E8668A',
      success: async (r) => {
        if (r.confirm) {
          await api.deleteWish(id);
          this.loadWishes();
          wx.showToast({ title: '已移入回收站', icon: 'success' });
        }
      }
    });
  },

  async askAITip(e) {
    const item = e.currentTarget.dataset.item;
    wx.showLoading({ title: '小爱思考中...' });
    try {
      const res = await api.chat(
        `我想实现这个愿望：「${item.title}」${item.description ? '，描述：' + item.description : ''}。请给我一些具体的建议，帮我把这个愿望拆成可以实现的小步骤。100-200字，温暖鼓励的语气。`
      );
      wx.hideLoading();
      const tip = res.reply || '';
      const wishes = this.data.wishes.map(w =>
        w._id === item._id ? { ...w, aiTip: tip } : w
      );
      this.setData({ wishes });
    } catch (err) {
      wx.hideLoading();
    }
  }
});
