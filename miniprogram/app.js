// ── ♥ AI 情侣空间 v2.0 ──
App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({ env: 'cloud1-d4girnkj0d26a47d7', traceUser: true });
    }
    this.loadConfig();
  },

  loadConfig() {
    const cfg = wx.getStorageSync('love_config') || {};
    const settings = wx.getStorageSync('love_settings') || {};
    this.globalData = {
      couple: {
        name1: cfg.name1 || '小可爱',
        name2: cfg.name2 || '大笨蛋',
        avatar1: cfg.avatar1 || '',
        avatar2: cfg.avatar2 || '',
        startDate: cfg.startDate || '2024-01-01',
        city: cfg.city || '北京',
        region: cfg.region || [],
        latitude: cfg.latitude || null,
        longitude: cfg.longitude || null,
        locationDetail: cfg.locationDetail || '',
      },
      agent: {
        endpoint: cfg.endpoint || 'http://localhost:3001/api/agent'
      },
      preferences: cfg.preferences || { greetingTime: '08:00', reportDay: 'sunday' },
      settings: {
        nick1: settings.nick1 || '宝贝',
        nick2: settings.nick2 || '宝贝',
        nick1Custom: settings.nick1Custom || '',
        nick2Custom: settings.nick2Custom || '',
        anniversaries: settings.anniversaries || [],
        notifyGreeting: settings.notifyGreeting !== false,
        notifyReport: settings.notifyReport !== false,
        notifyPartner: settings.notifyPartner !== false,
        notifyAnniversary: settings.notifyAnniversary !== false,
        privacyMode: settings.privacyMode || false,
        screenshotWarning: settings.screenshotWarning !== false,
        previewMask: settings.previewMask !== false,
        shareMask: settings.shareMask !== false
      }
    };
  },

  saveConfig() {
    const c = this.globalData.couple;
    wx.setStorageSync('love_config', {
      name1: c.name1, name2: c.name2,
      avatar1: c.avatar1, avatar2: c.avatar2,
      startDate: c.startDate, city: c.city,
      region: c.region,
      latitude: c.latitude, longitude: c.longitude,
      locationDetail: c.locationDetail,
      endpoint: this.globalData.agent.endpoint,
      preferences: this.globalData.preferences
    });
  }
});
