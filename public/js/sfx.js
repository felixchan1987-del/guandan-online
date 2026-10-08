import { settings } from './settings.js';

// —— 音效：用 Web Audio 现场合成，不需要音频文件 ——
export const sfx = (() => {
  let ctx = null;
  const ac = () => {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  const tone = (freq, dur, { type = 'sine', vol = 0.15, delay = 0, slide = 0 } = {}) => {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  };
  const noise = (dur, vol, cutoff = 1200) => {
    const c = ac();
    if (!c) return;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = c.createBufferSource();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    src.buffer = buf;
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.value = vol;
    src.connect(f).connect(g).connect(c.destination);
    src.start();
  };
  const on = () => settings.sound === 'on';
  return {
    unlock() { if (on()) ac(); },
    play() { if (on()) { noise(0.06, 0.35, 3000); tone(420, 0.06, { type: 'triangle', vol: 0.12 }); } },
    pass() { if (on()) tone(320, 0.08, { vol: 0.08 }); },
    bomb() { if (on()) { noise(0.7, 0.9, 900); tone(150, 0.6, { type: 'sawtooth', vol: 0.22, slide: -100 }); } },
    turn() { if (on()) { tone(660, 0.12, { vol: 0.12 }); tone(990, 0.18, { vol: 0.12, delay: 0.12 }); } },
    warn() { if (on()) { tone(880, 0.12, { type: 'square', vol: 0.07 }); tone(880, 0.12, { type: 'square', vol: 0.07, delay: 0.18 }); } },
    tick() { if (on()) tone(1200, 0.04, { type: 'square', vol: 0.05 }); },
    win() { if (on()) [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, { vol: 0.13, delay: i * 0.12 })); },
    lose() { if (on()) [392, 330, 262].forEach((f, i) => tone(f, 0.25, { vol: 0.1, delay: i * 0.15 })); },
  };
})();
