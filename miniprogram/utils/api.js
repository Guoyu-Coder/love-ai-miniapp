// ── 通用 API 调用层 ──
// 优先云函数 → 失败降级到本地服务器

const app = getApp();

// 云开发开关：false=本地服务器, true=云函数
const USE_CLOUD = true;
const BASE_URL = 'http://localhost:3001/api/agent';
const UPLOAD_URL = 'http://localhost:3001/api/upload';

function getBaseUrl() {
  const endpoint = (app && app.globalData && app.globalData.agent && app.globalData.agent.endpoint) || BASE_URL;
  return endpoint.replace('/api/agent', '');
}

// 生成完整图片 URL（前端存储的是相对路径如 /uploads/xxx.jpg）
function getPhotoUrl(path) {
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('wxfile://')) return path;
  return getBaseUrl() + path;
}

async function callAgent(action, params = {}) {
  // 云开发模式：等开通后把 USE_CLOUD 改成 true
  if (USE_CLOUD) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'agentCore',
        data: { action, ...params }
      });
      if (res.result && res.result.success !== false) return res.result;
    } catch (e) {
      console.log('云函数失败，降级本地');
    }
  }
  // 本地服务器模式
  const endpoint = (app && app.globalData && app.globalData.agent && app.globalData.agent.endpoint) || BASE_URL;
  return new Promise((resolve) => {
    wx.request({
      url: endpoint,
      method: 'POST',
      data: { action, ...params },
      success(r) { resolve(r.data || { success: false, error: 'empty response' }); },
      fail(err) { resolve({ success: false, error: err.errMsg || '网络错误' }); }
    });
  });
}

const api = {
  // ── 图片上传 ──
  uploadPhoto(filePath) {
    return new Promise((resolve) => {
      wx.uploadFile({
        url: UPLOAD_URL,
        filePath,
        name: 'photo',
        success(r) {
          try { resolve(JSON.parse(r.data)); }
          catch { resolve({ success: false, error: '解析失败' }); }
        },
        fail(err) { resolve({ success: false, error: err.errMsg }); }
      });
    });
  },

  // 获取完整图片 URL
  getPhotoUrl,

  // ── Agent 聊天 ──
  chat(message, history, nicknames) {
    return callAgent('chat', { message, history, ...nicknames });
  },

  // ── 成就 ──
  getAchievements() {
    return callAgent('get_achievements');
  },

  // ── 更新称呼 ──
  updateNicknames(nick1, nick2) {
    return callAgent('update_nicknames', { nick1, nick2 });
  },

  // ── 聊天历史 ──
  getChatHistory() {
    return callAgent('get_chat_history');
  },

  // ── 情侣档案 ──
  getProfile() {
    return callAgent('getProfile');
  },
  saveProfile(couple) {
    return callAgent('saveProfile', { couple });
  },

  // ── 约会记录 ──
  getDateRecords(params = {}) {
    return callAgent('search_date_records', params);
  },
  getDateRecord(recordId) {
    return callAgent('get_date_record', { recordId });
  },
  addDateRecord(record) {
    return callAgent('add_date_record', record);
  },

  // ── 愿望清单 ──
  getWishes(status = 'all') {
    return callAgent('get_wish_list', { status });
  },
  addWish(wish) {
    return callAgent('add_wish', wish);
  },
  updateWishStatus(wishId, status) {
    return callAgent('update_wish_status', { wishId, status });
  },

  // ── 心动瞬间 ──
  getMoments(limit = 30) {
    return callAgent('get_moments', { limit });
  },
  addMoment(moment) {
    return callAgent('add_moment', moment);
  },

  // ── 约定 ──
  getPromises(status = 'all') {
    return callAgent('get_promises', { status });
  },
  addPromise(promise) {
    return callAgent('add_promise', promise);
  },
  checkinPromise(promiseId) {
    return callAgent('checkin_promise', { promiseId });
  },

  // ── 报告 ──
  generateReport(type) {
    return callAgent('generate_love_report', { reportType: type });
  },
  listReports() {
    return callAgent('list_reports');
  },
  saveReport(report) {
    return callAgent('save_report', report);
  },

  // ── 今日问候 ──
  getTodayGreeting() {
    return callAgent('get_today_greeting');
  },

  // ── 新增：每日约会灵感 ──
  getDailyInspiration() {
    return callAgent('get_daily_inspiration');
  },

  // ── 新增：纪念日倒计时 ──
  getNextAnniversary(startDate) {
    return callAgent('get_next_anniversary', { startDate });
  },

  // ── 新增：吵架调解 ──
  mediateArgument(issue, side1, side2) {
    return callAgent('mediate_argument', { issue, side1, side2 });
  },

  // ── 新增：分享卡片 ──
  generateShareCard(type, content) {
    return callAgent('generate_share_card', { type, content });
  },

  // ── 软删除（移入回收站）──
  deleteDateRecord(recordId) {
    return callAgent('delete_date_record', { recordId });
  },
  deleteWish(wishId) {
    return callAgent('delete_wish', { wishId });
  },
  deleteMoment(momentId) {
    return callAgent('delete_moment', { momentId });
  },
  deletePromise(promiseId) {
    return callAgent('delete_promise', { promiseId });
  },

  // ── 回收站 ──
  getTrashList() {
    return callAgent('get_trash_list');
  },
  restoreRecord(recordId, recordType) {
    return callAgent('restore_record', { recordId, recordType });
  },
  emptyTrash() {
    return callAgent('empty_trash');
  },

  // ── 双向绑定 ──
  generateInviteCode() {
    return callAgent('generate_invite_code');
  },
  confirmBinding(inviteCode, confirmNick, clearHistory = false) {
    return callAgent('confirm_binding', { inviteCode, confirmNick, clearHistory });
  },
  getBindingStatus() {
    return callAgent('get_binding_status');
  },
  unbindRequest() {
    return callAgent('unbind_request');
  },
  confirmUnbind(confirmed, mode) {
    return callAgent('confirm_unbind', { confirmed, mode });
  },
  checkCleanSlate() {
    return callAgent('check_clean_slate');
  },
  clearArchivedData() {
    return callAgent('clear_archived_data');
  },

  // ── AI 调解（雷区3: 双向同意）──
  requestMediation(topic) {
    return callAgent('request_mediation', { topic });
  },
  confirmMediation(sessionId) {
    return callAgent('confirm_mediation', { sessionId });
  },

  // ── 通知状态 ──
  getNotificationState() {
    return callAgent('get_notification_state');
  },
  recordActivity() {
    return callAgent('record_activity');
  },

  // ── GPS 反向地理编码 ──
  reverseGeocode(latitude, longitude) {
    return callAgent('reverse_geocode', { latitude, longitude });
  },

  // ── 音乐列表 ──
  getMusicList() {
    return callAgent('get_music_list');
  },

  // ── 主动服务提醒 ──
  checkNudges() {
    return callAgent('check_nudges');
  },

  // ── 结构化记忆 ──
  getMemoryFacts() {
    return callAgent('get_memory_facts');
  },
};

module.exports = api;
