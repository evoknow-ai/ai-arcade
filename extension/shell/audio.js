// Synthesized SFX via Web Audio — no asset files, no licensing.
export class Audio {
  constructor() { this.ctx = null; this.muted = false; }
  ensure() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === "suspended") this.ctx.resume(); }
  tone({ freq = 440, type = "square", dur = 0.08, vol = 0.15, slide = 0 }) {
    if (this.muted) return;
    this.ensure();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    gain.gain.setValueAtTime(vol, t); gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t); osc.stop(t + dur);
  }
  blip() { this.tone({ freq: 880, dur: 0.05 }); }
  eat() { this.tone({ freq: 520, type: "triangle", dur: 0.09, slide: 400 }); }
  hit() { this.tone({ freq: 160, type: "sawtooth", dur: 0.25, slide: -120, vol: 0.2 }); }
  levelUp() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone({ freq: f, type: "triangle", dur: 0.12 }), i * 70)); }
  gameOver() { [330, 262, 196, 131].forEach((f, i) => setTimeout(() => this.tone({ freq: f, type: "sawtooth", dur: 0.2, vol: 0.12 }), i * 140)); }
}
