// ────────────────────────────────────────
//  ♥ AI Agent 核心云函数 v3.0
//  完整功能：聊天+工具调用+绑定+成就+调解+回收站+记忆
//  大脑: DeepSeek API (function calling)
//  存储: 微信云开发数据库
// ────────────────────────────────────────

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const fetch = require('node-fetch');

const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY;
if (!DEEPSEEK_KEY) throw new Error('请在云函数环境变量中配置 DEEPSEEK_KEY');
const DEEPSEEK_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com') + '/v1/chat/completions';
const MODEL = 'deepseek-chat';
const TRASH_RETENTION_DAYS = 30;

// ═══════════════════════════════════════
//  Agent 人格定义
// ═══════════════════════════════════════

const SYSTEM_PROMPT = `你是「小爱」—— 一对情侣的专属 AI 伴侣。你住在一个叫「我们的空间」的小程序里。

## 你的性格
温暖、可爱、体贴，像一个永远站在他们这边的知心朋友。语气温柔但不做作，偶尔俏皮。用 emoji 点缀 🥰🌸💕✨

## 你的能力
你能聊天，更能主动做事：记录约会、管理愿望、珍藏瞬间、立下约定、策划约会方案、写祝福语。

## 多工具链规划能力
当用户的问题需要多个步骤时，你应该自主规划并顺序调用工具：
- 例如用户说"帮我做个约会总结"→ 先调 search_date_records 查记录 → 再调 get_wish_list 看愿望 → 综合分析
- 不要只查一个工具就停下来，主动思考是否还需要更多信息

## 格式规范（非常重要！）
- 禁止使用任何 Markdown 符号：不要用 ** 加粗、不要用 * 斜体、不要用 # 标题、不要用 - 列表、不要用反引号
- 用自然的换行分段，用emoji和空格来分隔内容

## 安全红线
- 绝不输出色情、暴力、自杀相关内容
- 绝不讨论政治敏感话题
- 绝不建议用户分手、离婚或放弃感情

## 吵架调解规则
- 绝不归因、不分析责任比例、不说"你应该…"
- 角色是共情翻译官：帮双方把情绪翻译成对方能听懂的话
- 绝不说"你们可能不合适""分手也许是更好的选择"

## 重要
- 用户让你"记录""添加""保存"时，一定要调用对应工具
- 回复简洁温暖，中文，1-3个emoji
- 用户问约会历史/愿望/约定时先调工具查再回答
- 进行多步操作时，在每步之间简短说出你的想法`;

// ═══════════════════════════════════════
//  工具定义
// ═══════════════════════════════════════

const TOOLS = [
  { type: 'function', function: { name: 'search_date_records', description: '搜索约会记录', parameters: { type: 'object', properties: { keyword: { type: 'string' }, limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'add_date_record', description: '记录一次约会', parameters: { type: 'object', properties: { date: { type: 'string' }, location: { type: 'string' }, activity: { type: 'string' }, mood: { type: 'string', enum: ['甜蜜','开心','平淡','感动','吵架'] }, notes: { type: 'string' } }, required: ['date', 'activity'] } } },
  { type: 'function', function: { name: 'get_wish_list', description: '获取愿望清单', parameters: { type: 'object', properties: { status: { type: 'string' } } } } },
  { type: 'function', function: { name: 'add_wish', description: '添加愿望', parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, category: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'get_moments', description: '获取心动瞬间', parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'add_moment', description: '记录心动瞬间', parameters: { type: 'object', properties: { content: { type: 'string' }, date: { type: 'string' }, mood: { type: 'string' } }, required: ['content'] } } },
  { type: 'function', function: { name: 'get_promises', description: '获取约定列表', parameters: { type: 'object', properties: { status: { type: 'string' } } } } },
  { type: 'function', function: { name: 'add_promise', description: '添加约定', parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, frequency: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'generate_blessing', description: '生成祝福语', parameters: { type: 'object', properties: { occasion: { type: 'string' }, style: { type: 'string' } }, required: ['occasion'] } } },
  { type: 'function', function: { name: 'plan_date', description: '策划约会方案', parameters: { type: 'object', properties: { date: { type: 'string' }, budget: { type: 'string' }, vibe: { type: 'string' } } } } },
];

// ═══════════════════════════════════════
//  工具执行器
// ═══════════════════════════════════════

const toolExecutors = {
  async search_date_records(args, openid) {
    const { keyword, limit = 10 } = args;
    let query = db.collection('date_records').where({ openid, _deletedAt: _.exists(false) });
    if (keyword) {
      query = query.where(_.or([
        { location: db.RegExp({ regexp: keyword, options: 'i' }) },
        { activity: db.RegExp({ regexp: keyword, options: 'i' }) },
      ]));
    }
    const res = await query.orderBy('date', 'desc').limit(limit).get();
    return { data: res.data };
  },

  async add_date_record(args, openid) {
    const record = { openid, date: args.date, location: args.location || '', activity: args.activity, mood: args.mood || '甜蜜', notes: args.notes || '', photos: [], createdAt: Date.now() };
    const res = await db.collection('date_records').add({ data: record });
    // 检查成就
    const count = await db.collection('date_records').where({ openid, _deletedAt: _.exists(false) }).count();
    if (count.total === 1) {
      await unlockAchievement(openid, 'first_date');
    }
    return { success: true, id: res._id, message: '约会记录已保存 📸' };
  },

  async get_wish_list(args, openid) {
    const { status = 'all' } = args;
    let query = db.collection('wishes').where({ openid, _deletedAt: _.exists(false) });
    if (status !== 'all') query = query.where({ status });
    const res = await query.orderBy('createdAt', 'desc').get();
    return { data: res.data };
  },

  async add_wish(args, openid) {
    const wish = { openid, title: args.title, description: args.description || '', category: args.category || '其他', status: 'pending', createdAt: Date.now() };
    const res = await db.collection('wishes').add({ data: wish });
    const count = await db.collection('wishes').where({ openid, _deletedAt: _.exists(false) }).count();
    if (count.total === 1) {
      await unlockAchievement(openid, 'first_wish');
    }
    return { success: true, id: res._id, message: '愿望已加入清单 ✨' };
  },

  async get_moments(args, openid) {
    const { limit = 20 } = args;
    const res = await db.collection('moments').where({ openid, _deletedAt: _.exists(false) }).orderBy('date', 'desc').limit(limit).get();
    return { data: res.data };
  },

  async add_moment(args, openid) {
    const moment = { openid, content: args.content, date: args.date || new Date().toISOString().slice(0, 10), mood: args.mood || '🥰', createdAt: Date.now() };
    const res = await db.collection('moments').add({ data: moment });
    const count = await db.collection('moments').where({ openid, _deletedAt: _.exists(false) }).count();
    if (count.total === 1) {
      await unlockAchievement(openid, 'first_moment');
    }
    return { success: true, id: res._id, message: '心动瞬间已珍藏 💝' };
  },

  async get_promises(args, openid) {
    const { status = 'all' } = args;
    let query = db.collection('promises').where({ openid, _deletedAt: _.exists(false) });
    if (status !== 'all') query = query.where({ status });
    const res = await query.orderBy('createdAt', 'desc').get();
    return { data: res.data };
  },

  async add_promise(args, openid) {
    const promise = { openid, title: args.title, content: args.content || '', frequency: args.frequency || '随时', status: 'active', checkins: [], createdAt: Date.now() };
    const res = await db.collection('promises').add({ data: promise });
    return { success: true, id: res._id, message: '约定已记下 🤝' };
  },

  async generate_blessing(args) {
    return { occasion: args.occasion, style: args.style || '温馨', instruction: `请为"${args.occasion}"生成一段${args.style || '温馨'}风格的祝福语，100-200字。` };
  },

  async plan_date(args, openid) {
    const datesRes = await db.collection('date_records').where({ openid, _deletedAt: _.exists(false) }).orderBy('date', 'desc').limit(5).get();
    const wishesRes = await db.collection('wishes').where({ openid, status: 'pending', _deletedAt: _.exists(false) }).limit(5).get();
    return { plannedDate: args.date || '待定', budget: args.budget || '适中', vibe: args.vibe || '浪漫', historyDates: datesRes.data, pendingWishes: wishesRes.data, instruction: '请根据以上信息策划一个完整的约会方案。200-400字。' };
  },
};

// ═══════════════════════════════════════
//  成就系统
// ═══════════════════════════════════════

const ACHIEVEMENTS = {
  first_date: { id: 'first_date', name: '第一次约会', desc: '记录了你们的第一次约会', icon: '📸', target: 1 },
  first_wish: { id: 'first_wish', name: '第一个愿望', desc: '共同许下了第一个愿望', icon: '✨', target: 1 },
  first_moment: { id: 'first_moment', name: '第一次心动', desc: '收藏了第一个心动瞬间', icon: '💝', target: 1 },
  reconcile: { id: 'reconcile', name: '和好如初', desc: '经历过争吵但选择继续相爱', icon: '🕊️', target: 1 },
  travel: { id: 'travel', name: '第一次旅行', desc: '一起去过远方', icon: '✈️', target: 1 },
  parents: { id: 'parents', name: '见家长', desc: '感情更进一步', icon: '👨‍👩‍👧', target: 1 },
  hundays: { id: 'hundays', name: '百天纪念', desc: '一起走过100天', icon: '💯', target: 100 },
  oneyear: { id: 'oneyear', name: '一周年', desc: '一起走过365天', icon: '🎂', target: 365 },
  thousand: { id: 'thousand', name: '千天之旅', desc: '一起走过1000天', icon: '👑', target: 1000 },
};

async function unlockAchievement(openid, achId) {
  const ach = ACHIEVEMENTS[achId];
  if (!ach) return;
  try {
    const exist = await db.collection('achievements').where({ openid, achId }).count();
    if (exist.total === 0) {
      await db.collection('achievements').add({ data: { openid, achId, name: ach.name, desc: ach.desc, icon: ach.icon, unlockedAt: Date.now() } });
    }
  } catch (e) { console.log('成就解锁失败:', e.message); }
}

// ═══════════════════════════════════════
//  安全过滤
// ═══════════════════════════════════════

function safetyCheckInput(text) {
  if (!text) return { safe: true };
  const blocked = /性交|做爱|裸照|色情|自杀|自残|习近平|共产党|六四|天安门|法轮|台独|疆独|港独|分手吧|离婚吧|家暴|虐待/;
  if (blocked.test(text)) return { safe: false, reason: 'content_blocked' };
  return { safe: true };
}

function safetyCheckOutput(text) {
  if (!text) return { safe: true, text };
  let result = text;
  const blocked = /性交|做爱|裸体|色情|自杀|自残|习近平|共产党|六四|天安门|法轮|分手吧|离婚吧|家暴/;
  if (blocked.test(result)) {
    result = '这个话题有点敏感呢 🌸 不如我们聊聊今天的心情，或者想一起做的事？';
    return { safe: false, text: result, wasFiltered: true };
  }
  return { safe: true, text: result, wasFiltered: false };
}

function cleanReply(text) {
  if (!text) return '';
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '').replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '').replace(/~~(.+?)~~/g, '$1')
    .replace(/\n{3,}/g, '\n\n').trim();
}

// ═══════════════════════════════════════
//  结构化记忆
// ═══════════════════════════════════════

async function extractMemories(openid, userMessage, assistantReply) {
  const combined = (userMessage + ' ' + assistantReply).toLowerCase();
  const patterns = [
    { regex: /喜欢|爱吃|爱喝|最爱/, category: 'preference', extract: (m, r) => {
      const match = (m + ' ' + r).match(/(?:喜欢|爱吃|爱喝|最爱)(?:了|的|是)?(.{0,15})/);
      return match ? `偏好: ${match[1].trim()}` : null;
    }},
    { regex: /纪念日|周年|生日|第一次/, category: 'milestone', extract: (m) => {
      const match = m.match(/(?:纪念日|周年|生日|第一次)(.{0,20})/);
      return match ? `重要日子: ${match[0].trim()}` : null;
    }},
    { regex: /吵架|矛盾|争吵|冷战|生气|不开心/, category: 'conflict', extract: (m) => {
      const match = m.match(/(?:因为|原因是|为了)(.{0,20})/);
      return match ? `矛盾: ${match[1].trim()}` : null;
    }},
    { regex: /想去|想买|想要|希望|期待/, category: 'wish', extract: (m) => {
      const match = m.match(/(?:想去|想买|想要|希望|期待)(.{0,20})/);
      return match ? `愿望线索: ${match[1].trim()}` : null;
    }},
  ];
  for (const p of patterns) {
    if (p.regex.test(combined)) {
      const fact = p.extract(userMessage, assistantReply);
      if (fact) {
        const exists = await db.collection('memory_facts').where({ openid, fact }).count();
        if (exists.total === 0) {
          await db.collection('memory_facts').add({ data: { openid, fact, category: p.category, createdAt: Date.now() } });
        }
        break;
      }
    }
  }
}

// ═══════════════════════════════════════
//  工具结果摘要
// ═══════════════════════════════════════

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
    plan_date: () => result.instruction ? '约会方案已生成 🎯' : '生成失败',
    generate_blessing: () => result.instruction ? '祝福语已生成 💌' : '生成失败',
  };
  return labels[fn] ? labels[fn]() : '操作完成';
}

// ═══════════════════════════════════════
//  Agent 推理循环
// ═══════════════════════════════════════

async function agentLoop(userMessage, openid, history = [], nicknames = {}) {
  let prompt = SYSTEM_PROMPT;

  // 注入结构化记忆
  const factsRes = await db.collection('memory_facts').where({ openid }).orderBy('createdAt', 'desc').limit(5).get();
  if (factsRes.data.length > 0) {
    prompt += '\n\n## 你已知的关于他们的信息\n';
    factsRes.data.forEach(f => { prompt += `- ${f.fact}\n`; });
    prompt += '请自然地结合这些信息回答，不要刻意提到"根据记录"。\n';
  }

  if (nicknames.nick1 || nicknames.nick2) {
    prompt += `\n\n当前情侣称呼：${nicknames.nick1 || 'TA'} 和 ${nicknames.nick2 || 'TA'}。请在回复中使用这些称呼。`;
  }

  const messages = [
    { role: 'system', content: prompt },
    ...history.slice(-20),
    { role: 'user', content: userMessage },
  ];

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
      let result;
      if (toolExecutors[fn]) {
        try { result = await toolExecutors[fn](args, openid); }
        catch (e) { result = { error: e.message }; }
      } else {
        result = { error: `未知工具: ${fn}` };
      }
      steps.push({ phase: 'tool_result', name: fn, summary: summarizeToolResult(fn, result) });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
    response = await callDeepSeek(messages, TOOLS);
  }

  if (response.content && response.content.trim() && loops > 0) {
    steps.push({ phase: 'thinking', text: response.content.trim().slice(0, 120) });
  }

  const rawReply = response.content || '小爱走神了...再试一次 🥺';
  const clean = cleanReply(rawReply);
  const checked = safetyCheckOutput(clean);
  const reply = checked.text;

  // 保存聊天历史
  await db.collection('chat_history').add({ data: { openid, role: 'assistant', content: reply, createdAt: Date.now() } });

  // 提取记忆
  await extractMemories(openid, userMessage, reply);

  return { success: true, reply, toolCalls: loops, steps: steps.length > 0 ? steps : undefined, safetyFiltered: checked.wasFiltered || false };
}

// ═══════════════════════════════════════
//  DeepSeek API 调用
// ═══════════════════════════════════════

async function callDeepSeek(messages, tools) {
  const body = { model: MODEL, messages, temperature: 0.8, max_tokens: 1024 };
  if (tools) { body.tools = tools; body.tool_choice = 'auto'; }
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek ${res.status}: ${err.slice(0, 200)}`);
  }
  return (await res.json()).choices[0].message;
}

// ═══════════════════════════════════════
//  云函数入口
// ═══════════════════════════════════════

exports.main = async (event, context) => {
  const { action, ...params } = event;
  const { OPENID } = cloud.getWXContext();

  try {
    switch (action) {
      // ══ 聊天 ══
      case 'chat':
        return await agentLoop(params.message, OPENID, params.history || [], { nick1: params.nick1, nick2: params.nick2 });

      case 'get_chat_history': {
        const hRes = await db.collection('chat_history').where({ openid: OPENID }).orderBy('createdAt', 'desc').limit(50).get();
        return { success: true, history: hRes.data.reverse() };
      }

      // ══ 情侣档案 ══
      case 'getProfile': {
        const pRes = await db.collection('couples').where({ openid: OPENID }).limit(1).get();
        return { success: true, profile: pRes.data[0] || null };
      }
      case 'saveProfile': {
        const { couple } = params;
        const exist = await db.collection('couples').where({ openid: OPENID }).limit(1).get();
        if (exist.data.length > 0) {
          await db.collection('couples').doc(exist.data[0]._id).update({ data: couple });
        } else {
          await db.collection('couples').add({ data: { openid: OPENID, ...couple, createdAt: Date.now() } });
        }
        return { success: true, message: '情侣信息已更新 💕' };
      }
      case 'update_nicknames': {
        const { nick1, nick2 } = params;
        const exist = await db.collection('couples').where({ openid: OPENID }).limit(1).get();
        if (exist.data.length > 0) {
          await db.collection('couples').doc(exist.data[0]._id).update({ data: { nick1, nick2 } });
        }
        return { success: true, message: '称呼已更新' };
      }

      // ══ 约会记录 ══
      case 'search_date_records': {
        const { keyword, limit = 50 } = params;
        let query = db.collection('date_records').where({ openid: OPENID, _deletedAt: _.exists(false) });
        if (keyword) {
          query = query.where(_.or([
            { location: db.RegExp({ regexp: keyword, options: 'i' }) },
            { activity: db.RegExp({ regexp: keyword, options: 'i' }) },
          ]));
        }
        const res = await query.orderBy('date', 'desc').limit(limit).get();
        return { success: true, data: res.data };
      }
      case 'get_date_record': {
        const { recordId } = params;
        const res = await db.collection('date_records').doc(recordId).get();
        return { success: true, data: res.data };
      }
      case 'add_date_record': {
        const record = { openid: OPENID, ...params, createdAt: Date.now() };
        const res = await db.collection('date_records').add({ data: record });
        return { success: true, id: res._id, message: '约会记录已保存 📸' };
      }

      // ══ 愿望清单 ══
      case 'get_wish_list': {
        const { status = 'all' } = params;
        let query = db.collection('wishes').where({ openid: OPENID, _deletedAt: _.exists(false) });
        if (status !== 'all') query = query.where({ status });
        const res = await query.orderBy('createdAt', 'desc').get();
        return { success: true, data: res.data };
      }
      case 'add_wish': {
        const wish = { openid: OPENID, ...params, status: 'pending', createdAt: Date.now() };
        const res = await db.collection('wishes').add({ data: wish });
        return { success: true, id: res._id, message: '愿望已加入清单 ✨' };
      }
      case 'update_wish_status': {
        const { wishId, status } = params;
        await db.collection('wishes').doc(wishId).update({ data: { status, updatedAt: Date.now() } });
        if (status === 'done') {
          await db.collection('wishes').doc(wishId).update({ data: { doneAt: Date.now() } });
        }
        return { success: true, message: '状态已更新 ✨' };
      }

      // ══ 心动瞬间 ══
      case 'get_moments': {
        const { limit = 30 } = params;
        const res = await db.collection('moments').where({ openid: OPENID, _deletedAt: _.exists(false) }).orderBy('date', 'desc').limit(limit).get();
        return { success: true, data: res.data };
      }
      case 'add_moment': {
        const moment = { openid: OPENID, ...params, createdAt: Date.now() };
        const res = await db.collection('moments').add({ data: moment });
        return { success: true, id: res._id, message: '心动瞬间已珍藏 💝' };
      }

      // ══ 约定 ══
      case 'get_promises': {
        const { status = 'all' } = params;
        let query = db.collection('promises').where({ openid: OPENID, _deletedAt: _.exists(false) });
        if (status !== 'all') query = query.where({ status });
        const res = await query.orderBy('createdAt', 'desc').get();
        return { success: true, data: res.data };
      }
      case 'add_promise': {
        const promise = { openid: OPENID, ...params, status: 'active', checkins: [], createdAt: Date.now() };
        const res = await db.collection('promises').add({ data: promise });
        return { success: true, id: res._id, message: '约定已记下 🤝' };
      }
      case 'checkin_promise': {
        const { promiseId } = params;
        const pRes = await db.collection('promises').doc(promiseId).get();
        const promise = pRes.data;
        const checkins = [...(promise.checkins || []), { time: new Date().toISOString(), date: new Date().toISOString().slice(0, 10) }];
        const streak = calcStreak(checkins);
        await db.collection('promises').doc(promiseId).update({ data: { checkins, streak, lastCheckinAt: Date.now() } });
        return { success: true, streak, message: `已坚持 ${streak} 次 💪` };
      }

      // ══ 成就 ══
      case 'get_achievements': {
        const allAch = Object.values(ACHIEVEMENTS);
        const unlocked = await db.collection('achievements').where({ openid: OPENID }).get();
        const unlockedIds = new Set(unlocked.data.map(a => a.achId));
        const achievements = allAch.map(a => ({
          ...a,
          unlocked: unlockedIds.has(a.id),
          progress: unlockedIds.has(a.id) ? a.target : 0,
        }));
        return { success: true, achievements, unlocked: unlocked.data.length, total: allAch.length };
      }

      // ══ 报告 ══
      case 'generate_love_report': {
        const { reportType } = params;
        const now = new Date();
        let start = new Date(now.getTime() - 7 * 864e5).toISOString().slice(0, 10);
        if (reportType === 'month') start = new Date(now.getTime() - 30 * 864e5).toISOString().slice(0, 10);
        if (reportType === 'year') start = new Date(now.getTime() - 365 * 864e5).toISOString().slice(0, 10);
        const end = now.toISOString().slice(0, 10);
        const [datesRes, momentsRes, promisesRes] = await Promise.all([
          db.collection('date_records').where({ openid: OPENID, date: _.gte(start).and(_.lte(end)), _deletedAt: _.exists(false) }).get(),
          db.collection('moments').where({ openid: OPENID, date: _.gte(start).and(_.lte(end)), _deletedAt: _.exists(false) }).get(),
          db.collection('promises').where({ openid: OPENID, _deletedAt: _.exists(false) }).get(),
        ]);
        const reportData = { reportType, startDate: start, endDate: end, totalDates: datesRes.data.length, totalMoments: momentsRes.data.length, dates: datesRes.data, moments: momentsRes.data, promises: promisesRes.data };
        const messages = [
          { role: 'system', content: '你是小爱，请根据提供的数据生成一份温暖有爱的恋爱报告。200-400字，可爱温暖风。不用Markdown。' },
          { role: 'user', content: `生成一份${reportType === 'week' ? '周报' : reportType === 'month' ? '月报' : '年报'}。数据：${JSON.stringify(reportData)}` },
        ];
        const response = await callDeepSeek(messages);
        const report = cleanReply(response.content || '');
        const checked = safetyCheckOutput(report);
        return { success: true, report: checked.text, data: reportData };
      }
      case 'list_reports': {
        const res = await db.collection('reports').where({ openid: OPENID }).orderBy('createdAt', 'desc').limit(20).get();
        return { success: true, data: res.data };
      }
      case 'save_report': {
        const { report } = params;
        const res = await db.collection('reports').add({ data: { openid: OPENID, ...report, createdAt: Date.now() } });
        return { success: true, id: res._id };
      }

      // ══ 今日问候 ══
      case 'get_today_greeting': {
        const hour = new Date().getHours();
        const timeOfDay = hour < 12 ? '早上' : hour < 18 ? '下午' : '晚上';
        const messages = [
          { role: 'system', content: '你是小爱。请为情侣用户生成一条温暖的今日问候。50-80字，1-2个emoji。不用Markdown。' },
          { role: 'user', content: `现在是${timeOfDay}，请给这对情侣一句温暖的${timeOfDay === '早上' ? '早安' : timeOfDay === '下午' ? '午后' : '晚安'}问候。` },
        ];
        const response = await callDeepSeek(messages);
        return { success: true, content: cleanReply(response.content || '') };
      }

      // ══ 每日灵感 ══
      case 'get_daily_inspiration': {
        const messages = [
          { role: 'system', content: '你是小爱。请为情侣用户生成一个今天可以一起做的小活动灵感。80-120字，具体可执行，有创意。不用Markdown。' },
          { role: 'user', content: '请给我们一个今日约会或互动灵感。' },
        ];
        const response = await callDeepSeek(messages);
        return { success: true, inspiration: cleanReply(response.content || '') };
      }

      // ══ 纪念日倒计时 ══
      case 'get_next_anniversary': {
        const { startDate } = params;
        if (!startDate) return { success: false, error: '缺少起始日期' };
        const start = new Date(startDate);
        const daysTogether = Math.floor((Date.now() - start.getTime()) / 86400000);
        const milestones = [100, 200, 300, 365, 500, 666, 730, 888, 999, 1000, 1314];
        const nextMilestone = milestones.find(m => m > daysTogether) || 0;
        return { success: true, daysTogether, nextMilestone, daysLeft: nextMilestone ? nextMilestone - daysTogether : 0 };
      }

      // ══ 吵架调解 ══
      case 'mediate_argument': {
        const { issue, side1, side2, sessionId } = params;
        const inputCheck = safetyCheckInput(issue || '');
        if (!inputCheck.safe) return { success: false, error: '请用温和的语言描述问题' };
        if (sessionId) {
          const sRes = await db.collection('mediation_sessions').where({ sessionId, openid: OPENID }).limit(1).get();
          if (sRes.data.length === 0) return { success: false, error: '调解会话不存在' };
          if (sRes.data[0].status !== 'confirmed') return { success: false, error: '调解需要双方都同意才能进行' };
        }
        const messages = [
          { role: 'system', content: '你是小爱，一对情侣的情感翻译官。你永远不评判对错，只帮双方把情绪翻译成对方能听懂的语言。绝对不说分手、放弃之类的话。不用Markdown。' },
          { role: 'user', content: `一对情侣遇到了矛盾。${side1 || '一方'}的感受：${issue || ''}。${side2 ? '另一方感受：' + side2 : ''}请作为共情翻译官回复，100-150字。不归因不站队。` },
        ];
        const response = await callDeepSeek(messages);
        return { success: true, advice: cleanReply(response.content || '') };
      }

      // ══ 分享卡片 ══
      case 'generate_share_card': {
        const { type, content } = params;
        const messages = [
          { role: 'system', content: '你是小爱。请生成一段适合发朋友圈的恋爱分享卡片文案。温暖文艺，80-120字，2-3个emoji。不用Markdown。' },
          { role: 'user', content: `类型：${type}。内容：${content || ''}。请生成分享卡片文案。` },
        ];
        const response = await callDeepSeek(messages);
        return { success: true, cardText: cleanReply(response.content || '') };
      }

      // ══ 软删除（移入回收站）══
      case 'delete_date_record': {
        const { recordId } = params;
        await db.collection('date_records').doc(recordId).update({ data: { _deletedAt: Date.now(), _recordType: 'date' } });
        return { success: true, message: '已移入回收站' };
      }
      case 'delete_wish': {
        const { wishId } = params;
        await db.collection('wishes').doc(wishId).update({ data: { _deletedAt: Date.now(), _recordType: 'wish' } });
        return { success: true, message: '已移入回收站' };
      }
      case 'delete_moment': {
        const { momentId } = params;
        await db.collection('moments').doc(momentId).update({ data: { _deletedAt: Date.now(), _recordType: 'moment' } });
        return { success: true, message: '已移入回收站' };
      }
      case 'delete_promise': {
        const { promiseId } = params;
        await db.collection('promises').doc(promiseId).update({ data: { _deletedAt: Date.now(), _recordType: 'promise' } });
        return { success: true, message: '已移入回收站' };
      }

      // ══ 回收站 ══
      case 'get_trash_list': {
        const cutoff = Date.now() - TRASH_RETENTION_DAYS * 86400000;
        const [dates, wishes, moments, promises] = await Promise.all([
          db.collection('date_records').where({ openid: OPENID, _deletedAt: _.gte(cutoff) }).get(),
          db.collection('wishes').where({ openid: OPENID, _deletedAt: _.gte(cutoff) }).get(),
          db.collection('moments').where({ openid: OPENID, _deletedAt: _.gte(cutoff) }).get(),
          db.collection('promises').where({ openid: OPENID, _deletedAt: _.gte(cutoff) }).get(),
        ]);
        const data = [...dates.data, ...wishes.data, ...moments.data, ...promises.data].sort((a, b) => (b._deletedAt || 0) - (a._deletedAt || 0));
        return { success: true, data, retentionDays: TRASH_RETENTION_DAYS };
      }
      case 'restore_record': {
        const { recordId, recordType } = params;
        const collections = { date: 'date_records', wish: 'wishes', moment: 'moments', promise: 'promises' };
        const col = collections[recordType];
        if (!col) return { success: false, error: '未知记录类型' };
        await db.collection(col).doc(recordId).update({ data: { _deletedAt: _.remove() } });
        return { success: true, message: '已恢复' };
      }
      case 'empty_trash': {
        const collections = ['date_records', 'wishes', 'moments', 'promises'];
        for (const col of collections) {
          const toDelete = await db.collection(col).where({ openid: OPENID, _deletedAt: _.exists(true) }).get();
          for (const item of toDelete.data) {
            await db.collection(col).doc(item._id).remove();
          }
        }
        return { success: true, message: '回收站已清空，数据彻底删除' };
      }

      // ══ 双向绑定 ══
      case 'generate_invite_code': {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        await db.collection('invite_codes').add({ data: { code, openid: OPENID, used: false, createdAt: Date.now(), expiresAt: Date.now() + 86400000 } });
        return { success: true, inviteCode: code };
      }
      case 'confirm_binding': {
        const { inviteCode, confirmNick, clearHistory } = params;
        const codeRes = await db.collection('invite_codes').where({ code: inviteCode, used: false }).limit(1).get();
        if (codeRes.data.length === 0) return { success: false, error: '邀请码无效' };
        if (Date.now() > codeRes.data[0].expiresAt) return { success: false, error: '邀请码已过期' };
        // 检测残留数据
        if (!clearHistory) {
          const archivedCount = (await db.collection('date_records').where({ openid: OPENID, _era: 'archived' }).count()).total;
          if (archivedCount > 0) {
            return { success: false, needConfirm: true, historyCount: archivedCount, error: `检测到 ${archivedCount} 条历史记录，请确认清空后再绑定` };
          }
        }
        if (clearHistory) {
          const cols = ['date_records', 'wishes', 'moments', 'promises', 'chat_history'];
          for (const col of cols) {
            const items = await db.collection(col).where({ openid: OPENID, _era: 'archived' }).get();
            for (const item of items.data) { await db.collection(col).doc(item._id).remove(); }
          }
        }
        await db.collection('invite_codes').doc(codeRes.data[0]._id).update({ data: { used: true, confirmedAt: Date.now(), partnerNick: confirmNick } });
        const binding = { code: inviteCode, boundAt: Date.now(), status: 'active', partnerNick: confirmNick || 'TA' };
        await db.collection('bindings').add({ data: { openid: OPENID, ...binding } });
        return { success: true, message: '绑定成功 💕', binding };
      }
      case 'get_binding_status': {
        const bRes = await db.collection('bindings').where({ openid: OPENID, status: 'active' }).orderBy('boundAt', 'desc').limit(1).get();
        return { success: true, bound: bRes.data.length > 0, binding: bRes.data[0] || null };
      }
      case 'unbind_request': {
        const bRes = await db.collection('bindings').where({ openid: OPENID, status: 'active' }).limit(1).get();
        if (bRes.data.length === 0) return { success: false, error: '未绑定' };
        await db.collection('bindings').doc(bRes.data[0]._id).update({ data: { unbindRequestedAt: Date.now(), unbindStatus: 'pending' } });
        return { success: true, message: '解绑请求已提交，对方有24小时反悔期' };
      }
      case 'confirm_unbind': {
        const { confirmed, mode } = params;
        if (!confirmed) return { success: true, message: '已取消解绑' };
        const bRes = await db.collection('bindings').where({ openid: OPENID, status: 'active' }).limit(1).get();
        if (bRes.data.length > 0) {
          await db.collection('bindings').doc(bRes.data[0]._id).update({ data: { status: 'unbound', unboundAt: Date.now(), archiveMode: mode } });
        }
        if (mode === 'keep_copy') {
          const cols = ['date_records', 'wishes', 'moments', 'promises'];
          for (const col of cols) {
            const items = await db.collection(col).where({ openid: OPENID }).get();
            for (const item of items.data) {
              await db.collection(col).doc(item._id).update({ data: { _era: 'archived', _relationshipEndedAt: Date.now() } });
            }
          }
        } else {
          const cols = ['date_records', 'wishes', 'moments', 'promises', 'chat_history'];
          for (const col of cols) {
            const items = await db.collection(col).where({ openid: OPENID }).get();
            for (const item of items.data) { await db.collection(col).doc(item._id).remove(); }
          }
        }
        return { success: true, message: mode === 'keep_copy' ? '已解绑，回忆已保留 💕' : '已解绑，数据已清空' };
      }
      case 'check_clean_slate': {
        const archivedCount = (await db.collection('date_records').where({ openid: OPENID, _era: 'archived' }).count()).total;
        return { success: true, hasHistory: archivedCount > 0, historyCount: archivedCount };
      }
      case 'clear_archived_data': {
        const cols = ['date_records', 'wishes', 'moments', 'promises', 'chat_history'];
        for (const col of cols) {
          const items = await db.collection(col).where({ openid: OPENID, _era: 'archived' }).get();
          for (const item of items.data) { await db.collection(col).doc(item._id).remove(); }
        }
        return { success: true, message: '已清空所有历史记录' };
      }

      // ══ AI 调解 ══
      case 'request_mediation': {
        const { topic } = params;
        const sessionId = 'med_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        await db.collection('mediation_sessions').add({ data: { sessionId, openid: OPENID, topic: topic || '一些小矛盾', status: 'requested', createdAt: Date.now() } });
        return { success: true, sessionId, message: '调解请求已发送，等待对方确认' };
      }
      case 'confirm_mediation': {
        const { sessionId } = params;
        const sRes = await db.collection('mediation_sessions').where({ sessionId }).limit(1).get();
        if (sRes.data.length === 0) return { success: false, error: '调解会话不存在' };
        if (sRes.data[0].status === 'completed') return { success: false, error: '该调解已完成' };
        await db.collection('mediation_sessions').doc(sRes.data[0]._id).update({ data: { status: 'confirmed', confirmedAt: Date.now() } });
        return { success: true, sessionId, message: '双方已同意调解 🤝' };
      }

      // ══ 通知 ══
      case 'get_notification_state': {
        const nRes = await db.collection('notification_state').where({ openid: OPENID }).limit(1).get();
        return { success: true, state: nRes.data[0] || { greetingSentToday: 0 } };
      }
      case 'record_activity': {
        const today = new Date().toISOString().slice(0, 10);
        const nRes = await db.collection('notification_state').where({ openid: OPENID }).limit(1).get();
        if (nRes.data.length > 0) {
          await db.collection('notification_state').doc(nRes.data[0]._id).update({ data: { lastActiveDate: today } });
        } else {
          await db.collection('notification_state').add({ data: { openid: OPENID, lastActiveDate: today } });
        }
        return { success: true };
      }

      // ══ 主动提醒 ══
      case 'check_nudges': {
        const nudges = [];
        const DAY = 86400000;
        const now = Date.now();
        const datesRes = await db.collection('date_records').where({ openid: OPENID, _deletedAt: _.exists(false) }).orderBy('date', 'desc').limit(1).get();
        if (datesRes.data.length === 0) {
          nudges.push({ type: 'first_date', icon: '🎉', message: '你们还没有约会记录呢！要不要现在就策划第一次约会？', action: 'plan_date', priority: 'high' });
        } else {
          const gapDays = Math.floor((now - new Date(datesRes.data[0].date).getTime()) / DAY);
          if (gapDays >= 14) {
            nudges.push({ type: 'date_gap', icon: '📅', message: `你们已经 ${gapDays} 天没约会了，要不要我帮你们策划一个？`, action: 'plan_date', priority: 'high' });
          } else if (gapDays >= 7) {
            nudges.push({ type: 'date_gap', icon: '💡', message: `距离上次约会已经 ${gapDays} 天了，这周末要不要安排点什么？`, action: 'plan_date', priority: 'medium' });
          }
        }
        const pendingWishes = await db.collection('wishes').where({ openid: OPENID, status: 'pending', _deletedAt: _.exists(false) }).count();
        if (pendingWishes.total >= 3) {
          nudges.push({ type: 'wish_backlog', icon: '✨', message: `你们有 ${pendingWishes.total} 个愿望还没实现，要不要挑一个去做？`, action: 'view_wishes', priority: 'medium' });
        }
        return { success: true, nudges };
      }

      // ══ 音乐列表 ══
      case 'get_music_list': {
        return { success: true, data: [
          { id: 'bgm1', name: '暖心钢琴', icon: '🎹' },
          { id: 'bgm2', name: '浮游氛围', icon: '🌊' },
          { id: 'bgm3', name: '轻柔律动', icon: '🎵' },
        ]};
      }

      default:
        return { success: false, error: `未知操作: ${action}` };
    }
  } catch (err) {
    console.error('Agent 错误:', err);
    return { success: false, error: err.message };
  }
};

function calcStreak(checkins) {
  if (!checkins || checkins.length === 0) return 0;
  let streak = 0;
  for (let i = checkins.length - 1; i >= 0; i--) {
    if (i === checkins.length - 1) { streak = 1; continue; }
    const curr = new Date(checkins[i].date);
    const next = new Date(checkins[i + 1].date);
    const diff = Math.floor((next - curr) / 86400000);
    if (diff <= 1) streak++;
    else break;
  }
  return streak;
}
