// ── Agent 客户端（多对话管理 + 持久化）──

const app = getApp();
const STORAGE_KEY = 'love_conversations';

function cleanMarkdown(text) {
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

function genId() {
  return 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

class AgentClient {
  constructor() {
    this.conversations = [];
    this.activeConvId = null;
    this.isThinking = false;
    this.loadFromStorage();
  }

  // ══ 持久化 ══
  loadFromStorage() {
    try {
      const data = wx.getStorageSync(STORAGE_KEY);
      this.conversations = data && data.length > 0 ? data : [];
      this.activeConvId = this.conversations.length > 0 ? this.conversations[0].id : null;
    } catch {
      this.conversations = [];
      this.activeConvId = null;
    }
  }

  saveToStorage() {
    try {
      // 只保留最近 50 条消息的摘要，控制存储体积
      const compact = this.conversations.map(c => ({
        ...c,
        messages: c.messages.slice(-50),
        _totalMessages: c.messages.length
      }));
      wx.setStorageSync(STORAGE_KEY, compact);
    } catch (e) {
      console.log('存储空间不足，保留最近对话');
      // 只保留最近 5 个对话
      wx.setStorageSync(STORAGE_KEY, this.conversations.slice(-5).map(c => ({
        ...c,
        messages: c.messages.slice(-30)
      })));
    }
  }

  // ══ 对话管理 ══
  getActiveConv() {
    if (!this.activeConvId && this.conversations.length > 0) {
      this.activeConvId = this.conversations[0].id;
    }
    if (!this.activeConvId) return null;
    return this.conversations.find(c => c.id === this.activeConvId) || null;
  }

  getActiveMessages() {
    const conv = this.getActiveConv();
    return conv ? conv.messages : [];
  }

  getAllConversations() {
    return this.conversations.map(c => ({
      id: c.id,
      title: c.title,
      messageCount: c.messages.length,
      lastMessage: c.messages.length > 0
        ? c.messages[c.messages.length - 1].content.slice(0, 30)
        : '',
      updatedAt: c.updatedAt,
      createdAt: c.createdAt
    }));
  }

  createConversation(title) {
    const conv = {
      id: genId(),
      title: title || '新对话',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.conversations.unshift(conv);
    this.activeConvId = conv.id;
    this.saveToStorage();
    return conv;
  }

  switchConversation(id) {
    const conv = this.conversations.find(c => c.id === id);
    if (conv) {
      this.activeConvId = id;
      return true;
    }
    return false;
  }

  deleteConversation(id) {
    const idx = this.conversations.findIndex(c => c.id === id);
    if (idx === -1) return false;

    this.conversations.splice(idx, 1);

    if (id === this.activeConvId) {
      this.activeConvId = this.conversations.length > 0 ? this.conversations[0].id : null;
      // 如果全删光了，自动建一个
      if (!this.activeConvId) {
        this.createConversation('新对话');
      }
    }
    this.saveToStorage();
    return true;
  }

  clearCurrentConversation() {
    const conv = this.getActiveConv();
    if (conv) {
      conv.messages = [];
      conv.updatedAt = Date.now();
      this.saveToStorage();
    }
  }

  // ══ 发送消息 ══
  async send(message) {
    if (!message.trim() || this.isThinking) return null;

    this.isThinking = true;

    // 确保有活跃对话
    let conv = this.getActiveConv();
    if (!conv) {
      // 用第一条消息的前 20 个字作为对话标题
      const title = message.slice(0, 20) + (message.length > 20 ? '...' : '');
      conv = this.createConversation(title);
    }

    // 如果是第一条消息，更新标题
    if (conv.messages.length === 0) {
      conv.title = message.slice(0, 20) + (message.length > 20 ? '...' : '');
    }

    conv.messages.push({ role: 'user', content: message });
    conv.updatedAt = Date.now();

    try {
      // 准备发送给服务器的历史（只带当前对话）
      const history = conv.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-20)
        .map(m => ({ role: m.role, content: m.content }));

      const endpoint = (app && app.globalData && app.globalData.agent && app.globalData.agent.endpoint)
        || 'http://localhost:3001/api/agent';

      const settings = (app && app.globalData && app.globalData.settings) || {};
      const nick1 = settings.nick1Custom || settings.nick1 || '';
      const nick2 = settings.nick2Custom || settings.nick2 || '';

      const result = await new Promise((resolve) => {
        wx.request({
          url: endpoint,
          method: 'POST',
          data: { action: 'chat', message, history, conversationId: conv.id, nick1, nick2 },
          timeout: 30000,
          success(r) { resolve(r.data); },
          fail(err) { resolve({ success: false, error: err.errMsg }); }
        });
      });

      if (result.success) {
        const cleanReply = cleanMarkdown(result.reply);
        conv.messages.push({ role: 'assistant', content: cleanReply });
        conv.updatedAt = Date.now();
        this.saveToStorage();
        return { reply: cleanReply, toolCalls: result.toolCalls, steps: result.steps };
      }

      conv.messages.push({ role: 'assistant', content: '小爱大脑短路了...再试一次好吗 🥺' });
      this.saveToStorage();
      return { reply: '小爱大脑短路了...再试一次好吗 🥺', toolCalls: 0 };
    } catch (err) {
      console.error('Agent 通信失败:', err);
      return { reply: '网络有点问题，稍等再试试 🌸', toolCalls: 0 };
    } finally {
      this.isThinking = false;
    }
  }

  // ══ 流式发送（WebSocket）══
  connectWS() {
    if (this._ws && this._ws.readyState === 1) return this._ws;
    const baseUrl = (app && app.globalData && app.globalData.agent && app.globalData.agent.endpoint)
      || 'http://localhost:3001/api/agent';
    const wsUrl = baseUrl.replace('/api/agent', '').replace('http://', 'ws://').replace('https://', 'wss://') + '/ws';
    const ws = wx.connectSocket({ url: wsUrl });
    this._ws = ws;
    this._wsReady = false;
    ws.onOpen(() => { this._wsReady = true; });
    ws.onClose(() => { this._wsReady = false; this._ws = null; });
    ws.onError(() => { this._wsReady = false; this._ws = null; });
    return ws;
  }

  sendStream(onChunk, onStep, onDone) {
    const conv = this.getActiveConv();
    if (!conv) return;

    const history = conv.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content }));

    const settings = (app && app.globalData && app.globalData.settings) || {};
    const nick1 = settings.nick1Custom || settings.nick1 || '';
    const nick2 = settings.nick2Custom || settings.nick2 || '';

    const ws = this.connectWS();
    const sendData = () => {
      const lastMsg = conv.messages.filter(m => m.role === 'user').pop();
      ws.send({
        data: JSON.stringify({
          type: 'chat_stream',
          message: lastMsg.content,
          history,
          nick1,
          nick2,
        })
      });
    };

    if (this._wsReady) {
      sendData();
    } else {
      ws.onOpen(() => { sendData(); });
    }

    let fullReply = '';
    ws.onMessage((res) => {
      try {
        const data = JSON.parse(res.data);
        if (data.type === 'chunk') {
          fullReply += data.content;
          onChunk && onChunk(data.content, fullReply);
        } else if (data.type === 'steps') {
          onStep && onStep(data.steps);
        } else if (data.type === 'done') {
          const cleanReply = cleanMarkdown(data.reply || fullReply);
          if (conv) {
            conv.messages.push({ role: 'assistant', content: cleanReply });
            conv.updatedAt = Date.now();
            this.saveToStorage();
          }
          this.isThinking = false;
          onDone && onDone({ reply: cleanReply, toolCalls: data.toolCalls, steps: data.steps });
        } else if (data.type === 'error') {
          this.isThinking = false;
          onDone && onDone({ reply: '小爱大脑短路了...再试一次好吗 🥺', toolCalls: 0 });
        }
      } catch {}
    });
  }

  // ══ 兼容旧 API ══
  get history() {
    return this.getActiveMessages().filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }));
  }

  loadLocalHistory() {
    const msgs = this.getActiveMessages();
    return msgs.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }));
  }

  saveLocalHistory() {
    this.saveToStorage();
  }
}

module.exports = { AgentClient };
