// ── 设置页 v2.3 - 折叠面板重构 ──
const app = getApp();
const api = require('../../utils/api');
const { getAudioManager, PLAYLIST } = require('../../utils/audio');

Page({
  data: {
    couple: { name1: '', name2: '', avatar1: '', avatar2: '', startDate: '', city: '' },
    // AI 称呼
    nick1: '宝贝', nick2: '宝贝',
    nick1Custom: '', nick2Custom: '',
    // 纪念日
    anniversaries: [],
    // 通知
    notifyGreeting: true, notifyReport: true, notifyPartner: true, notifyAnniversary: true,
    inCooldown: false,
    // 隐私
    privacyMode: false, screenshotWarning: true, previewMask: true, shareMask: true,
    // 绑定
    binding: null, inviteCode: '',
    // 回收站
    trashCount: 0,
    // 音乐
    musicEnabled: false, musicPlaying: false,
    musicCurrentTrack: 0, musicTrackName: '',
    musicPlaylist: PLAYLIST,
    // 存储
    storageUsed: '0 KB', storagePercent: 0,
    // ── 折叠面板状态 ──
    panels: {
      binding: false,
      nicknames: false,
      anniversaries: false,
      notify: false,
      music: false,
      privacy: false,
      trash: false,
      storage: false,
    },
    // ── 面板摘要（显示在折叠标题右侧）──
    bindingSummary: '未绑定',
    nickSummary: '宝贝 & 宝贝',
    anniSummary: '未设置',
    notifySummary: '全部开启',
    privacySummary: '标准模式',
    trashSummary: '空',
    musicSummary: '未开启',
  },

  onLoad() { this.loadAll(); },
  onShow() { this.loadAll(); },

  async loadAll() {
    const c = app.globalData.couple;
    const settings = app.globalData.settings || {};

    this.setData({
      couple: { ...c },
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
      shareMask: settings.shareMask !== false,
    });

    this.calcStorage();
    this.syncMusicState();
    this.buildSummaries();

    Promise.all([
      this.loadBindingStatus(),
      this.loadTrashCount(),
      this.loadNotificationState(),
    ]).catch(() => {});
  },

  // ══ 面板折叠控制 ══
  togglePanel(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`panels.${key}`]: !this.data.panels[key] });
  },

  // ══ 构建面板摘要 ══
  buildSummaries() {
    const s = this.data;
    const n1 = s.nick1Custom || s.nick1 || '宝贝';
    const n2 = s.nick2Custom || s.nick2 || '宝贝';

    const notifyOn = [s.notifyGreeting, s.notifyReport, s.notifyPartner, s.notifyAnniversary].filter(Boolean).length;
    const privacyOn = [s.privacyMode, s.screenshotWarning, s.previewMask, s.shareMask].filter(Boolean).length;

    this.setData({
      nickSummary: `${n1} & ${n2}`,
      anniSummary: s.anniversaries.length > 0 ? `${s.anniversaries.length} 个纪念日` : '未设置',
      notifySummary: notifyOn === 4 ? '全部开启' : notifyOn === 0 ? '全部关闭' : `${notifyOn} 项已开启`,
      privacySummary: s.privacyMode ? `隐私模式 · ${privacyOn} 项保护` : '标准模式',
      trashSummary: s.trashCount > 0 ? `${s.trashCount} 条待清理` : '空',
      musicSummary: s.musicEnabled ? (s.musicPlaying ? `${s.musicTrackName} ♪` : s.musicTrackName || '已暂停') : '未开启',
    });
  },

  // ══ 导航 ══
  goProfile() {
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  // ══ AI 称呼 ══
  pickNick(e) {
    const { who, name } = e.currentTarget.dataset;
    if (who === '1') this.setData({ nick1: name, nick1Custom: '' });
    else this.setData({ nick2: name, nick2Custom: '' });
    this.buildSummaries();
  },
  onNickCustom(e) {
    const who = e.currentTarget.dataset.who;
    if (who === '1') this.setData({ nick1Custom: e.detail.value, nick1: '' });
    else this.setData({ nick2Custom: e.detail.value, nick2: '' });
    this.buildSummaries();
  },

  // ══ 纪念日 ══
  addAnniversary() {
    const icons = ['💕', '💋', '💍', '🎂', '🎉', '🏠', '✈️', '🎓', '🐱', '🌟'];
    wx.showActionSheet({
      itemList: ['初吻纪念日', '求婚纪念日', '生日', '搬家日', '自定义'],
      success: (res) => {
        const labels = ['初吻纪念日', '求婚纪念日', '生日', '搬家日', '自定义'];
        const label = labels[res.tapIndex];
        const icon = icons[res.tapIndex] || '💕';
        if (res.tapIndex === 4) {
          wx.showModal({
            title: '自定义纪念日', editable: true, placeholderText: '输入名称',
            success: (r) => { if (r.confirm && r.content) this.pickDateForAnniversary(r.content, icon); }
          });
        } else {
          this.pickDateForAnniversary(label, icon);
        }
      }
    });
  },

  pickDateForAnniversary(label, icon) {
    wx.showModal({
      title: '选择日期',
      content: `请输入 ${label} 的日期（YYYY-MM-DD）`,
      editable: true,
      placeholderText: new Date().toISOString().slice(0, 10),
      success: (r) => {
        if (r.confirm) {
          const anniversaries = [...this.data.anniversaries, { label, icon, date: r.content || new Date().toISOString().slice(0, 10) }];
          this.setData({ anniversaries });
          this.buildSummaries();
        }
      }
    });
  },

  removeAnniversary(e) {
    const idx = e.currentTarget.dataset.index;
    const anniversaries = [...this.data.anniversaries];
    anniversaries.splice(idx, 1);
    this.setData({ anniversaries });
    this.buildSummaries();
  },

  // ══ 通知 ══
  toggleGreeting() { this.setData({ notifyGreeting: !this.data.notifyGreeting }); this.buildSummaries(); },
  toggleReport() { this.setData({ notifyReport: !this.data.notifyReport }); this.buildSummaries(); },
  togglePartnerActivity() { this.setData({ notifyPartner: !this.data.notifyPartner }); this.buildSummaries(); },
  toggleAnniversaryNotify() { this.setData({ notifyAnniversary: !this.data.notifyAnniversary }); this.buildSummaries(); },

  async loadNotificationState() {
    try {
      const res = await api.getNotificationState();
      if (res.success && res.state) this.setData({ inCooldown: res.isInCooldown || false });
    } catch {}
  },

  // ══ 音乐 ══
  toggleMusic() {
    const audio = getAudioManager();
    const enabled = !this.data.musicEnabled;
    this.setData({ musicEnabled: enabled });
    audio.setEnabled(enabled);
    if (enabled) {
      this.setData({ musicPlaying: true, musicCurrentTrack: audio.currentTrack, musicTrackName: audio.currentName });
      audio.play();
    }
    this.buildSummaries();
  },
  musicTogglePlay() { const audio = getAudioManager(); audio.toggle(); this.setData({ musicPlaying: audio.playing }); this.buildSummaries(); },
  musicNext() {
    const audio = getAudioManager(); audio.next();
    this.setData({ musicCurrentTrack: audio.currentTrack, musicTrackName: audio.currentName, musicPlaying: true });
    this.buildSummaries();
  },
  musicPrev() {
    const audio = getAudioManager(); audio.prev();
    this.setData({ musicCurrentTrack: audio.currentTrack, musicTrackName: audio.currentName, musicPlaying: true });
    this.buildSummaries();
  },
  musicSelectTrack(e) {
    const idx = e.currentTarget.dataset.index;
    const audio = getAudioManager(); audio.play(idx);
    this.setData({ musicCurrentTrack: idx, musicTrackName: PLAYLIST[idx].name, musicPlaying: true });
    this.buildSummaries();
  },
  syncMusicState() {
    const audio = getAudioManager();
    this.setData({
      musicEnabled: audio.enabled, musicPlaying: audio.playing,
      musicCurrentTrack: audio.currentTrack,
      musicTrackName: audio.enabled ? audio.currentName : '',
    });
    this.buildSummaries();
  },

  // ══ 隐私 ══
  togglePrivacy() { this.setData({ privacyMode: !this.data.privacyMode }); this.buildSummaries(); },
  toggleScreenshotWarning() { this.setData({ screenshotWarning: !this.data.screenshotWarning }); this.buildSummaries(); },
  togglePreviewMask() { this.setData({ previewMask: !this.data.previewMask }); this.buildSummaries(); },
  toggleShareMask() { this.setData({ shareMask: !this.data.shareMask }); this.buildSummaries(); },

  // ══ 绑定 ══
  async generateInviteCode() {
    wx.vibrateShort({ type: 'medium' });
    try {
      const res = await api.generateInviteCode();
      if (res.success) { this.setData({ inviteCode: res.inviteCode }); wx.showToast({ title: '邀请码已生成', icon: 'success' }); }
      else wx.showToast({ title: res.error || '生成失败', icon: 'none' });
    } catch { wx.showToast({ title: '网络错误', icon: 'none' }); }
  },

  inputInviteCode() {
    wx.showModal({
      title: '输入邀请码', content: '请输入TA分享给你的6位邀请码', editable: true, placeholderText: '如 ABC123',
      success: async (r) => {
        if (r.confirm && r.content) {
          const code = r.content.trim().toUpperCase();
          this.doBinding(code, this.data.couple.name1, false);
        }
      }
    });
  },

  doBinding(code, nick, clearHistory) {
    const confirmContent = clearHistory
      ? `检测到前任历史记录，将清空后再绑定。确认使用邀请码 ${code} 绑定？`
      : `确定使用邀请码 ${code} 绑定关系吗？`;
    wx.showModal({
      title: clearHistory ? '⚠️ 清空并绑定' : '确认绑定',
      content: confirmContent,
      confirmText: clearHistory ? '清空并绑定' : '确认绑定',
      confirmColor: '#FF7BA6',
      success: async (r2) => {
        if (r2.confirm) {
          try {
            const res = await api.confirmBinding(code, nick, clearHistory);
            if (res.success) {
              this.setData({ binding: res.binding, inviteCode: '' });
              this.loadBindingStatus();
              wx.showToast({ title: res.clearedHistory ? '已清空历史并绑定 💕' : '绑定成功 💕', icon: 'success' });
            } else if (res.needConfirm) {
              // 雷区1: 检测到前任残留数据，需要用户确认清空
              wx.showModal({
                title: '⚠️ 检测到历史记录',
                content: `检测到 ${res.historyCount} 条与前任的历史记录。\n\n建议清空后再绑定，避免数据混淆。是否清空并继续绑定？`,
                confirmText: '清空并绑定',
                cancelText: '取消',
                confirmColor: '#E8668A',
                success: (r3) => {
                  if (r3.confirm) {
                    this.doBinding(code, nick, true);
                  }
                }
              });
            } else {
              wx.showToast({ title: res.error || '绑定失败', icon: 'none' });
            }
          } catch { wx.showToast({ title: '网络错误', icon: 'none' }); }
        }
      }
    });
  },

  async loadBindingStatus() {
    try {
      const res = await api.getBindingStatus();
      if (res.success) {
        const binding = res.binding;
        if (binding && binding.boundAt) binding.boundAtText = new Date(binding.boundAt).toLocaleDateString('zh-CN');
        const isBound = binding && binding.status === 'active';
        this.setData({
          binding: binding || null,
          bindingSummary: isBound ? `已绑定 · ${binding.partnerNick || 'TA'}` : '未绑定',
        });
      }
    } catch {}
  },

  requestUnbind() {
    wx.showModal({
      title: '⚠️ 断开绑定',
      content: '确定要断开绑定关系吗？此操作不可撤销。',
      confirmText: '确定断开',
      confirmColor: '#E8668A',
      success: (r) => {
        if (r.confirm) {
          wx.showActionSheet({
            itemList: ['💾 保留我的个人副本', '🗑️ 彻底清空所有数据'],
            itemColor: '#E8668A',
            success: async (act) => {
              const mode = act.tapIndex === 0 ? 'keep_copy' : 'delete_all';
              try {
                const res = await api.confirmUnbind(true, mode);
                if (res.success) {
                  wx.showToast({ title: res.message, icon: 'none', duration: 2500 });
                  this.loadBindingStatus();
                } else {
                  wx.showToast({ title: res.error || '操作失败', icon: 'none' });
                }
              } catch { wx.showToast({ title: '网络错误', icon: 'none' }); }
            }
          });
        }
      }
    });
  },

  // ══ 回收站 ══
  async loadTrashCount() {
    try {
      const res = await api.getTrashList();
      if (res.success) {
        const count = (res.data || []).length;
        this.setData({ trashCount: count, trashSummary: count > 0 ? `${count} 条待清理` : '空' });
      }
    } catch {}
  },

  viewTrash() {
    wx.vibrateShort({ type: 'light' });
    wx.showLoading({ title: '加载中...' });
    api.getTrashList().then(res => {
      wx.hideLoading();
      if (!res.success || !res.data || res.data.length === 0) { wx.showToast({ title: '回收站为空 ✨', icon: 'none' }); return; }
      const items = res.data.map(item => {
        const typeLabels = { date: '📸 约会', wish: '✨ 愿望', moment: '💝 瞬间', promise: '🤝 约定' };
        const label = typeLabels[item._recordType] || '📋 记录';
        const name = item.title || item.activity || item.content || '(无标题)';
        return `${label} · ${name.slice(0, 15)}\n删除于 ${new Date(item._deletedAt).toLocaleDateString('zh-CN')}`;
      });
      wx.showModal({
        title: `🗑️ 回收站 (${items.length}条)`, content: items.join('\n\n') + `\n\n保留${res.retentionDays}天，过期自动清理。`,
        showCancel: true, confirmText: '知道了', cancelText: '清空全部', cancelColor: '#E8668A',
        success: (r) => { if (!r.confirm) this.emptyTrash(); }
      });
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '加载失败', icon: 'none' }); });
  },

  emptyTrash() {
    wx.showModal({
      title: '⚠️ 清空回收站', content: '清空后数据将彻底删除，无法恢复。确定吗？', confirmText: '我确认清空', confirmColor: '#E8668A',
      success: async (r) => {
        if (r.confirm) {
          try { const res = await api.emptyTrash(); wx.showToast({ title: res.message || '已清空', icon: 'success' }); this.loadTrashCount(); }
          catch { wx.showToast({ title: '操作失败', icon: 'none' }); }
        }
      }
    });
  },

  // ══ 存储 ══
  calcStorage() {
    try {
      const res = wx.getStorageInfoSync();
      const kb = Math.round(res.currentSize);
      const limit = res.limitSize || 10240;
      this.setData({ storageUsed: kb < 1024 ? kb + ' KB' : (kb / 1024).toFixed(1) + ' MB', storagePercent: Math.min(Math.round(kb / limit * 100), 100) });
    } catch {}
  },

  clearStorage() {
    wx.showModal({
      title: '⚠️ 清除缓存', content: '输入「我确认删除」来确认清除图片缓存。', editable: true, placeholderText: '我确认删除',
      confirmText: '确认清除', confirmColor: '#E8668A',
      success: (res) => {
        if (res.confirm && res.content === '我确认删除') {
          const convs = wx.getStorageSync('love_conversations');
          const config = wx.getStorageSync('love_config');
          const settings = wx.getStorageSync('love_settings');
          wx.clearStorageSync();
          if (convs) wx.setStorageSync('love_conversations', convs);
          if (config) wx.setStorageSync('love_config', config);
          if (settings) wx.setStorageSync('love_settings', settings);
          this.calcStorage();
          wx.showToast({ title: '已清理 🧹', icon: 'success' });
        } else if (res.confirm) wx.showToast({ title: '输入不匹配，已取消', icon: 'none' });
      }
    });
  },

  // ══ 保存 ══
  saveProfile() {
    const settings = {
      nick1: this.data.nick1, nick2: this.data.nick2,
      nick1Custom: this.data.nick1Custom, nick2Custom: this.data.nick2Custom,
      anniversaries: this.data.anniversaries,
      notifyGreeting: this.data.notifyGreeting, notifyReport: this.data.notifyReport,
      notifyPartner: this.data.notifyPartner, notifyAnniversary: this.data.notifyAnniversary,
      privacyMode: this.data.privacyMode, screenshotWarning: this.data.screenshotWarning,
      previewMask: this.data.previewMask, shareMask: this.data.shareMask,
    };
    app.globalData.preferences = { greetingTime: app.globalData.preferences?.greetingTime || '08:00', reportDay: app.globalData.preferences?.reportDay || 'sunday' };
    app.globalData.settings = settings;
    app.saveConfig();
    wx.setStorageSync('love_settings', settings);
    const nick1 = settings.nick1Custom || settings.nick1 || '';
    const nick2 = settings.nick2Custom || settings.nick2 || '';
    api.updateNicknames(nick1, nick2).catch(() => {});
    wx.vibrateShort({ type: 'medium' });
    wx.showToast({ title: '已保存 💕', icon: 'success' });
  }
});
