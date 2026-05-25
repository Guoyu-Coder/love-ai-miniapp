// ── 恋爱报告 ──
const api = require('../../utils/api');

Page({
  data: {
    genType: 'week',
    generating: false,
    reports: []
  },

  onShow() { this.loadReports(); },

  async loadReports() {
    try {
      const res = await api.listReports();
      this.setData({
        reports: (res.reports || []).map(r => ({
          ...r,
          preview: (r.content || '').slice(0, 100) + '...'
        }))
      });
    } catch (err) { console.log('加载报告失败:', err); }
  },

  pickType(e) {
    this.setData({ genType: e.currentTarget.dataset.type });
  },

  async generateReport() {
    this.setData({ generating: true });
    try {
      const reportRes = await api.generateReport(this.data.genType);
      if (!reportRes.success) {
        wx.showToast({ title: '生成失败', icon: 'none' });
        this.setData({ generating: false });
        return;
      }

      const typeLabel = this.data.genType === 'week' ? '周报' : this.data.genType === 'month' ? '月报' : '年报';

      // 让 AI 写报告
      const chatRes = await api.chat(
        `请根据以下数据生成一份温暖的恋爱${typeLabel}。包含约会概览、心动集锦、暖心建议。300-500字，可爱温暖风格。数据：${JSON.stringify(reportRes)}`
      );

      const content = chatRes.reply || '报告生成失败，请重试';

      // 保存报告到服务端
      await api.saveReport({
        type: this.data.genType,
        startDate: reportRes.startDate,
        endDate: reportRes.endDate,
        content,
        stats: {
          dateCount: reportRes.totalDates || 0,
          momentCount: reportRes.totalMoments || 0,
          promiseCount: (reportRes.promises || []).length
        }
      });

      this.setData({ generating: false });
      this.loadReports();

      wx.showModal({
        title: '报告已生成 📊',
        content: content.slice(0, 300) + '...',
        showCancel: false,
        confirmText: '太棒了'
      });
    } catch (err) {
      console.log('生成报告失败:', err);
      wx.showToast({ title: '生成失败', icon: 'none' });
      this.setData({ generating: false });
    }
  },

  openReport(e) {
    const id = e.currentTarget.dataset.id;
    const report = this.data.reports.find(r => r._id === id);
    if (report) {
      wx.showModal({
        title: (report.type === 'week' ? '📅 周报' : report.type === 'month' ? '📆 月报' : '🎊 年报'),
        content: report.content || '报告内容为空',
        showCancel: false,
        confirmText: '知道了'
      });
    }
  }
});
