// ── 情侣档案页 v2.2 ──
const app = getApp();
const api = require('../../utils/api');

Page({
  data: {
    couple: { name1: '', name2: '', avatar1: '', avatar2: '', startDate: '', city: '' },
    region: [],            // ['北京市', '北京市', '朝阳区']
    locationDetail: '',    // 经纬度详情
    locating: false,
    daysTogether: 0,
    nextMilestone: '',
    nextMilestoneDays: 0,
    anniversaries: [],
  },

  onLoad() {
    this.loadProfile();
  },

  onShow() {
    this.loadProfile();
  },

  loadProfile() {
    const couple = app.globalData.couple;
    const settings = app.globalData.settings || {};
    const startDate = new Date(couple.startDate);
    const days = Math.floor((new Date() - startDate) / 86400000);

    // 还原 region 数组
    const region = couple.region || [];

    this.setData({
      couple: { ...couple },
      region,
      daysTogether: days,
      anniversaries: settings.anniversaries || [],
      locationDetail: couple.locationDetail || '',
    });

    // 加载倒计时
    api.getNextAnniversary(couple.startDate).then(res => {
      if (res.success && res.daysLeft > 0) {
        this.setData({
          nextMilestone: res.nextMilestone + '天',
          nextMilestoneDays: res.daysLeft,
        });
      }
    }).catch(() => {});
  },

  onField(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`couple.${field}`]: e.detail.value });
  },

  onStartDate(e) {
    this.setData({ 'couple.startDate': e.detail.value });
  },

  // ── 多级地区选择器 ──
  onRegionChange(e) {
    const region = e.detail.value;        // ['北京市', '北京市', '朝阳区']
    const city = region.join(' ');         // "北京市 北京市 朝阳区"
    this.setData({
      region,
      'couple.city': city,
    });
  },

  // ── GPS 自动定位 ──
  async detectLocation() {
    this.setData({ locating: true });
    wx.vibrateShort({ type: 'light' });

    try {
      // 1. 获取 GPS 坐标
      const locRes = await new Promise((resolve, reject) => {
        wx.getLocation({ type: 'wgs84', success: resolve, fail: reject });
      });

      const { latitude, longitude } = locRes;

      // 2. 反向地理编码 → 服务端调用 Nominatim
      const geoRes = await api.reverseGeocode(latitude, longitude);

      if (geoRes.success) {
        const { display, full } = geoRes;
        const region = [full.province, full.city, full.district].filter(Boolean);
        const cityStr = region.join(' ');

        this.setData({
          'couple.city': cityStr,
          'couple.region': region,
          'couple.latitude': latitude,
          'couple.longitude': longitude,
          region,
          locationDetail: `GPS 定位: ${display}`,
          locating: false,
        });

        wx.showToast({ title: `已定位到 ${display}`, icon: 'success' });
      } else {
        this.setData({ locating: false });
        wx.showToast({ title: geoRes.error || '定位失败，请手动选择', icon: 'none' });
      }
    } catch (err) {
      this.setData({ locating: false });
      console.log('定位失败:', err);
      wx.showModal({
        title: '定位失败',
        content: '请在系统设置中开启位置权限，或手动选择城市。',
        showCancel: false,
      });
    }
  },

  async chooseAvatar(e) {
    const role = e.currentTarget.dataset.role;
    try {
      const res = await wx.chooseImage({ count: 1, sizeType: ['compressed'] });
      if (res.tempFilePaths[0]) {
        this.setData({ [`couple.${role}`]: res.tempFilePaths[0] });
      }
    } catch {}
  },

  saveProfile() {
    app.globalData.couple = { ...this.data.couple };
    app.saveConfig();
    wx.vibrateShort({ type: 'medium' });
    wx.showToast({ title: '档案已更新 💕', icon: 'success' });
  },
});
