// ── AI Agent 对话页面 - 多对话版 ──
const { AgentClient } = require('../../utils/agent');
const { getAudioManager } = require('../../utils/audio');
const api = require('../../utils/api');

Page({
  data: {
    messages: [],
    conversations: [],
    activeConvId: null,
    currentTitle: '小爱 AI',
    inputText: '',
    musicPlaying: false,
    thinking: false,
    showBanner: false,
    toolHint: '',
    recording: false,
    drawerOpen: false,
    // 雷区3: 调解状态
    mediationSessionId: '',
    mediationStatus: '',  // '' | 'requested' | 'confirmed'
    // 推理过程可视化
    thinkingSteps: [],
    showSteps: false
  },

  onLoad() {
    this.agent = new AgentClient();
    this.refreshUI();
  },

  onShow() {
    this.refreshUI();
    this.syncMusicState();
  },

  syncMusicState() {
    const audio = getAudioManager();
    this.setData({ musicPlaying: audio.enabled && audio.playing });
  },

  toggleFloatingMusic() {
    wx.vibrateShort({ type: 'light' });
    const audio = getAudioManager();
    audio.toggle();
    this.setData({ musicPlaying: audio.playing });
  },

  onUnload() {
    this.agent.saveToStorage();
  },

  // ══ UI 刷新 ══
  refreshUI() {
    const msgs = this.agent.getActiveMessages();
    const convs = this.agent.getAllConversations();
    const activeConv = this.agent.getActiveConv();

    // 格式化时间
    const now = Date.now();
    const convsFormatted = convs.map(c => ({
      ...c,
      updatedText: this.formatTime(now - c.updatedAt)
    }));

    this.setData({
      messages: msgs.map(m => ({ role: m.role, content: m.content })),
      conversations: convsFormatted,
      activeConvId: this.agent.activeConvId,
      currentTitle: activeConv ? activeConv.title : '小爱 AI'
    });
  },

  formatTime(diff) {
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
    return new Date(Date.now() - diff).toISOString().slice(0, 10);
  },

  // ══ 侧边栏 ══
  openDrawer() {
    wx.vibrateShort({ type: 'light' });
    this.setData({ drawerOpen: true });
  },
  closeDrawer() {
    this.setData({ drawerOpen: false });
  },

  // ══ 对话管理 ══
  newConversation() {
    wx.vibrateShort({ type: 'light' });
    this.agent.createConversation('新对话');
    this.refreshUI();
    this.setData({ drawerOpen: false });
  },

  switchConv(e) {
    wx.vibrateShort({ type: 'light' });
    const id = e.currentTarget.dataset.id;
    this.agent.switchConversation(id);
    this.refreshUI();
    this.setData({ drawerOpen: false });
  },

  deleteConv(e) {
    wx.vibrateShort({ type: 'medium' });
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除对话',
      content: '确定要删除这个对话吗？删除后不可恢复。',
      confirmText: '删除',
      confirmColor: '#E8668A',
      success: (res) => {
        if (res.confirm) {
          this.agent.deleteConversation(id);
          this.refreshUI();
          wx.showToast({ title: '已删除', icon: 'success', duration: 1000 });
        }
      }
    });
  },

  clearCurrentConv() {
    wx.vibrateShort({ type: 'medium' });
    const msgs = this.agent.getActiveMessages();
    if (msgs.length === 0) {
      wx.showToast({ title: '已经是空的～', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '清空对话',
      content: '确定要清空当前对话的所有消息吗？',
      confirmText: '清空',
      confirmColor: '#E8668A',
      success: (res) => {
        if (res.confirm) {
          this.agent.clearCurrentConversation();
          this.refreshUI();
          wx.showToast({ title: '已清空 🧹', icon: 'success', duration: 1000 });
        }
      }
    });
  },

  // ══ 消息发送 ══
  onInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  async sendMessage() {
    const text = this.data.inputText.trim();
    if (!text || this.data.thinking) return;

    wx.vibrateShort({ type: 'light' });

    const conv = this.agent.getActiveConv();
    const oldTitle = conv ? conv.title : '小爱 AI';

    // 同步写入 agent 的会话对象（sendStream 从 conv.messages 读取最后一条 user 消息）
    if (conv) {
      conv.messages.push({ role: 'user', content: text });
      conv.updatedAt = Date.now();
    }

    this.setData({
      messages: [...this.data.messages, { role: 'user', content: text }],
      inputText: '',
      thinking: true,
      toolHint: '',
      currentTitle: oldTitle,
      thinkingSteps: [],
      showSteps: false
    });

    // 添加一个空的 assistant 消息占位（流式写入目标）
    this.setData({
      messages: [...this.data.messages, { role: 'assistant', content: '' }]
    });

    const updateMsg = (fullText) => {
      const msgs = this.data.messages;
      if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
        msgs[msgs.length - 1].content = fullText;
        this.setData({ messages: msgs });
      }
    };

    let streamDone = false;
    // 超时回退：8秒内没收到任何 chunk 则回退到 HTTP
    const fallbackTimer = setTimeout(() => {
      if (!streamDone) {
        this.fallbackToHttp(text, updateMsg);
      }
    }, 8000);

    this.agent.sendStream(
      (chunk, fullText) => {
        clearTimeout(fallbackTimer);
        updateMsg(fullText);
      },
      (steps) => {
        clearTimeout(fallbackTimer);
        this.setData({ thinkingSteps: steps, showSteps: true });
      },
      (result) => {
        streamDone = true;
        clearTimeout(fallbackTimer);
        if (result.toolCalls > 0) {
          this.setData({ toolHint: `小爱使用了 ${result.toolCalls} 个工具来帮你～` });
          setTimeout(() => this.setData({ toolHint: '' }), 3000);
        }
        this.refreshUI();
        this.setData({ thinking: false });
      }
    );
  },

  async fallbackToHttp(text, updateMsg) {
    // WebSocket 超时，回退到 HTTP
    const result = await this.agent.send(text);
    if (result) {
      if (result.toolCalls > 0) {
        this.setData({ toolHint: `小爱使用了 ${result.toolCalls} 个工具来帮你～` });
        setTimeout(() => this.setData({ toolHint: '' }), 3000);
      }
      if (result.steps && result.steps.length > 0) {
        this.setData({ thinkingSteps: result.steps, showSteps: true });
      }
      updateMsg(result.reply);
      this.refreshUI();
    }
    this.setData({ thinking: false });
  },

  quickAsk(e) {
    wx.vibrateShort({ type: 'light' });
    const text = e.currentTarget.dataset.text;
    this.setData({ inputText: text }, () => this.sendMessage());
  },

  // ══ 雷区3: 调解流程 ══
  requestMediation() {
    wx.vibrateShort({ type: 'medium' });
    wx.showModal({
      title: '🕊️ 请求调解',
      content: '请简单描述你们想讨论的问题',
      editable: true,
      placeholderText: '比如：周末去哪玩的意见不合',
      confirmText: '发起请求',
      confirmColor: '#FF7BA6',
      success: async (r) => {
        if (r.confirm && r.content) {
          try {
            const res = await api.requestMediation(r.content.trim());
            if (res.success) {
              this.setData({
                mediationSessionId: res.sessionId,
                mediationStatus: 'requested'
              });
              wx.showModal({
                title: '✅ 调解请求已发送',
                content: `会话ID: ${res.sessionId}\n\n请将ID分享给TA，让对方在聊天页点击「确认调解」输入此ID确认。`,
                showCancel: false,
                confirmText: '知道了'
              });
            } else {
              wx.showToast({ title: res.error || '请求失败', icon: 'none' });
            }
          } catch { wx.showToast({ title: '网络错误', icon: 'none' }); }
        }
      }
    });
  },

  confirmMediation() {
    wx.vibrateShort({ type: 'medium' });
    wx.showModal({
      title: '🤝 确认调解',
      content: '请输入TA分享的调解会话ID',
      editable: true,
      placeholderText: '如 med_1712345678_abc',
      confirmText: '确认加入',
      confirmColor: '#FF7BA6',
      success: async (r) => {
        if (r.confirm && r.content) {
          try {
            const res = await api.confirmMediation(r.content.trim());
            if (res.success) {
              this.setData({
                mediationSessionId: res.sessionId,
                mediationStatus: 'confirmed'
              });
              wx.showToast({ title: '调解已确认 🤝', icon: 'success', duration: 2000 });
              // 自动发送一条系统消息引导对话
              this.setData({
                messages: [...this.data.messages, {
                  role: 'assistant',
                  content: '🤝 双方已同意调解。我是你们的情感翻译官，不会评判对错，只帮你们把心里话翻译给对方听。请谁先说说发生了什么？'
                }]
              });
            } else {
              wx.showToast({ title: res.error || '确认失败', icon: 'none' });
            }
          } catch { wx.showToast({ title: '网络错误', icon: 'none' }); }
        }
      }
    });
  },

  clearMediation() {
    this.setData({ mediationSessionId: '', mediationStatus: '' });
  },

  toggleSteps() {
    this.setData({ showSteps: !this.data.showSteps });
  },

  // ══ 语音输入 ══
  startRecord() {
    this.setData({ recording: true });
    const recorderManager = wx.getRecorderManager();
    recorderManager.start({ format: 'mp3', duration: 30000 });

    recorderManager.onStop((res) => {
      this.setData({ recording: false });
      if (!res.tempFilePath) return;
      wx.showLoading({ title: '识别中...' });
      // 简化版：直接提示
      wx.hideLoading();
      wx.showToast({ title: '请用文字输入（语音功能需配置插件）', icon: 'none', duration: 2000 });
    });
  },

  stopRecord() {
    if (!this.data.recording) return;
    const recorderManager = wx.getRecorderManager();
    recorderManager.stop();
  }
});
