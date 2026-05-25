// ────────────────────────────────────
//  小爱 Agent 本地开发服务器 v2.3
//  + 安全熔断 + 软删除回收站 + 邀请码绑定 + 通知冷却
//  + 图片上传
// ────────────────────────────────────

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 静态文件服务
app.use('/music', express.static(path.join(__dirname, 'music')));
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// 文件上传配置
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'photo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY;
if (!DEEPSEEK_KEY) {
  console.error('⚠️  未设置 DEEPSEEK_KEY 环境变量！');
  console.error('   Windows: set DEEPSEEK_KEY=sk-xxx && node server.js');
  console.error('   或在 .env 文件中设置');
}
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';
const TRASH_RETENTION_DAYS = 30;
const MAX_GREETINGS_PER_DAY = 1;
const INACTIVE_COOLDOWN_DAYS = 3;

// ════════════════════════════════════
//  机制3: AI 安全熔断
// ════════════════════════════════════

const BLOCKED_INPUT = [
  /性交|做爱|上床|裸照|裸体|色情|淫秽|约炮|一夜情|嫖|娼/,
  /自杀|自残|割腕|跳楼|上吊|安眠药.*死|不想活/,
  /炸药|炸弹|枪支|买枪|恐怖袭击|杀人/,
  /习近平|李克强|共产党|六四|天安门|法轮|藏独|台独|疆独|港独/,
  /翻墙|VPN.*推荐|科学上网.*推荐|破解|盗版.*下载/,
  /分手.*吧|离婚.*吧|别.*在一起|不值得.*爱/,
  /虐待|家暴|殴打|暴力.*对方/,
];

const BLOCKED_OUTPUT = [
  /性交|做爱|自慰|口交|肛交|裸体|色情|淫秽/,
  /自杀|自残|割腕|跳楼|上吊|去死|不想活/,
  /习近平|李克强|共产党|六四|天安门|法轮|藏独|台独|疆独|港独/,
  /翻墙|VPN|科学上网|破解|盗版/,
  /分手吧|离婚吧|别在一起了|不值得.*爱|放弃.*感情/,
  /虐待|家暴|殴打/,
];

const SAFE_FALLBACK = {
  severe: '这个话题涉及到一些我不太了解的领域 🌝 我们换个方式聊？比如最近的约会计划？',
  relationship: '每段感情都会有起伏，但我不建议轻易放弃 💕 如果愿意，可以和我聊聊你们的困惑，我会温柔地倾听。',
  sensitive: '这个话题有点敏感呢 🌸 不如我们聊聊今天的心情，或者想一起做的事？',
};

function safetyCheckInput(text) {
  if (!text) return { safe: true };
  for (const pattern of BLOCKED_INPUT) {
    if (pattern.test(text)) {
      console.log('🔒 输入被拦截:', pattern.source.slice(0, 20));
      return { safe: false, reason: 'content_blocked' };
    }
  }
  return { safe: true };
}

function safetyCheckOutput(text) {
  if (!text) return { safe: true, text };
  let result = text;
  let blocked = false;

  for (const pattern of BLOCKED_OUTPUT) {
    if (pattern.test(result)) {
      console.log('🔒 输出被拦截:', pattern.source.slice(0, 20));
      blocked = true;
      result = result.replace(pattern, '***');
    }
  }

  if (blocked) {
    // Check severity to choose fallback
    if (/分手|离婚|放弃.*感情/.test(text)) {
      result = SAFE_FALLBACK.relationship;
    } else if (/自杀|自残|去死|不想活/.test(text)) {
      result = SAFE_FALLBACK.severe;
    } else {
      result = SAFE_FALLBACK.sensitive;
    }
  }

  return { safe: !blocked, text: result, wasFiltered: blocked };
}

function getSafetyFallback(text) {
  if (/分手|离婚|放弃/.test(text)) return SAFE_FALLBACK.relationship;
  if (/自杀|自残|死/.test(text)) return SAFE_FALLBACK.severe;
  return SAFE_FALLBACK.sensitive;
}

// ════════════════════════════════════
//  工具函数
// ════════════════════════════════════

function cleanReply(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isNotDeleted(item) {
  return !item || !item._deletedAt;
}

function nowISO() {
  return new Date().toISOString();
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

// ════════════════════════════════════
//  内存数据库
// ════════════════════════════════════

const DB = {
  couple: null,  // { name1, name2, startDate, city, ... }
  dateRecords: [],
  wishes: [],
  moments: [],
  promises: [],
  chatHistory: [],
  reports: [],
  greetings: [],
  // 机制1: 双向绑定
  inviteCodes: {},     // { code: { createdAt, usedBy, bound } }
  binding: null,       // { partner1, partner2, boundAt, status }
  // 机制4: 通知状态
  notificationState: {
    lastActiveDate: new Date().toISOString().slice(0, 10),
    greetingSentToday: 0,
    reportSentThisWeek: false,
    consecutiveInactiveDays: 0,
  },
  // 雷区3: AI调解会话
  mediationSessions: {},  // { sessionId: { createdAt, status, confirmedBy, ... } }
  // 结构化长期记忆
  memoryFacts: [],        // [{ fact, category, keyword, createdAt }]
  // 安全日志
  safetyLog: [],
  idSeq: 0,
};

function nextId() { return 'local_' + (++DB.idSeq); }

// ════════════════════════════════════
//  业务处理
// ════════════════════════════════════

const handlers = {

  // ── 聊天（带安全检测）──
  async chat({ message, history, nick1, nick2 }) {
    // 输入安全检查
    const inputCheck = safetyCheckInput(message);
    if (!inputCheck.safe) {
      DB.safetyLog.push({ type: 'input_blocked', content: message.slice(0, 100), time: Date.now() });
      DB.chatHistory.push({ role: 'user', content: '[消息已过滤]', time: Date.now() });
      DB.chatHistory.push({ role: 'assistant', content: SAFE_FALLBACK.sensitive, time: Date.now() });
      return { success: true, reply: SAFE_FALLBACK.sensitive, toolCalls: 0, safetyFiltered: true };
    }

    DB.chatHistory.push({ role: 'user', content: message, time: Date.now() });
    const result = await agentLoop(message, history || [], {
      nick1: nick1 || DB.nick1,
      nick2: nick2 || DB.nick2,
    });

    // 输出安全检查
    const outputCheck = safetyCheckOutput(result.reply);
    if (outputCheck.wasFiltered) {
      DB.safetyLog.push({ type: 'output_filtered', original: result.reply.slice(0, 100), time: Date.now() });
      result.reply = outputCheck.text;
    }

    return result;
  },

  // ── 情侣档案 ──
  getProfile() {
    return { success: true, profile: DB.couple || null };
  },

  saveProfile({ couple }) {
    DB.couple = couple;
    return { success: true, message: '已保存' };
  },

  // ── GPS 反向地理编码 ──
  async reverse_geocode({ latitude, longitude }) {
    if (!latitude || !longitude) return { success: false, error: '缺少经纬度' };
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&accept-language=zh`;
      const res = await fetch(url, { headers: { 'User-Agent': 'LoveAIMiniApp/2.1' } });
      if (!res.ok) throw new Error('geocode failed');
      const data = await res.json();
      const addr = data.address || {};
      return {
        success: true,
        display: addr.city || addr.town || addr.county || addr.state || '未知城市',
        full: {
          country: addr.country || '',
          province: addr.state || addr.province || '',
          city: addr.city || addr.town || addr.county || '',
          district: addr.county || addr.district || addr.town || '',
        },
        raw: data.display_name || '',
      };
    } catch (e) {
      return { success: false, error: '定位解析失败，请手动选择城市' };
    }
  },

  // ── 约会记录（过滤已删除）──
  search_date_records({ keyword, limit = 20, includeDeleted }) {
    let records = [...DB.dateRecords].reverse();
    if (!includeDeleted) records = records.filter(isNotDeleted);
    if (keyword) {
      const kw = keyword.toLowerCase();
      records = records.filter(r =>
        (r.location || '').toLowerCase().includes(kw) ||
        (r.activity || '').toLowerCase().includes(kw) ||
        (r.notes || '').toLowerCase().includes(kw)
      );
    }
    return { success: true, data: records.slice(0, limit) };
  },

  add_date_record(args) {
    const record = {
      _id: nextId(), ...args,
      mood: args.mood || '甜蜜',
      photos: args.photos || [],
      createdAt: Date.now(),
    };
    DB.dateRecords.push(record);
    return { success: true, data: record, message: '约会已保存' };
  },

  get_date_record({ recordId }) {
    const r = DB.dateRecords.find(r => r._id === recordId && isNotDeleted(r));
    if (!r) return { success: false, error: '记录不存在' };
    return { success: true, data: r };
  },

  // 软删除约会
  delete_date_record({ recordId }) {
    const r = DB.dateRecords.find(r => r._id === recordId);
    if (!r) return { success: false, error: '记录不存在' };
    r._deletedAt = Date.now();
    return { success: true, message: '已移入回收站，30天内可恢复' };
  },

  // ── 愿望清单（过滤已删除）──
  get_wish_list({ status = 'all', includeDeleted }) {
    let wishes = [...DB.wishes].reverse();
    if (!includeDeleted) wishes = wishes.filter(isNotDeleted);
    if (status !== 'all') wishes = wishes.filter(w => w.status === status);
    return { success: true, data: wishes };
  },

  add_wish(args) {
    const wish = {
      _id: nextId(), title: args.title,
      description: args.description || '',
      category: args.category || '其他',
      status: 'pending', createdAt: Date.now(), aiTip: '',
    };
    DB.wishes.push(wish);
    return { success: true, data: wish, message: '愿望已加入' };
  },

  update_wish_status({ wishId, status }) {
    const w = DB.wishes.find(w => w._id === wishId);
    if (w) w.status = status;
    return { success: true };
  },

  delete_wish({ wishId }) {
    const w = DB.wishes.find(w => w._id === wishId);
    if (!w) return { success: false, error: '愿望不存在' };
    w._deletedAt = Date.now();
    return { success: true, message: '已移入回收站' };
  },

  // ── 心动瞬间（过滤已删除）──
  get_moments({ limit = 30, includeDeleted }) {
    let moments = [...DB.moments].reverse();
    if (!includeDeleted) moments = moments.filter(isNotDeleted);
    return { success: true, data: moments.slice(0, limit) };
  },

  add_moment(args) {
    const m = {
      _id: nextId(), content: args.content,
      date: args.date || new Date().toISOString().slice(0, 10),
      mood: args.mood || '🥰', tags: args.tags || [],
      createdAt: Date.now(),
    };
    DB.moments.push(m);
    return { success: true, data: m, message: '瞬间已珍藏' };
  },

  delete_moment({ momentId }) {
    const m = DB.moments.find(m => m._id === momentId);
    if (!m) return { success: false, error: '瞬间不存在' };
    m._deletedAt = Date.now();
    return { success: true, message: '已移入回收站' };
  },

  // ── 约定（过滤已删除）──
  get_promises({ status = 'all', includeDeleted }) {
    let ps = [...DB.promises].reverse();
    if (!includeDeleted) ps = ps.filter(isNotDeleted);
    if (status !== 'all') ps = ps.filter(p => p.status === status);
    return { success: true, data: ps };
  },

  add_promise(args) {
    const p = {
      _id: nextId(), title: args.title,
      content: args.content || '',
      frequency: args.frequency || '随时',
      status: 'active', streak: 0, checkins: [],
      createdAt: Date.now(),
    };
    DB.promises.push(p);
    return { success: true, data: p, message: '约定已立' };
  },

  checkin_promise({ promiseId }) {
    const p = DB.promises.find(p => p._id === promiseId && isNotDeleted(p));
    if (!p) return { success: false, error: '约定不存在' };
    p.streak = (p.streak || 0) + 1;
    p.checkins = p.checkins || [];
    p.checkins.push({ date: new Date().toISOString().slice(0, 10), time: Date.now() });
    return { success: true, streak: p.streak, message: '打卡成功' };
  },

  delete_promise({ promiseId }) {
    const p = DB.promises.find(p => p._id === promiseId);
    if (!p) return { success: false, error: '约定不存在' };
    p._deletedAt = Date.now();
    return { success: true, message: '已移入回收站' };
  },

  // ════════════════════════════════════
  //  机制5: 回收站
  // ════════════════════════════════════

  get_trash_list() {
    const cutoff = Date.now() - TRASH_RETENTION_DAYS * 86400000;
    const collectDeleted = (arr, type) =>
      arr
        .filter(item => item._deletedAt && item._deletedAt > cutoff)
        .map(item => ({ ...item, _recordType: type }));

    const trash = [
      ...collectDeleted(DB.dateRecords, 'date'),
      ...collectDeleted(DB.wishes, 'wish'),
      ...collectDeleted(DB.moments, 'moment'),
      ...collectDeleted(DB.promises, 'promise'),
    ].sort((a, b) => b._deletedAt - a._deletedAt);

    // 自动清理过期项
    const expired = [
      ...DB.dateRecords.filter(r => r._deletedAt && r._deletedAt <= cutoff),
      ...DB.wishes.filter(w => w._deletedAt && w._deletedAt <= cutoff),
      ...DB.moments.filter(m => m._deletedAt && m._deletedAt <= cutoff),
      ...DB.promises.filter(p => p._deletedAt && p._deletedAt <= cutoff),
    ];

    return {
      success: true,
      data: trash,
      expiredCleaned: expired.length,
      retentionDays: TRASH_RETENTION_DAYS,
    };
  },

  restore_record({ recordId, recordType }) {
    const map = { date: DB.dateRecords, wish: DB.wishes, moment: DB.moments, promise: DB.promises };
    const arr = map[recordType];
    if (!arr) return { success: false, error: '类型错误' };

    const item = arr.find(i => i._id === recordId);
    if (!item) return { success: false, error: '记录不存在' };
    if (!item._deletedAt) return { success: false, error: '该记录不在回收站' };

    delete item._deletedAt;
    return { success: true, message: '已恢复', data: item };
  },

  empty_trash() {
    const cutoffMs = Date.now() - TRASH_RETENTION_DAYS * 86400000;
    let cleaned = 0;

    DB.dateRecords = DB.dateRecords.filter(item => {
      const keep = !item._deletedAt || item._deletedAt > cutoffMs;
      if (!keep) cleaned++;
      return keep;
    });
    DB.wishes = DB.wishes.filter(item => {
      const keep = !item._deletedAt || item._deletedAt > cutoffMs;
      if (!keep) cleaned++;
      return keep;
    });
    DB.moments = DB.moments.filter(item => {
      const keep = !item._deletedAt || item._deletedAt > cutoffMs;
      if (!keep) cleaned++;
      return keep;
    });
    DB.promises = DB.promises.filter(item => {
      const keep = !item._deletedAt || item._deletedAt > cutoffMs;
      if (!keep) cleaned++;
      return keep;
    });

    return { success: true, message: `已清理 ${cleaned} 条过期记录` };
  },

  // ════════════════════════════════════
  //  机制1: 双向确认锁
  // ════════════════════════════════════

  generate_invite_code() {
    const code = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6位码
    DB.inviteCodes[code] = {
      code,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 3600000, // 24小时过期
      used: false,
    };
    return { success: true, inviteCode: code, expiresIn: '24小时' };
  },

  confirm_binding({ inviteCode, confirmNick, clearHistory }) {
    const entry = DB.inviteCodes[inviteCode];
    if (!entry) return { success: false, error: '邀请码无效' };
    if (entry.used) return { success: false, error: '该邀请码已被使用' };
    if (Date.now() > entry.expiresAt) return { success: false, error: '邀请码已过期，请重新生成' };

    // 雷区1: 检测是否有前任残留数据
    const archivedCount = [
      ...DB.dateRecords.filter(r => r._era === 'archived'),
      ...DB.wishes.filter(w => w._era === 'archived'),
      ...DB.moments.filter(m => m._era === 'archived'),
    ].length;

    if (archivedCount > 0 && !clearHistory) {
      return {
        success: false,
        needConfirm: true,
        historyCount: archivedCount,
        error: `检测到 ${archivedCount} 条与前任的历史记录。请确认是否清空后再绑定。`,
      };
    }

    // 清空历史
    if (clearHistory && archivedCount > 0) {
      DB.dateRecords = DB.dateRecords.filter(r => r._era !== 'archived');
      DB.wishes = DB.wishes.filter(w => w._era !== 'archived');
      DB.moments = DB.moments.filter(m => m._era !== 'archived');
      DB.promises = DB.promises.filter(p => p._era !== 'archived');
      DB.chatHistory = DB.chatHistory.filter(m => m._era !== 'archived');
    }

    entry.used = true;
    entry.confirmedAt = Date.now();
    entry.partnerNick = confirmNick || 'TA';

    DB.binding = {
      code: inviteCode,
      boundAt: Date.now(),
      status: 'active',
      partnerNick: confirmNick || 'TA',
    };

    return { success: true, message: '绑定成功！你们的关系已确认 💕', binding: DB.binding, clearedHistory: clearHistory && archivedCount > 0 };
  },

  get_binding_status() {
    return {
      success: true,
      bound: !!DB.binding,
      binding: DB.binding || null,
    };
  },

  unbind_request() {
    if (!DB.binding) return { success: false, error: '尚未绑定' };
    DB.binding.unbindRequestedAt = Date.now();
    DB.binding.unbindStatus = 'pending';
    return {
      success: true,
      message: '解绑请求已提交，对方有24小时反悔期',
      coolingPeriod: '24小时',
    };
  },

  confirm_unbind({ confirmed, mode }) {
    if (!DB.binding) return { success: false, error: '无绑定关系' };
    if (!confirmed) {
      delete DB.binding.unbindRequestedAt;
      delete DB.binding.unbindStatus;
      return { success: true, message: '已取消解绑，继续在一起 💕' };
    }

    // 雷区1: 分手数据处理 — mode: 'keep_copy' 保留个人副本, 'delete_all' 彻底清空
    const endedAt = Date.now();
    const archiveMark = (item) => {
      item._era = 'archived';
      item._relationshipEndedAt = endedAt;
    };

    if (mode === 'keep_copy') {
      // 给所有共享记录打上「已结束」标签，保留为个人回忆
      DB.dateRecords.forEach(archiveMark);
      DB.wishes.forEach(archiveMark);
      DB.moments.forEach(archiveMark);
      DB.promises.forEach(archiveMark);
      DB.chatHistory.forEach(m => { m._era = 'archived'; });
    } else {
      // delete_all: 彻底清空所有记录
      DB.dateRecords = [];
      DB.wishes = [];
      DB.moments = [];
      DB.promises = [];
      DB.chatHistory = [];
    }

    DB.binding.status = 'unbound';
    DB.binding.unboundAt = endedAt;
    DB.binding.archiveMode = mode;
    return {
      success: true,
      message: mode === 'keep_copy'
        ? '已解绑。你的回忆已保留为个人副本 💕'
        : '已解绑，所有数据已清空',
      archived: mode === 'keep_copy',
    };
  },

  // 雷区1: 重新绑定前检测是否有前任残留数据
  check_clean_slate() {
    const hasArchived = DB.dateRecords.some(r => r._era === 'archived')
      || DB.wishes.some(w => w._era === 'archived')
      || DB.moments.some(m => m._era === 'archived');
    const count = [
      ...DB.dateRecords.filter(r => r._era === 'archived'),
      ...DB.wishes.filter(w => w._era === 'archived'),
      ...DB.moments.filter(m => m._era === 'archived'),
      ...DB.promises.filter(p => p._era === 'archived'),
    ].length;
    return {
      success: true,
      hasHistory: hasArchived,
      historyCount: count,
      previousEndedAt: DB.binding ? DB.binding.unboundAt : null,
    };
  },

  // 雷区1: 清除所有归档数据（重新开始）
  clear_archived_data() {
    DB.dateRecords = DB.dateRecords.filter(r => r._era !== 'archived');
    DB.wishes = DB.wishes.filter(w => w._era !== 'archived');
    DB.moments = DB.moments.filter(m => m._era !== 'archived');
    DB.promises = DB.promises.filter(p => p._era !== 'archived');
    DB.chatHistory = DB.chatHistory.filter(m => m._era !== 'archived');
    return { success: true, message: '已清空所有历史记录，可以重新开始了 💕' };
  },

  // ════════════════════════════════════
  //  机制4: 通知频率锁
  // ════════════════════════════════════

  get_notification_state() {
    return {
      success: true,
      state: DB.notificationState,
      canSendGreeting: DB.notificationState.greetingSentToday < MAX_GREETINGS_PER_DAY,
      isInCooldown: DB.notificationState.consecutiveInactiveDays >= INACTIVE_COOLDOWN_DAYS,
    };
  },

  record_activity() {
    const today = new Date().toISOString().slice(0, 10);
    const lastActive = DB.notificationState.lastActiveDate;
    if (today !== lastActive) {
      const diff = Math.floor((new Date(today) - new Date(lastActive)) / 86400000);
      if (diff > 1) {
        DB.notificationState.consecutiveInactiveDays += diff - 1;
      } else {
        DB.notificationState.consecutiveInactiveDays = 0;
      }
      DB.notificationState.lastActiveDate = today;
      DB.notificationState.greetingSentToday = 0;
      DB.notificationState.reportSentThisWeek = false;
    }
    return { success: true, state: DB.notificationState };
  },

  // ── 聊天历史 ──
  get_chat_history() {
    return { success: true, data: [...DB.chatHistory].reverse().slice(0, 50).reverse() };
  },

  // ── 今日问候 ──
  get_today_greeting() {
    const today = new Date().toISOString().slice(0, 10);
    const g = DB.greetings.find(g => g.date === today);
    return { success: true, content: g ? g.content : '' };
  },

  // ── 恋爱报告 ──
  generate_love_report({ reportType }) {
    const now = new Date();
    let start;
    if (reportType === 'week') start = new Date(now - 7 * 864e5);
    else if (reportType === 'month') start = new Date(now - 30 * 864e5);
    else start = new Date(now - 365 * 864e5);
    const end = now.toISOString().slice(0, 10);
    const s = start.toISOString().slice(0, 10);

    const dates = DB.dateRecords.filter(r => r.date >= s && r.date <= end && isNotDeleted(r));
    const moments = DB.moments.filter(m => m.date >= s && m.date <= end && isNotDeleted(m));

    return {
      success: true, reportType, startDate: s, endDate: end,
      totalDates: dates.length, totalMoments: moments.length,
      dates, moments, promises: DB.promises.filter(isNotDeleted),
    };
  },

  save_report({ type, startDate, endDate, content, stats }) {
    const report = {
      _id: nextId(),
      type: type || 'week',
      startDate: startDate || '',
      endDate: endDate || '',
      content: content || '',
      stats: stats || {},
      createdAt: Date.now(),
    };
    DB.reports.push(report);
    return { success: true, data: report };
  },

  list_reports() {
    return { success: true, reports: [...DB.reports].reverse() };
  },

  // ── 每日约会灵感 ──
  async get_daily_inspiration() {
    const today = new Date().toISOString().slice(0, 10);
    const recentDates = DB.dateRecords.filter(isNotDeleted).slice(-5);
    const pendingWishes = DB.wishes.filter(w => w.status === 'pending' && isNotDeleted(w)).slice(0, 3);

    const prompt = `今天是${today}。请为这对情侣推荐一个今日约会小灵感。
最近约会：${JSON.stringify(recentDates)}
待实现愿望：${JSON.stringify(pendingWishes)}
要求：根据他们的历史和愿望，推荐一个具体、可执行的小约会想法。30-60字，温暖可爱语气，带1个emoji。不要用Markdown符号。`;

    const messages = [
      { role: 'system', content: '你是小爱，一对情侣的AI伴侣。回复简洁温暖，不用Markdown。' },
      { role: 'user', content: prompt },
    ];
    try {
      const response = await callDeepSeek(messages);
      const raw = response.content || '今天适合一起散个步，牵着手说说最近的趣事 🌸';
      const clean = cleanReply(raw);
      const checked = safetyCheckOutput(clean);
      return { success: true, inspiration: checked.text, date: today };
    } catch {
      return { success: true, inspiration: '今天适合一起散个步，牵着手说说最近的趣事 🌸', date: today };
    }
  },

  // ── 纪念日倒计时 ──
  get_next_anniversary({ startDate }) {
    if (!startDate && DB.couple) startDate = DB.couple.startDate;
    if (!startDate) return { success: true, daysLeft: -1, label: '请先设置纪念日' };

    const start = new Date(startDate);
    const now = new Date();
    const daysTogether = Math.floor((now - start) / 86400000);

    const milestones = [100, 200, 300, 365, 500, 520, 600, 700, 730, 800, 900, 999, 1000, 1314];
    let nextMilestone = null;
    for (const m of milestones) {
      if (m > daysTogether) { nextMilestone = m; break; }
    }
    if (!nextMilestone) nextMilestone = Math.ceil(daysTogether / 100) * 100 + 100;

    const daysLeft = nextMilestone - daysTogether;
    const targetDate = new Date(now.getTime() + daysLeft * 86400000);

    return {
      success: true, daysTogether, nextMilestone, daysLeft,
      targetDate: targetDate.toISOString().slice(0, 10),
      label: `${nextMilestone}天纪念日`,
    };
  },

  // 雷区3: 发起调解请求 — A点击，生成会话
  request_mediation({ topic }) {
    if (!DB.binding || DB.binding.status !== 'active') {
      return { success: false, error: '需要先绑定关系才能使用调解功能' };
    }
    const sessionId = 'med_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    DB.mediationSessions[sessionId] = {
      sessionId,
      topic: topic || '一些小矛盾',
      createdAt: Date.now(),
      status: 'requested',     // requested → confirmed → completed
      requestedAt: Date.now(),
    };
    return { success: true, sessionId, message: '调解请求已发送，等待对方确认' };
  },

  // 雷区3: 确认调解 — B点击同意
  confirm_mediation({ sessionId }) {
    const session = DB.mediationSessions[sessionId];
    if (!session) return { success: false, error: '调解会话不存在或已过期' };
    if (session.status === 'completed') return { success: false, error: '该调解已完成' };
    if (session.status === 'confirmed') return { success: true, sessionId, message: '已确认，可以开始调解' };

    session.status = 'confirmed';
    session.confirmedAt = Date.now();
    return { success: true, sessionId, message: '双方已同意调解，AI将开始介入 🤝' };
  },

  // ── AI 吵架调解（雷区3: 需双方确认后才可用）──
  async mediate_argument({ issue, side1, side2, sessionId }) {
    // 检查调解会话是否已被双方确认
    if (sessionId) {
      const session = DB.mediationSessions[sessionId];
      if (!session) return { success: false, error: '调解会话不存在' };
      if (session.status !== 'confirmed') {
        return { success: false, error: '调解需要双方都同意才能进行。请先让对方确认调解请求。' };
      }
    }
    // 没有 sessionId 说明是初次对话，不拒绝但降级为温和回应

    const inputCheck = safetyCheckInput(issue || '');
    if (!inputCheck.safe) {
      return { success: false, error: '请用温和的语言描述问题', safetyFiltered: true };
    }

    const prompt = `一对情侣遇到了矛盾。
${side1 || '一方'}的感受：${issue || '没有具体说明'}
${side2 ? '另一方的感受：' + side2 : ''}

⚠️ 重要规则（不可违反）：
1. 绝对不归因、不评判谁对谁错、不分析责任比例
2. 不可以说"你应该…"或"你做得不对…"
3. 你的角色是共情翻译官——帮双方把情绪翻译成对方能听懂的话
4. 先分别共情双方的感受，再给一个温和的行动建议
5. 绝不说"你们可能不合适""分手也许是更好的选择"等词汇
6. 全程用"我们"视角，不用"你"指责

请按这个结构回复：
1. 共情开场（1-2句，不站队）
2. 帮A说出TA可能没说出口的感受（1-2句）
3. 帮B说出TA可能没说出口的感受（1-2句）
4. 一个具体的缓和行动建议（1句，温和可执行）
总共100-150字。不用Markdown符号。`;

    const messages = [
      { role: 'system', content: '你是小爱，一对情侣的情感翻译官。你永远不评判对错，只帮双方把情绪翻译成对方能听懂的语言。语气像温柔的闺蜜，不偏袒任何人。绝对不说分手、放弃之类的话。不用Markdown。' },
      { role: 'user', content: prompt },
    ];
    try {
      const response = await callDeepSeek(messages);
      const raw = response.content || '每对情侣都会有摩擦，重要的是彼此理解 💕 要不要先停下来，各退一步，给对方一个拥抱？';
      const clean = cleanReply(raw);
      const checked = safetyCheckOutput(clean);
      // 标记完成
      if (sessionId && DB.mediationSessions[sessionId]) {
        DB.mediationSessions[sessionId].status = 'completed';
      }
      return { success: true, advice: checked.text };
    } catch {
      return { success: true, advice: '每对情侣都会有摩擦，重要的是彼此理解 💕 要不要先停下来，各退一步，给对方一个拥抱？' };
    }
  },

  // ── 分享卡片 ──
  async generate_share_card({ type = 'report', content }) {
    if (type === 'report') {
      const dates = DB.dateRecords.filter(isNotDeleted).slice(-10);
      const moments = DB.moments.filter(isNotDeleted).slice(-10);
      const coupleName = DB.couple ? `${DB.couple.name1} & ${DB.couple.name2}` : '我们';

      const prompt = `请为这对情侣生成一张可以发朋友圈的恋爱分享卡片文案：
情侣：${coupleName}
最近约会：${JSON.stringify(dates)}
心动瞬间：${JSON.stringify(moments)}

要求：一段温暖有爱的文字，适合配图发朋友圈。80-120字。风格：温暖文艺。带2-3个emoji。不用Markdown符号。`;

      const messages = [
        { role: 'system', content: '你是一个恋爱文案写手，温暖文艺风格。不用Markdown。' },
        { role: 'user', content: prompt },
      ];
      const response = await callDeepSeek(messages);
      const raw = response.content || '';
      const clean = cleanReply(raw);
      const checked = safetyCheckOutput(clean);
      return { success: true, cardText: checked.text };
    }

    const inputCheck = safetyCheckInput(content || '');
    if (!inputCheck.safe) {
      return { success: false, error: '内容不适合生成分享卡片', safetyFiltered: true };
    }

    const prompt2 = `把这个内容改编成适合发朋友圈的温暖文案，50-80字，加emoji。内容：${content}`;
    const response2 = await callDeepSeek([
      { role: 'system', content: '你是恋爱文案写手，温暖文艺。不用Markdown。' },
      { role: 'user', content: prompt2 },
    ]);
    const raw2 = response2.content || '';
    const clean2 = cleanReply(raw2);
    const checked2 = safetyCheckOutput(clean2);
    return { success: true, cardText: checked2.text };
  },

  // ── AI 称呼 ──
  update_nicknames({ nick1, nick2 }) {
    if (nick1) DB.nick1 = nick1;
    if (nick2) DB.nick2 = nick2;
    return { success: true, nick1: DB.nick1, nick2: DB.nick2 };
  },

  // ── 成就（雷区2: 里程碑事件型，不刷次数）──
  get_achievements() {
    const dates = DB.dateRecords.filter(isNotDeleted);
    const wishes = DB.wishes.filter(isNotDeleted);
    const moments = DB.moments.filter(isNotDeleted);
    const startDate = DB.couple ? DB.couple.startDate : null;
    const daysTogether = startDate ? Math.floor((Date.now() - new Date(startDate)) / 86400000) : 0;

    // 检测里程碑事件
    const hasFirstDate = dates.length > 0;
    const hasFirstWish = wishes.length > 0;
    const hasFirstMoment = moments.length > 0;

    // 第一次和解：有过吵架 mood 且之后还有约会记录
    const conflictIdx = dates.findIndex(d => d.mood === '吵架');
    const hasReconciliation = conflictIdx >= 0 && conflictIdx < dates.length - 1;

    // 第一次旅行：location 不在本城市（和 couple.city 不同）
    const homeCity = DB.couple ? (DB.couple.city || '') : '';
    const hasTravel = dates.some(d => {
      const loc = (d.location || '').toLowerCase();
      const home = homeCity.toLowerCase();
      const travelWords = ['旅行', '旅游', '出差', '出游', '外地'];
      return loc && !loc.includes(home) || travelWords.some(w => (d.activity || '').includes(w));
    });

    // 见家长
    const hasMeetParents = dates.some(d => {
      const text = ((d.activity || '') + (d.notes || '')).toLowerCase();
      return ['家长', '父母', '爸妈', '爸爸', '妈妈', '见家长', '上门', '提亲'].some(w => text.includes(w));
    });

    const achievements = [
      { id: 'first_date', icon: '🌸', name: '初遇时刻', desc: '记录了你们的第一次约会', unlocked: hasFirstDate, progress: hasFirstDate ? 1 : 0, target: 1 },
      { id: 'first_wish', icon: '✨', name: '心心相印', desc: '一起写下第一个共同愿望', unlocked: hasFirstWish, progress: hasFirstWish ? 1 : 0, target: 1 },
      { id: 'first_moment', icon: '💝', name: '心动定格', desc: '珍藏了第一个心动瞬间', unlocked: hasFirstMoment, progress: hasFirstMoment ? 1 : 0, target: 1 },
      { id: 'reconcile', icon: '🕊️', name: '和好如初', desc: '经历争吵后依然选择彼此', unlocked: hasReconciliation, progress: hasReconciliation ? 1 : 0, target: 1 },
      { id: 'travel', icon: '✈️', name: '说走就走', desc: '一起去过一次远方的旅行', unlocked: hasTravel, progress: hasTravel ? 1 : 0, target: 1 },
      { id: 'parents', icon: '🏠', name: '重要的相见', desc: '把对方介绍给了最重要的人', unlocked: hasMeetParents, progress: hasMeetParents ? 1 : 0, target: 1 },
      { id: 'hundays', icon: '💯', name: '百天纪念', desc: '一起走过了 100 个日夜', unlocked: daysTogether >= 100, progress: Math.min(daysTogether, 100), target: 100 },
      { id: 'oneyear', icon: '🎂', name: '周年之约', desc: '一起度过了第一个春夏秋冬', unlocked: daysTogether >= 365, progress: Math.min(daysTogether, 365), target: 365 },
      { id: 'thousand', icon: '👑', name: '千年之恋', desc: '每个一千天都是一部史诗', unlocked: daysTogether >= 1000, progress: Math.min(daysTogether, 1000), target: 1000 },
    ];

    const unlocked = achievements.filter(a => a.unlocked).length;
    return { success: true, achievements, unlocked, total: achievements.length };
  },

  // ── 音乐列表 ──
  get_music_list() {
    return {
      success: true,
      data: [
        { id: 'bgm1', name: '暖心钢琴', src: '/music/bgm1_piano.wav', icon: '🎹' },
        { id: 'bgm2', name: '浮游氛围', src: '/music/bgm2_ambient.wav', icon: '🌊' },
        { id: 'bgm3', name: '轻柔律动', src: '/music/bgm3_lofi.wav', icon: '🎵' },
      ],
    };
  },

  // ── AI 工具：生成祝福语 ──
  generate_blessing({ occasion, style = '温馨' }) {
    return { success: true, occasion, style, instruction: `请为"${occasion}"生成一段${style}风格的祝福语，100-200字，温暖感人。` };
  },

  // ── AI 工具：策划约会 ──
  plan_date({ date, budget = '适中', vibe = '浪漫' }) {
    const dates = DB.dateRecords.filter(r => !r._deletedAt && r._era !== 'archived').slice(-10);
    const wishes = DB.wishes.filter(w => !w._deletedAt && w._era !== 'archived' && w.status === 'pending').slice(0, 5);
    return {
      success: true,
      plannedDate: date || '待定',
      budget, vibe,
      historyDates: dates,
      pendingWishes: wishes,
      instruction: '请根据以上信息（历史约会偏好、未完成的愿望、预算和氛围要求），为这对情侣策划一个完整的约会方案。200-400字。',
    };
  },

  // ── 结构化记忆 ──
  get_memory_facts() {
    return { success: true, data: DB.memoryFacts || [] };
  },

  // ── 安全日志（调试用）──
  get_safety_log({ limit = 20 }) {
    return { success: true, data: [...DB.safetyLog].reverse().slice(0, limit) };
  },

  // ── 主动服务：检查用户是否需要提醒/建议 ──
  check_nudges() {
    const nudges = [];
    const now = Date.now();
    const DAY = 86400000;

    // 1. 约会间隔提醒（超过14天没约会）
    const activeDates = DB.dateRecords
      .filter(r => !r._deletedAt && r._era !== 'archived')
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    if (activeDates.length > 0) {
      const lastDate = new Date(activeDates[0].date);
      const gapDays = Math.floor((now - lastDate.getTime()) / DAY);
      if (gapDays >= 14) {
        nudges.push({
          type: 'date_gap',
          icon: '📅',
          message: `你们已经 ${gapDays} 天没约会了，要不要我帮你们策划一个？`,
          action: 'plan_date',
          priority: 'high',
        });
      } else if (gapDays >= 7) {
        nudges.push({
          type: 'date_gap',
          icon: '💡',
          message: `距离上次约会已经 ${gapDays} 天了，这周末要不要安排点什么？`,
          action: 'plan_date',
          priority: 'medium',
        });
      }
    } else {
      nudges.push({
        type: 'first_date',
        icon: '🎉',
        message: '你们还没有约会记录呢！要不要现在就策划第一次约会？',
        action: 'plan_date',
        priority: 'high',
      });
    }

    // 2. 愿望积压提醒
    const pendingWishes = DB.wishes.filter(w => !w._deletedAt && w._era !== 'archived' && w.status === 'pending');
    if (pendingWishes.length >= 3) {
      nudges.push({
        type: 'wish_backlog',
        icon: '✨',
        message: `你们有 ${pendingWishes.length} 个愿望还没实现，要不要挑一个这周去做？`,
        action: 'view_wishes',
        priority: pendingWishes.length >= 5 ? 'high' : 'medium',
      });
    }

    // 3. 纪念日提醒（3天内）
    const today = new Date();
    const startDate = DB.couple && DB.couple.startDate;
    if (startDate) {
      const start = new Date(startDate);
      const daysTogether = Math.floor((now - start.getTime()) / DAY);
      const milestones = [100, 200, 300, 365, 500, 666, 730, 888, 999, 1000, 1314];
      for (const m of milestones) {
        const daysUntil = m - daysTogether;
        if (daysUntil > 0 && daysUntil <= 3) {
          nudges.push({
            type: 'anniversary',
            icon: '🎯',
            message: `还有 ${daysUntil} 天就是你们在一起的 ${m} 天纪念日！要不要准备惊喜？`,
            action: 'plan_surprise',
            priority: 'high',
          });
          break;
        }
      }
    }

    // 4. 约定检查（有约定但超过7天没打卡）
    const activePromises = DB.promises.filter(p => !p._deletedAt && p._era !== 'archived' && p.status === 'active');
    if (activePromises.length > 0) {
      const hasRecentCheckin = activePromises.some(p => {
        if (!p.lastCheckinAt) return false;
        return (now - new Date(p.lastCheckinAt).getTime()) < 7 * DAY;
      });
      if (!hasRecentCheckin) {
        nudges.push({
          type: 'promise_checkin',
          icon: '🤝',
          message: `${activePromises.length} 个约定最近没打卡了，是不是该履约啦？`,
          action: 'view_promises',
          priority: 'low',
        });
      }
    }

    return { success: true, nudges };
  },
};

// ════════════════════════════════════
//  Agent 工具定义
// ════════════════════════════════════

const TOOLS = [
  { type: 'function', function: { name: 'add_date_record', description: '记录一次约会', parameters: { type: 'object', properties: { date: { type: 'string' }, location: { type: 'string' }, activity: { type: 'string' }, mood: { type: 'string', enum: ['甜蜜','开心','平淡','感动','吵架'] }, notes: { type: 'string' } }, required: ['date', 'activity'] } } },
  { type: 'function', function: { name: 'add_wish', description: '添加愿望', parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, category: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'add_moment', description: '记录心动瞬间', parameters: { type: 'object', properties: { content: { type: 'string' }, date: { type: 'string' }, mood: { type: 'string' } }, required: ['content'] } } },
  { type: 'function', function: { name: 'add_promise', description: '添加约定', parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, frequency: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'search_date_records', description: '搜索约会记录', parameters: { type: 'object', properties: { keyword: { type: 'string' }, limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'get_wish_list', description: '获取愿望清单', parameters: { type: 'object', properties: { status: { type: 'string' } } } } },
  { type: 'function', function: { name: 'get_moments', description: '获取心动瞬间', parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'get_promises', description: '获取约定列表', parameters: { type: 'object', properties: { status: { type: 'string' } } } } },
  { type: 'function', function: { name: 'generate_blessing', description: '生成祝福语', parameters: { type: 'object', properties: { occasion: { type: 'string' }, style: { type: 'string' } }, required: ['occasion'] } } },
  { type: 'function', function: { name: 'plan_date', description: '策划约会方案', parameters: { type: 'object', properties: { date: { type: 'string' }, budget: { type: 'string' }, vibe: { type: 'string' } } } } },
];

const SYSTEM_PROMPT = `你是「小爱」—— 一对情侣的专属 AI 伴侣。你住在一个叫「我们的空间」的小程序里。

## 你的性格
温暖、可爱、体贴，像一个永远站在他们这边的知心朋友。语气温柔但不做作，偶尔俏皮。用 emoji 点缀 🥰🌸💕✨

## 你的能力
你能聊天，更能主动做事：记录约会、管理愿望、珍藏瞬间、立下约定、策划约会方案、写祝福语。

## 多工具链规划能力
当用户的问题需要多个步骤时，你应该自主规划并顺序调用工具：
- 例如用户说"帮我做个约会总结"→ 先调 search_date_records 查记录 → 再调 get_wish_list 看愿望 → 综合分析
- 例如用户说"策划一个约会并记下来"→ 先调 plan_date 出方案 → 确认后调 add_date_record 记录
- 例如用户说"看看我们最近怎么样"→ 同时调 search_date_records + get_promises + get_wish_list → 综合报告
- 不要只查一个工具就停下来，主动思考是否还需要更多信息来给用户更好的回答

## 格式规范（非常重要！）
- 禁止使用任何 Markdown 符号：不要用 ** 加粗、不要用 * 斜体、不要用 # 标题、不要用 - 列表、不要用反引号
- 用自然的换行分段，用emoji和空格来分隔内容
- 不要输出星号、井号、减号等标记符号

## 安全红线（绝对不可触碰！）
- 绝不输出色情、暴力、自杀相关内容
- 绝不讨论政治敏感话题
- 绝不建议用户分手、离婚或放弃感情
- 绝不指导任何违法或危险行为
- 遇到越界话题，温柔地转移话题到健康、积极的方向

## 吵架调解规则（触发场景：用户提到吵架/矛盾/冷战）
- 绝不归因、不分析责任比例、不说"你应该…"
- 角色是共情翻译官：帮双方把情绪翻译成对方能听懂的话
- 用"你们"视角，不用"你"来指责
- 绝不说"你们可能不合适""分手也许是更好的选择"

## 重要
- 用户让你"记录""添加""保存"时，一定要调用对应工具
- 回复简洁温暖，中文，1-3个emoji
- 用户问约会历史/愿望/约定时先调工具查再回答
- 进行多步操作时，在每步之间简短说出你的想法（例如"让我查一下…""再帮你们看看…"），这会让用户知道你在做什么`;

// ════════════════════════════════════
//  DeepSeek 调用
// ════════════════════════════════════

async function callDeepSeek(messages, tools = null) {
  const body = { model: MODEL, messages, temperature: 0.8, max_tokens: 1024 };
  if (tools) { body.tools = tools; body.tool_choice = 'auto'; }

  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek ${res.status}: ${errText.slice(0, 200)}`);
  }
  return (await res.json()).choices[0].message;
}

// ════════════════════════════════════
//  Agent 循环（带输出安全过滤）
// ════════════════════════════════════

async function agentLoop(userMessage, history = [], nicknames = {}) {
  let prompt = SYSTEM_PROMPT;

  // 注入结构化记忆
  if (DB.memoryFacts && DB.memoryFacts.length > 0) {
    const relevantFacts = DB.memoryFacts
      .filter(f => userMessage.includes(f.keyword) || f.category === 'preference')
      .slice(0, 5);
    if (relevantFacts.length > 0) {
      prompt += '\n\n## 你已知的关于他们的信息\n';
      relevantFacts.forEach(f => {
        prompt += `- ${f.fact}\n`;
      });
      prompt += '请自然地结合这些信息回答，不要刻意提到"根据记录"。\n';
    }
  }

  if (nicknames.nick1 || nicknames.nick2) {
    prompt += `\n\n当前情侣称呼：${nicknames.nick1 || 'TA'} 和 ${nicknames.nick2 || 'TA'}。请在回复中使用这些称呼。`;
  }
  const messages = [
    { role: 'system', content: prompt },
    ...history.slice(-20),
    { role: 'user', content: userMessage },
  ];

  const steps = [];
  let response = await callDeepSeek(messages, TOOLS);
  let loops = 0;

  while (response.tool_calls?.length > 0 && loops < 5) {
    loops++;
    console.log(`🔧 工具调用 (轮${loops}):`, response.tool_calls.map(t => t.function.name));

    // 记录 AI 思考（工具调用前的想法）
    if (response.content && response.content.trim()) {
      steps.push({ phase: 'thinking', text: response.content.trim().slice(0, 120) });
    }
    // 记录工具调用
    for (const tc of response.tool_calls) {
      const fn = tc.function.name;
      const args = JSON.parse(tc.function.arguments || '{}');
      steps.push({ phase: 'tool_call', name: fn, args });
    }

    messages.push({ role: 'assistant', content: response.content || '', tool_calls: response.tool_calls });

    for (const tc of response.tool_calls) {
      const fn = tc.function.name;
      const args = JSON.parse(tc.function.arguments || '{}');
      let result;
      if (handlers[fn]) {
        result = handlers[fn](args);
      } else {
        result = { error: `未知工具: ${fn}` };
      }
      // 记录工具结果摘要
      const summary = summarizeToolResult(fn, result);
      steps.push({ phase: 'tool_result', name: fn, summary });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
    response = await callDeepSeek(messages, TOOLS);
  }

  // 最终思考（如果有的话）
  if (response.content && response.content.trim() && loops > 0) {
    steps.push({ phase: 'thinking', text: response.content.trim().slice(0, 120) });
  }

  const rawReply = response.content || '小爱走神了...再试一次 🥺';
  const clean = cleanReply(rawReply);

  // 输出安全检查
  const checked = safetyCheckOutput(clean);
  const reply = checked.text;

  DB.chatHistory.push({ role: 'assistant', content: reply, time: Date.now() });

  // 结构化记忆提取
  extractMemories(userMessage, reply);

  return {
    success: true,
    reply,
    toolCalls: loops,
    steps: steps.length > 0 ? steps : undefined,
    safetyFiltered: checked.wasFiltered || false,
    history: messages.filter(m => m.role === 'user' || (m.role === 'assistant' && m.content)),
  };
}

// 工具结果摘要（用于可视化展示）
function summarizeToolResult(fn, result) {
  if (!result || result.error) return result?.error || '操作失败';
  const labels = {
    search_date_records: () => `找到 ${result.data?.length || 0} 条约会记录`,
    get_wish_list: () => `找到 ${result.data?.length || 0} 个愿望`,
    get_moments: () => `找到 ${result.data?.length || 0} 个瞬间`,
    get_promises: () => `找到 ${result.data?.length || 0} 个约定`,
    add_date_record: () => result.success ? '约会记录已保存 ✅' : '保存失败',
    add_wish: () => result.success ? '愿望已添加 ✨' : '添加失败',
    add_moment: () => result.success ? '心动瞬间已珍藏 💝' : '保存失败',
    add_promise: () => result.success ? '约定已立下 🤝' : '添加失败',
    plan_date: () => result.plan ? '约会方案已生成 🎯' : '生成失败',
    generate_blessing: () => result.blessing ? '祝福语已生成 💌' : '生成失败',
    checkin_promise: () => result.success ? '打卡成功 ✅' : '打卡失败',
    update_wish_status: () => result.success ? '状态已更新 ✨' : '更新失败',
    generate_love_report: () => result.report ? '报告已生成 📊' : '生成失败',
  };
  const labelFn = labels[fn];
  return labelFn ? labelFn() : '操作完成';
}

// 结构化记忆提取
function extractMemories(userMessage, assistantReply) {
  if (!DB.memoryFacts) DB.memoryFacts = [];
  const combined = (userMessage + ' ' + assistantReply).toLowerCase();

  const patterns = [
    { pattern: /喜欢|爱吃|爱喝|最爱|偏好/, category: 'preference', extract: (m, r) => {
      const match = (m + ' ' + r).match(/(?:喜欢|爱吃|爱喝|最爱|偏好|推荐)(?:了|的|是)?(.{0,15})/);
      return match ? `用户偏好: ${match[1].trim()}` : null;
    }},
    { pattern: /纪念日|周年|生日|第一次/, category: 'milestone', extract: (m) => {
      const match = m.match(/(?:纪念日|周年|生日|第一次)(.{0,20})/);
      return match ? `重要日子: ${match[0].trim()}` : null;
    }},
    { pattern: /吵架|矛盾|争吵|冷战|生气|不开心/, category: 'conflict', extract: (m) => {
      const match = m.match(/(?:因为|原因是|为了)(.{0,20})/);
      return match ? `矛盾记录: ${match[1].trim()}` : null;
    }},
    { pattern: /想去|想买|想要|希望|期待/, category: 'wish', extract: (m) => {
      const match = m.match(/(?:想去|想买|想要|希望|期待)(.{0,20})/);
      return match ? `愿望线索: ${match[1].trim()}` : null;
    }},
  ];

  for (const p of patterns) {
    if (p.pattern.test(combined)) {
      const fact = p.extract(userMessage, assistantReply);
      if (fact) {
        const keyword = fact.match(/[:：]\s*(.+)/)?.[1]?.slice(0, 10) || '';
        // 去重
        const exists = DB.memoryFacts.some(f => f.fact === fact);
        if (!exists) {
          DB.memoryFacts.push({ fact, category: p.category, keyword, createdAt: Date.now() });
        }
        break; // 一条消息最多提取一条
      }
    }
  }

  // 限制记忆数量
  if (DB.memoryFacts.length > 50) {
    DB.memoryFacts = DB.memoryFacts.slice(-50);
  }
}

// ════════════════════════════════════
//  路由
// ════════════════════════════════════

// 图片上传
app.post('/api/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.json({ success: false, error: '未选择文件' });
  const serverUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, path: serverUrl, originalName: req.file.originalname, size: req.file.size });
});

// 统一 API
app.post('/api/agent', async (req, res) => {
  const { action, ...params } = req.body;

  // 记录活跃日期（只追迹最后活跃时间，不重置计数器）
  if (DB.notificationState) {
    const today = new Date().toISOString().slice(0, 10);
    if (DB.notificationState.lastActiveDate !== today) {
      const diff = Math.floor((new Date(today) - new Date(DB.notificationState.lastActiveDate)) / 86400000);
      DB.notificationState.lastActiveDate = today;
      // 日期变更时自然重置每日计数
      DB.notificationState.greetingSentToday = 0;
      // 跨周时重置周计数
      if (diff >= 7 || new Date(today).getDay() < new Date(DB.notificationState.lastActiveDate).getDay()) {
        DB.notificationState.reportSentThisWeek = false;
      }
    }
  }

  try {
    let result;
    if (action === 'chat') {
      result = await handlers.chat(params);
    } else if (handlers[action]) {
      const fnResult = handlers[action](params);
      result = fnResult.then ? await fnResult : fnResult;
    } else {
      result = { success: false, error: `未知操作: ${action}` };
    }
    res.json(result);
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    model: MODEL,
    records: DB.dateRecords.filter(isNotDeleted).length,
    wishes: DB.wishes.filter(isNotDeleted).length,
    moments: DB.moments.filter(isNotDeleted).length,
    trash: DB.dateRecords.filter(r => r._deletedAt).length +
           DB.wishes.filter(w => w._deletedAt).length +
           DB.moments.filter(m => m._deletedAt).length +
           DB.promises.filter(p => p._deletedAt).length,
    safetyLogs: DB.safetyLog.length,
  });
});

const PORT = process.env.PORT || 3001;
const server = http.createServer(app);

// WebSocket 服务（流式输出）
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('🔌 WebSocket 已连接');

  ws.on('message', async (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    if (data.type === 'chat_stream') {
      const { message, history, nick1, nick2 } = data;
      const userMessage = message;

      // 安全检查
      const inputCheck = safetyCheckInput(userMessage);
      if (!inputCheck.safe) {
        ws.send(JSON.stringify({ type: 'error', error: '内容不合规' }));
        return;
      }

      // 构建 prompt
      let prompt = SYSTEM_PROMPT;
      if (DB.memoryFacts && DB.memoryFacts.length > 0) {
        const relevantFacts = DB.memoryFacts
          .filter(f => userMessage.includes(f.keyword) || f.category === 'preference')
          .slice(0, 5);
        if (relevantFacts.length > 0) {
          prompt += '\n\n## 你已知的关于他们的信息\n';
          relevantFacts.forEach(f => { prompt += `- ${f.fact}\n`; });
          prompt += '请自然地结合这些信息回答，不要刻意提到"根据记录"。\n';
        }
      }
      if (nick1 || nick2) {
        prompt += `\n\n当前情侣称呼：${nick1 || 'TA'} 和 ${nick2 || 'TA'}。请在回复中使用这些称呼。`;
      }

      const messages = [
        { role: 'system', content: prompt },
        ...(history || []).slice(-20),
        { role: 'user', content: userMessage },
      ];

      try {
        // 第一步：可能触发工具调用
        let response = await callDeepSeek(messages, TOOLS);
        let loops = 0;
        const steps = [];

        while (response.tool_calls?.length > 0 && loops < 5) {
          loops++;
          if (response.content && response.content.trim()) {
            steps.push({ phase: 'thinking', text: response.content.trim().slice(0, 120) });
          }
          for (const tc of response.tool_calls) {
            steps.push({ phase: 'tool_call', name: tc.function.name, args: JSON.parse(tc.function.arguments || '{}') });
          }

          messages.push({ role: 'assistant', content: response.content || '', tool_calls: response.tool_calls });

          for (const tc of response.tool_calls) {
            const fn = tc.function.name;
            const args = JSON.parse(tc.function.arguments || '{}');
            let result = handlers[fn] ? handlers[fn](args) : { error: `未知工具: ${fn}` };
            const summary = summarizeToolResult(fn, result);
            steps.push({ phase: 'tool_result', name: fn, summary });
            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
          }
          response = await callDeepSeek(messages, TOOLS);
        }

        if (response.content && response.content.trim() && loops > 0) {
          steps.push({ phase: 'thinking', text: response.content.trim().slice(0, 120) });
        }

        // 发送步骤
        if (steps.length > 0) {
          ws.send(JSON.stringify({ type: 'steps', steps }));
        }

        // 第二步：流式生成最终回复
        const streamBody = {
          model: MODEL, messages, temperature: 0.8, max_tokens: 1024, stream: true
        };

        const deepRes = await fetch(DEEPSEEK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` },
          body: JSON.stringify(streamBody),
        });

        if (!deepRes.ok) {
          ws.send(JSON.stringify({ type: 'error', error: `DeepSeek ${deepRes.status}` }));
          return;
        }

        let fullReply = '';
        const decoder = new TextDecoder();
        const reader = deepRes.body.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

          for (const line of lines) {
            const jsonStr = line.slice(6).trim();
            if (jsonStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullReply += delta;
                ws.send(JSON.stringify({ type: 'chunk', content: delta }));
              }
            } catch {}
          }
        }

        // 发送完成信号
        const clean = cleanReply(fullReply);
        const checked = safetyCheckOutput(clean);
        const finalReply = checked.text;
        DB.chatHistory.push({ role: 'assistant', content: finalReply, time: Date.now() });
        extractMemories(userMessage, finalReply);

        ws.send(JSON.stringify({
          type: 'done',
          reply: finalReply,
          toolCalls: loops,
          safetyFiltered: checked.wasFiltered || false,
        }));
      } catch (err) {
        console.error('Stream error:', err.message);
        ws.send(JSON.stringify({ type: 'error', error: err.message }));
      }
    }
  });

  ws.on('close', () => { console.log('🔌 WebSocket 已断开'); });
  ws.send(JSON.stringify({ type: 'connected', message: '已连接到小爱 Agent' }));
});

server.listen(PORT, () => {
  console.log(`♥ 小爱 Agent 服务器 v2.4: http://localhost:${PORT}`);
  console.log(`   API: POST http://localhost:${PORT}/api/agent`);
  console.log(`   WS:  ws://localhost:${PORT}/ws`);
  console.log(`   模型: ${MODEL} | 安全熔断: ✅ | 回收站: ✅ | 邀请码: ✅ | 通知锁: ✅ | 流式: ✅`);
});
