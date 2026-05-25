// ── 约会详情 & 新增 ──
const api = require('../../../utils/api');

Page({
  data: {
    mode: 'view',
    record: {},
    aiAnalysis: '',
    analyzing: false,
    form: {
      date: new Date().toISOString().slice(0, 10),
      location: '',
      locationAddress: '',
      latitude: null,
      longitude: null,
      activity: '',
      mood: '甜蜜',
      notes: '',
      photos: []
    },
    submitting: false
  },

  onLoad(options) {
    if (options.action === 'new') {
      this.setData({ mode: 'new' });
    } else if (options.id) {
      this.setData({ mode: 'view' });
      this.loadRecord(options.id);
    }
  },

  async loadRecord(id) {
    try {
      const res = await api.getDateRecord(id);
      if (res.success && res.data) this.setData({ record: res.data });
    } catch (err) {
      console.log('加载详情失败:', err);
    }
  },

  async getAIAnalysis() {
    this.setData({ analyzing: true });
    try {
      const record = this.data.record;
      const res = await api.chat(
        `请帮我回顾这次约会：日期${record.date}，地点${record.location}，做了${record.activity}，心情${record.mood}。心得：${record.notes}。请用温暖的话语帮我总结这段回忆，80-150字。`
      );
      this.setData({ aiAnalysis: res.reply || '回忆生成失败...', analyzing: false });
    } catch (err) {
      this.setData({ analyzing: false });
    }
  },

  onDateChange(e) { this.setData({ 'form.date': e.detail.value }); },
  onFieldChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },
  pickMood(e) { this.setData({ 'form.mood': e.currentTarget.dataset.mood }); },

  // ── 地图选点 ──
  async chooseMapLocation() {
    wx.vibrateShort({ type: 'light' });
    try {
      const res = await new Promise((resolve, reject) => {
        wx.chooseLocation({ success: resolve, fail: reject });
      });
      // res = { name, address, latitude, longitude }
      const venueName = res.name || '';
      const address = res.address || '';
      this.setData({
        'form.location': venueName || address,
        'form.locationAddress': address,
        'form.latitude': res.latitude,
        'form.longitude': res.longitude,
      });
    } catch (err) {
      console.log('地图选点取消或失败:', err);
    }
  },

  clearMapLocation() {
    this.setData({
      'form.locationAddress': '',
      'form.latitude': null,
      'form.longitude': null,
    });
  },

  async uploadPhoto() {
    const maxCount = 9 - this.data.form.photos.length;
    if (maxCount <= 0) { wx.showToast({ title: '最多9张照片', icon: 'none' }); return; }

    try {
      const res = await wx.chooseImage({ count: maxCount, sizeType: ['compressed'] });
      if (!res.tempFilePaths || res.tempFilePaths.length === 0) return;

      wx.showLoading({ title: '上传中...' });

      // 逐张上传到服务器
      const uploadedUrls = [];
      for (const tempPath of res.tempFilePaths) {
        const uploadRes = await api.uploadPhoto(tempPath);
        if (uploadRes.success) {
          uploadedUrls.push(uploadRes.path);
        } else {
          // 上传失败时降级使用临时路径（临时路径24h内有效）
          uploadedUrls.push(tempPath);
        }
      }

      wx.hideLoading();
      const photos = [...this.data.form.photos, ...uploadedUrls];
      this.setData({ 'form.photos': photos });
      wx.showToast({ title: `已上传 ${uploadedUrls.length} 张`, icon: 'success' });
    } catch (err) {
      wx.hideLoading();
    }
  },

  async submitDate() {
    const f = this.data.form;
    if (!f.activity.trim()) {
      wx.showToast({ title: '至少填写做了什么～', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      const res = await api.addDateRecord({
        date: f.date,
        location: f.locationAddress || f.location,
        locationAddress: f.locationAddress,
        latitude: f.latitude,
        longitude: f.longitude,
        activity: f.activity,
        mood: f.mood,
        notes: f.notes,
        photos: f.photos
      });

      if (res.success) {
        wx.showToast({ title: '回忆已保存 💕', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 1500);
      }
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  previewPhoto(e) {
    const url = e.currentTarget.dataset.url;
    wx.previewImage({ urls: this.data.record.photos, current: url });
  }
});
