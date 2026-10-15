// GameShell: every game gets a canvas, input, audio, a fixed-step loop, pause, timer,
// a deterministic RNG, an input log (for server replay verification) and a submitScore hook.
import { Input } from "./input.js";
import { Audio } from "./audio.js";

export class RNG {
  constructor(seed) { this.s = seed >>> 0 || 1; }
  next() { // mulberry32
    let t = (this.s += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n) { return Math.floor(this.next() * n); }
}

export class GameShell {
  constructor({ canvas, game, onEnd, onHud, seed }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.game = game;
    this.onEnd = onEnd;
    this.onHud = onHud || (() => {});
    this.seed = seed ?? (Date.now() >>> 0);
    this.rng = new RNG(this.seed);
    this.input = new Input(canvas);
    this.audio = new Audio();
    this.paused = false;
    this.ended = false;
    this.tick = 0;
    this.log = []; // [tick, action] pairs — compact replay log
    this.elapsed = 0;
    this.accum = 0;
    this.step = 1000 / (game.tps || 60);
    this.input.on((action) => {
      if (action === "pause") return this.togglePause();
      if (this.paused || this.ended) return;
      this.log.push(this.tick, ACTION_CODE[action] ?? 0);
      this.game.onInput?.(action, this);
    });
    this._resize = () => this.resize();
    window.addEventListener("resize", this._resize);
    this.resize();
  }
  resize() {
    const { width: w, height: h } = this.game.size || { width: 480, height: 480 };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
  }
  start() {
    this.game.init?.(this);
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
  frame(now) {
    if (this.ended) return;
    const dt = Math.min(100, now - this.last); this.last = now;
    this.input.pollGamepad();
    if (!this.paused) {
      this.accum += dt; this.elapsed += dt;
      while (this.accum >= this.step) {
        this.accum -= this.step; this.tick++;
        this.game.update?.(this);
        if (this.ended) break;
      }
    }
    this.game.render?.(this.ctx, this);
    if (this.paused) this.drawOverlay("Paused", "Press P or Esc to resume");
    this.onHud({ score: this.game.score ?? 0, level: this.game.level ?? 1, elapsed: this.elapsed, extra: this.game.hud?.() });
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
  togglePause() { if (!this.ended) this.paused = !this.paused; }
  drawOverlay(title, sub) {
    const c = this.ctx;
    c.save();
    c.fillStyle = "rgba(10,8,30,0.72)"; c.fillRect(0, 0, this.w, this.h);
    c.fillStyle = "#FFD447"; c.textAlign = "center"; c.font = "700 36px 'Avenir Next Condensed','Arial Narrow',sans-serif";
    c.fillText(title, this.w / 2, this.h / 2 - 8);
    c.fillStyle = "#F4EFE6"; c.font = "16px system-ui,sans-serif";
    if (sub) c.fillText(sub, this.w / 2, this.h / 2 + 24);
    c.restore();
  }
  end() {
    if (this.ended) return;
    this.ended = true;
    cancelAnimationFrame(this.raf);
    this.audio.gameOver();
    this.onEnd({ score: this.game.score ?? 0, level: this.game.level ?? 1, durationMs: Math.round(this.elapsed), log: { seed: this.seed, events: this.log, ticks: this.tick } });
  }
  destroy() { cancelAnimationFrame(this.raf); this.input.destroy(); window.removeEventListener("resize", this._resize); }
}

export const ACTION_CODE = { up: 1, down: 2, left: 3, right: 4, action: 5 };
