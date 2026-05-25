// ── 背景音乐管理器 ──
const app = getApp();

const PLAYLIST = [
  { id: 'bgm1', name: '暖心钢琴', src: '/music/bgm1_piano.wav', icon: '🎹' },
  { id: 'bgm2', name: '浮游氛围', src: '/music/bgm2_ambient.wav', icon: '🌊' },
  { id: 'bgm3', name: '轻柔律动', src: '/music/bgm3_lofi.wav', icon: '🎵' },
];

class AudioManager {
  constructor() {
    this.bgm = null;
    this.playing = false;
    this.currentTrack = 0;
    this.enabled = false;
    this._init();
  }

  _init() {
    try {
      this.bgm = wx.getBackgroundAudioManager();
      this.bgm.onEnded(() => this._next());
      this.bgm.onError(() => { this.playing = false; });
    } catch (e) {
      console.log('背景音频初始化失败:', e);
    }
  }

  get playlist() { return PLAYLIST; }
  get currentName() { return PLAYLIST[this.currentTrack] ? PLAYLIST[this.currentTrack].name : ''; }
  get currentIcon() { return PLAYLIST[this.currentTrack] ? PLAYLIST[this.currentTrack].icon : '🎵'; }

  _resolveUrl(src) {
    if (src.startsWith('http')) return src;
    const endpoint = (app && app.globalData && app.globalData.agent && app.globalData.agent.endpoint) || 'http://localhost:3001';
    const base = endpoint.replace('/api/agent', '');
    return base + src;
  }

  toggle() {
    if (this.playing) { this.pause(); } else { this.play(); }
  }

  play(index) {
    if (index !== undefined && index >= 0 && index < PLAYLIST.length) {
      this.currentTrack = index;
    }
    const track = PLAYLIST[this.currentTrack];
    if (!track || !this.bgm) return;

    this.enabled = true;
    this.bgm.title = track.name;
    this.bgm.src = this._resolveUrl(track.src);
    this.playing = true;
  }

  pause() {
    if (this.bgm) {
      this.bgm.pause();
      this.playing = false;
    }
  }

  stop() {
    if (this.bgm) {
      this.bgm.stop();
      this.playing = false;
    }
  }

  _next() {
    this.currentTrack = (this.currentTrack + 1) % PLAYLIST.length;
    this.play();
  }

  next() {
    this.currentTrack = (this.currentTrack + 1) % PLAYLIST.length;
    this.play();
  }

  prev() {
    this.currentTrack = (this.currentTrack - 1 + PLAYLIST.length) % PLAYLIST.length;
    this.play();
  }

  // 恢复播放（从设置页回来后）
  resume() {
    if (this.enabled && !this.playing) {
      this.play();
    }
  }

  setEnabled(val) {
    this.enabled = val;
    if (val) { this.play(); } else { this.stop(); }
  }
}

// 单例
let instance = null;
function getAudioManager() {
  if (!instance) instance = new AudioManager();
  return instance;
}

module.exports = { getAudioManager, PLAYLIST };
