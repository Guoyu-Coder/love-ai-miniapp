// ── 约会记忆馆 v2.3 ──
const api = require('../../utils/api');

Page({
  data: {
    dates: [],
    totalDates: 0,
    totalLocations: 0,
    favoriteMood: '甜蜜',
    guessEmoji: '🥰',
    // 视图模式: 'timeline' | 'photo-grid'
    viewMode: 'timeline',
    // 所有照片（用于照片墙）
    allPhotos: [],
    loading: true,
    // 心情标签对应颜色
    moodColors: {
      '甜蜜': '#FF7BA6',
      '开心': '#FFB347',
      '平淡': '#A0C4FF',
      '感动': '#B39DDB',
      '吵架': '#CCC',
    }
  },

  onShow() { this.loadDates(); },

  async onPullDownRefresh() {
    await this.loadDates();
    wx.stopPullDownRefresh();
    wx.showToast({ title: '已刷新 📸', icon: 'success', duration: 1000 });
  },

  async loadDates() {
    this.setData({ loading: true });
    try {
      const res = await api.getDateRecords({ limit: 50 });
      const dates = res.data || [];

      // 处理照片 URL
      const processed = dates.map(d => ({
        ...d,
        photos: (d.photos || []).map(p => api.getPhotoUrl(p)),
        cover: d.photos && d.photos.length > 0 ? api.getPhotoUrl(d.photos[0]) : null,
      }));

      // 收集所有照片
      const allPhotos = [];
      processed.forEach(d => {
        if (d.photos && d.photos.length > 0) {
          d.photos.forEach((url, i) => {
            allPhotos.push({ url, dateId: d._id, date: d.date, mood: d.mood, index: i });
          });
        }
      });

      // 统计
      const locations = new Set(dates.map(d => d.location).filter(Boolean));
      const moods = dates.map(d => d.mood).filter(Boolean);

      // 心情频率统计
      const moodCount = {};
      moods.forEach(m => { moodCount[m] = (moodCount[m] || 0) + 1; });
      let topMood = '甜蜜';
      let maxCount = 0;
      Object.entries(moodCount).forEach(([m, c]) => {
        if (c > maxCount) { topMood = m; maxCount = c; }
      });

      const emojiMap = { '甜蜜': '🥰', '开心': '😆', '平淡': '😊', '感动': '🥺', '吵架': '😤' };

      this.setData({
        dates: processed,
        totalDates: dates.length,
        totalLocations: locations.size,
        favoriteMood: topMood || '甜蜜',
        guessEmoji: emojiMap[topMood] || '💕',
        allPhotos,
        loading: false,
      });
    } catch (err) {
      console.log('加载约会失败:', err);
      this.setData({ loading: false });
    }
  },

  // ══ 视图切换 ══
  switchView(e) {
    const mode = e.currentTarget.dataset.mode;
    wx.vibrateShort({ type: 'light' });
    this.setData({ viewMode: mode });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/dates/detail/detail?id=${id}` });
  },

  // 从照片墙跳转
  goPhotoDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (id) {
      wx.navigateTo({ url: `/pages/dates/detail/detail?id=${id}` });
    }
  },

  goNewDate() {
    wx.navigateTo({ url: '/pages/dates/detail/detail?action=new' });
  }
});
