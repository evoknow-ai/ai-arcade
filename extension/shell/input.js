// Unified keyboard / touch (swipe) / gamepad input. Emits abstract actions.
export class Input {
  constructor(target, { tapAction = true } = {}) {
    this.keys = new Set();
    this.listeners = [];
    this.target = target;
    this._onKeyDown = (e) => {
      const action = KEYMAP[e.code];
      if (!action) return;
      e.preventDefault();
      if (!this.keys.has(e.code)) this.emit(action);
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);

    let start = null;
    this._onTouchStart = (e) => { const t = e.touches[0]; start = { x: t.clientX, y: t.clientY }; };
    this._onTouchEnd = (e) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x, dy = t.clientY - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) { if (tapAction) this.emit("action"); start = null; return; }
      this.emit(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
      start = null;
    };
    target.addEventListener("touchstart", this._onTouchStart, { passive: true });
    target.addEventListener("touchend", this._onTouchEnd);
    this._gpPrev = {};
  }
  on(fn) { this.listeners.push(fn); }
  emit(action) { for (const fn of this.listeners) fn(action); }
  isDown(action) {
    for (const [code, a] of Object.entries(KEYMAP)) if (a === action && this.keys.has(code)) return true;
    return false;
  }
  pollGamepad() {
    const gp = navigator.getGamepads?.()[0];
    if (!gp) return;
    const axes = { left: gp.axes[0] < -0.5, right: gp.axes[0] > 0.5, up: gp.axes[1] < -0.5, down: gp.axes[1] > 0.5 };
    const btn = { action: gp.buttons[0]?.pressed, pause: gp.buttons[9]?.pressed, left: gp.buttons[14]?.pressed, right: gp.buttons[15]?.pressed, up: gp.buttons[12]?.pressed, down: gp.buttons[13]?.pressed };
    for (const [k, v] of Object.entries({ ...axes, ...btn })) {
      if (v && !this._gpPrev[k]) this.emit(k);
      this._gpPrev[k] = v;
    }
  }
  destroy() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    this.target.removeEventListener("touchstart", this._onTouchStart);
    this.target.removeEventListener("touchend", this._onTouchEnd);
  }
}

const KEYMAP = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right",
  Space: "action", Enter: "action", KeyP: "pause", Escape: "pause", KeyH: "hint",
};
