// ── 首页仪表盘 v2.2 ──
const app = getApp();
const api = require('../../utils/api');
const { getAudioManager } = require('../../utils/audio');

Page({
  data: {
    loading: true,
    couple: { name1: 'TA', name2: 'TA' },
    daysTogether: 0,
    isMorning: true,
    todayGreeting: '',
    inspiration: '',
    nextMilestone: 0,
    daysLeft: 0,
    stats: { dateCount: 0, wishPending: 0, momentCount: 0, promiseCount: 0 },
    recentDates: [],
    achievements: [],
    unlockedCount: 0,
    totalAchievements: 0,
    privacyMode: false,
    showMusicBtn: true,
    musicPlaying: false,
    hearts: [],
    nudges: []
  },

  onLoad() {
    this.loadAll();
  },

  // 下拉刷新
  async onPullDownRefresh() {
    await this.loadAll();
    wx.stopPullDownRefresh();
    wx.showToast({ title: '已刷新 💕', icon: 'success', duration: 1000 });
  },

  async loadAll() {
    this.setData({ loading: true });
    this.loadCoupleData();
    await Promise.all([
      this.loadStats(),
      this.loadInspiration(),
      this.loadAnniversary(),
      this.loadNudges()
    ]);
    this.setData({ loading: false });
  },

  loadCoupleData() {
    const couple = app.globalData.couple;
    const settings = app.globalData.settings || {};
    const startDate = new Date(couple.startDate);
    const days = Math.floor((new Date() - startDate) / 86400000);
    const privacyMode = settings.privacyMode || false;
    this.setData({ couple, daysTogether: days, privacyMode });
  },

  async loadStats() {
    try {
      const [datesRes, wishesRes, momentsRes, promisesRes, greetRes, achRes] = await Promise.all([
        api.getDateRecords({ limit: 3 }),
        api.getWishes('pending'),
        api.getMoments(1),
        api.getPromises('active'),
        api.getTodayGreeting(),
        api.getAchievements()
      ]);

      const dates = datesRes.data || [];
      const achievements = (achRes && achRes.achievements) ? achRes.achievements : [];
      const unlockedCount = (achRes && achRes.unlocked) ? achRes.unlocked : 0;
      this.setData({
        recentDates: dates.slice(0, 3),
        todayGreeting: greetRes.content || '',
        stats: {
          dateCount: dates.length,
          wishPending: (wishesRes.data || []).length,
          momentCount: (momentsRes.data || []).length,
          promiseCount: (promisesRes.data || []).length
        },
        achievements,
        unlockedCount,
        totalAchievements: (achRes && achRes.total) ? achRes.total : achievements.length
      });
    } catch (err) { console.log('加载数据失败:', err.message); }
  },

  async loadInspiration() {
    try {
      const res = await api.getDailyInspiration();
      if (res.success && res.inspiration) {
        this.setData({ inspiration: res.inspiration });
      }
    } catch (err) { console.log('灵感加载失败:', err.message); }
  },

  async loadAnniversary() {
    try {
      const res = await api.getNextAnniversary(app.globalData.couple.startDate);
      if (res.success && res.daysLeft > 0) {
        this.setData({
          nextMilestone: res.nextMilestone,
          daysLeft: res.daysLeft
        });
      }
    } catch (err) { console.log('倒计时加载失败:', err.message); }
  },

  async loadNudges() {
    try {
      const res = await api.checkNudges();
      if (res.success && res.nudges) {
        this.setData({ nudges: res.nudges });
      }
    } catch (err) { console.log('提醒加载失败:', err.message); }
  },

  async refreshInspiration() {
    wx.vibrateShort({ type: 'light' });
    try {
      const res = await api.getDailyInspiration();
      if (res.success && res.inspiration) {
        this.setData({ inspiration: res.inspiration });
        wx.showToast({ title: '灵感已刷新 ✨', icon: 'success', duration: 1000 });
      }
    } catch (err) {}
  },

  haptic() {
    wx.vibrateShort({ type: 'light' });
  },

  // ── 导航 ──
  goChat() { this.haptic(); wx.switchTab({ url: '/pages/chat/chat' }); },
  goDates() { this.haptic(); wx.switchTab({ url: '/pages/dates/dates' }); },
  goDateDetail(e) {
    this.haptic();
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/dates/detail/detail?id=${id}` });
  },
  goWish() { this.haptic(); wx.navigateTo({ url: '/pages/wishes/wishes' }); },
  goMoment() { this.haptic(); wx.navigateTo({ url: '/pages/moments/moments' }); },
  goMoments() { this.haptic(); wx.navigateTo({ url: '/pages/moments/moments' }); },
  goPromises() { this.haptic(); wx.navigateTo({ url: '/pages/promises/promises' }); },
  goDateRecord() {
    this.haptic();
    wx.navigateTo({ url: '/pages/dates/detail/detail?action=new' });
  },
  goAchievements() {
    this.haptic();
    const { unlockedCount, totalAchievements } = this.data;
    if (totalAchievements > 0) {
      wx.navigateTo({ url: '/pages/achievements/achievements' });
    } else {
      wx.showToast({ title: '暂未获取成就数据 ~', icon: 'none' });
    }
  },

  shareAnniversary() {
    this.haptic();
    const text = `我们在一起 ${this.data.daysTogether} 天啦！距离 ${this.data.nextMilestone} 天纪念日还有 ${this.data.daysLeft} 天 💕`;
    wx.showModal({ title: '纪念日', content: text, showCancel: false, confirmText: '知道啦' });
  },

  onNudgeTap(e) {
    this.haptic();
    const nudge = e.currentTarget.dataset.nudge;
    if (nudge.action === 'plan_date') {
      wx.switchTab({ url: '/pages/chat/chat' });
    } else if (nudge.action === 'view_wishes') {
      wx.navigateTo({ url: '/pages/wishes/wishes' });
    } else if (nudge.action === 'view_promises') {
      wx.navigateTo({ url: '/pages/promises/promises' });
    } else if (nudge.action === 'plan_surprise') {
      wx.switchTab({ url: '/pages/chat/chat' });
    }
  },

  dismissNudge(e) {
    this.haptic();
    const idx = e.currentTarget.dataset.index;
    const nudges = [...this.data.nudges];
    nudges.splice(idx, 1);
    this.setData({ nudges });
  },

  goProfile() {
    this.haptic();
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  // ── 悬浮音乐按钮 ──
  toggleFloatingMusic() {
    this.haptic();
    const audio = getAudioManager();
    audio.toggle();
    this.setData({ musicPlaying: audio.playing });
  },

  syncMusicState() {
    const audio = getAudioManager();
    this.setData({
      musicPlaying: audio.enabled && audio.playing,
      showMusicBtn: true,
    });
  },

  onShow() {
    this.setData({ isMorning: new Date().getHours() < 18 });
    this.loadCoupleData();
    this.loadStats();
    this.syncMusicState();
    this.spawnAmbientHearts();
  },

  // ── 环境爱心粒子 ──
  spawnAmbientHearts() {
    const emojis = ['🌸', '💕', '✨', '💖', '🩷', '💝'];
    const hearts = [];
    for (let i = 0; i < 8; i++) {
      hearts.push({
        id: Date.now() + i,
        x: Math.random() * 90 + 5,
        emoji: emojis[Math.floor(Math.random() * emojis.length)],
        delay: Math.random() * 2,
        duration: Math.random() * 1.5 + 2,
        size: Math.random() * 20 + 24,
      });
    }
    this.setData({ hearts });
    // 自动清除
    setTimeout(() => this.setData({ hearts: [] }), 4000);
  },
});
