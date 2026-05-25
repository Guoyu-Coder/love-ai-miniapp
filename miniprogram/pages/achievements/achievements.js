// ── 成就殿堂 ──
const api = require('../../utils/api');

Page({
  data: {
    loading: true,
    achievements: [],
    unlockedCount: 0,
    totalCount: 0,
    percent: 0,
    showCelebrate: false,
    celebrateName: '',
  },

  onLoad() { this.loadAll(); },
  onShow() { this.loadAll(); },

  async loadAll() {
    this.setData({ loading: true });
    try {
      const res = await api.getAchievements();
      const achievements = res.achievements || [];
      const unlockedCount = res.unlocked || 0;
      const totalCount = res.total || achievements.length;
      const percent = totalCount > 0 ? Math.round(unlockedCount / totalCount * 100) : 0;

      this.setData({
        achievements,
        unlockedCount,
        totalCount,
        percent,
        loading: false,
      });
    } catch {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 解锁条件说明
  getConditionText(item) {
    const conditions = {
      explorer: '去过 10 个不同的约会地点',
      dater: '完成 50 次约会记录',
      wisher: '实现 5 个共同愿望',
      committed: '约定打卡 30 次',
      collector: '珍藏 100 个心动瞬间',
      hundays: '在一起满 100 天',
      oneyear: '在一起满一年（365天）',
      thousand: '在一起满 1000 天',
    };
    return conditions[item.id] || '';
  },

  onBadgeTap(e) {
    const item = e.currentTarget.dataset.item;
    if (item.unlocked) {
      wx.vibrateShort({ type: 'medium' });
      wx.showToast({ title: `${item.icon} ${item.name} 已解锁！`, icon: 'none', duration: 1500 });
    } else {
      wx.vibrateShort({ type: 'light' });
      const remaining = item.target - item.progress;
      wx.showToast({ title: `还差 ${remaining} 个，继续加油 💪`, icon: 'none', duration: 1500 });
    }
  },

  goBack() {
    wx.navigateBack();
  }
});
