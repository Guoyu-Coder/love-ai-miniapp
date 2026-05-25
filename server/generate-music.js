// ── 生成暖心背景音乐 WAV ──
// 纯 Node.js，无需任何依赖，生成钢琴氛围音频
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const DURATION = 60; // 秒
const OUT_DIR = path.join(__dirname, 'music');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// WAV 文件写入
function writeWav(filename, samples) {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);       // chunk size
  buf.writeUInt16LE(1, 20);        // PCM
  buf.writeUInt16LE(1, 22);        // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);        // block align
  buf.writeUInt16LE(16, 34);       // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }

  fs.writeFileSync(path.join(OUT_DIR, filename), buf);
  console.log(`  ✅ ${filename} (${(buf.length / 1024).toFixed(0)} KB)`);
}

// 正弦波
function sine(freq, t) { return Math.sin(2 * Math.PI * freq * t); }

// ADSR 包络
function envelope(t, duration, attack = 0.02, decay = 0.1, sustain = 0.6, release = 0.3) {
  if (t < attack) return t / attack;
  if (t < attack + decay) return 1 - (1 - sustain) * ((t - attack) / decay);
  if (t < duration - release) return sustain;
  const rt = (t - (duration - release)) / release;
  return sustain * Math.max(0, 1 - rt);
}

// 混响（简单延迟叠加）
function reverb(samples, mix = 0.18, delay = 0.04) {
  const d = Math.round(delay * SAMPLE_RATE);
  const out = new Float32Array(samples.length + d + 2000);
  for (let i = 0; i < samples.length; i++) {
    out[i] += samples[i] * (1 - mix * 0.5);
    if (i + d < out.length) out[i + d] += samples[i] * mix * 0.5;
    if (i + d * 2 < out.length) out[i + d * 2] += samples[i] * mix * 0.25;
  }
  return out.slice(0, samples.length);
}

// ═══ 1. 暖心钢琴 ═══
function generatePiano() {
  // 和弦进行: C → G → Am → F (浪漫 I-V-vi-IV)
  const chords = [
    [261.63, 329.63, 392.00], // C major
    [196.00, 246.94, 329.63], // G major
    [220.00, 261.63, 329.63], // Am
    [174.61, 220.00, 261.63], // F major
  ];
  const chordDuration = 4; // 每和弦4秒
  const total = DURATION * SAMPLE_RATE;
  const samples = new Float32Array(total);

  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    const chordIdx = Math.floor(t / chordDuration) % chords.length;
    const chordT = t % chordDuration;
    const chord = chords[chordIdx];
    let v = 0;

    // 每个音添加谐波（模拟钢琴音色）
    for (const freq of chord) {
      const env = envelope(chordT, chordDuration, 0.03, 0.25, 0.5, 0.4);
      v += sine(freq, t) * 0.5 * env;
      v += sine(freq * 2, t) * 0.18 * env;  // 2nd harmonic
      v += sine(freq * 3, t) * 0.07 * env;  // 3rd harmonic
      v += sine(freq * 4, t) * 0.03 * env;  // 4th harmonic
    }

    // 轻柔低音根音
    const rootFreq = chord[0] / 2;
    v += sine(rootFreq, t) * 0.22 * envelope(chordT, chordDuration, 0.06, 0.5, 0.35, 0.5);

    samples[i] = v;
  }

  return reverb(samples, 0.2, 0.06);
}

// ═══ 2. 浮游氛围 ═══
function generateAmbient() {
  const total = DURATION * SAMPLE_RATE;
  const samples = new Float32Array(total);
  // 悬浮和弦: Dm7 → G7 → Cmaj7 → Am7
  const pads = [
    [293.66, 349.23, 440.00, 523.25], // Dm7
    [196.00, 246.94, 329.63, 392.00], // G7
    [261.63, 329.63, 392.00, 493.88], // Cmaj7
    [220.00, 261.63, 329.63, 440.00], // Am7
  ];

  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    const padIdx = Math.floor(t / 8) % pads.length;
    const padT = t % 8;
    const pad = pads[padIdx];
    let v = 0;

    for (const freq of pad) {
      const env = envelope(padT, 8, 0.15, 0.6, 0.55, 0.8);
      // 温暖正弦 + 轻微颤音
      const vibrato = Math.sin(2 * Math.PI * 5.5 * t) * 0.5;
      v += sine(freq + vibrato, t) * 0.3 * env;
      v += sine(freq * 2, t) * 0.08 * env;
    }
    samples[i] = v;
  }

  return reverb(samples, 0.35, 0.08);
}

// ═══ 3. 轻柔律动 ═══
function generateLofi() {
  const total = DURATION * SAMPLE_RATE;
  const samples = new Float32Array(total);
  // 简单旋律线 + 和弦垫底
  const melody = [
    261.63, 293.66, 329.63, 349.23, 392.00, 349.23, 329.63, 293.66,
    329.63, 349.23, 392.00, 440.00, 392.00, 349.23, 329.63, 261.63,
  ];
  const noteLen = 2; // 每音符2秒

  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    const noteIdx = Math.floor(t / noteLen) % melody.length;
    const noteT = t % noteLen;
    let v = 0;

    // 旋律音
    const freq = melody[noteIdx];
    v += sine(freq, t) * 0.35 * envelope(noteT, noteLen, 0.02, 0.15, 0.45, 0.4);
    v += sine(freq * 2, t) * 0.1 * envelope(noteT, noteLen, 0.02, 0.15, 0.3, 0.3);

    // 低频氛围垫
    const padFreq = [130.81, 164.81, 196.00, 220.00];
    const padIdx = Math.floor(t / 8) % padFreq.length;
    v += sine(padFreq[padIdx], t) * 0.12 * envelope(t % 8, 8, 0.2, 0.5, 0.4, 0.7);

    samples[i] = v;
  }

  return reverb(samples, 0.22, 0.05);
}

// ═══ 主程序 ═══
console.log('🎵 生成背景音乐 WAV 文件...\n');

console.log('1/3 暖心钢琴...');
writeWav('bgm1_piano.wav', generatePiano());

console.log('2/3 浮游氛围...');
writeWav('bgm2_ambient.wav', generateAmbient());

console.log('3/3 轻柔律动...');
writeWav('bgm3_lofi.wav', generateLofi());

console.log('\n✨ 音乐文件已生成到 server/music/ 目录');
console.log('   小程序将通过 http://localhost:3001/music/bgm1_piano.wav 等地址播放');
