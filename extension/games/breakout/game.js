// Brick Break — paddle, ball, bricks. Move with the mouse/touch or ←/→; Space launches. Bricks drop
// power-ups: wide paddle, multiball, slow ball, sticky paddle, extra life. Levels add tougher bricks.
const W = 560, H = 440, PW0 = 90, PH = 12, BR = 6, COLS = 12, BW = 42, BH = 16, OX = (W - COLS * BW) / 2;
const DIFFICULTY = {
  beginner:     { name: "Beginner",     speed: 3.6, lives: 5, paddle: 1.3 },
  intermediate: { name: "Intermediate", speed: 4.4, lives: 3, paddle: 1.0 },
  advanced:     { name: "Advanced",     speed: 5.2, lives: 2, paddle: 0.85 },
};
const POWERS = { wide: "Wide paddle", multi: "Multiball", slow: "Slow ball", sticky: "Sticky", life: "+1 life" };

export default function createBreakout({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0;
  const g = { id: "breakout", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, onHover, onPointer, hud };
  let paddle, balls, bricks, drops, lives, particles, popups, msg, msgTtl, shake, wideT, slowT, sticky, combo, trailPts;

  function init(sh) { g.score = 0; g.level = 1; lives = diff.lives; particles = []; popups = []; shake = 0; combo = 0; buildLevel(sh); }
  function buildLevel(sh) {
    bricks = []; drops = []; wideT = 0; slowT = 0; sticky = false; trailPts = [];
    const rows = Math.min(9, 4 + g.level);
    for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) {
      const pattern = g.level % 3 === 1 ? true : g.level % 3 === 2 ? (r + c) % 2 === 0 || r < 2 : Math.abs(c - COLS / 2 + 0.5) > r / 2 - 1;
      if (!pattern) continue;
      const hp = r < 2 && g.level > 2 ? 3 : r < 4 && g.level > 1 ? 2 : 1;
      bricks.push({ x: OX + c * BW, y: 50 + r * (BH + 4), hp, max: hp, power: sh.rng.next() < 0.12 ? Object.keys(POWERS)[sh.rng.int(5)] : null, r });
    }
    paddle = { x: W / 2, w: PW0 * diff.paddle };
    resetBall(); say(`Level ${g.level}`, 100);
  }
  function resetBall() { balls = [{ x: paddle.x, y: H - 40, vx: 0, vy: 0, stuck: true }]; }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x, y, text, color, ttl: 50 }); }

  function onHover(px) { if (px >= 0 && !g.autopilot) paddle.x = Math.max(paddle.w / 2, Math.min(W - paddle.w / 2, px)); }
  function onPointer(px, py, sh) { sh.record(1000 + Math.round(px)); launch(sh); }
  function onInput(action, sh) { if (action === "action") launch(sh); }
  function launch(sh) { for (const b of balls) if (b.stuck) { b.stuck = false; b.vx = (sh.rng.next() - 0.5) * 3; b.vy = -diff.speed; sh.audio.blip(); } }

  function update(sh) {
    tick = sh.tick;
    if (msgTtl > 0) msgTtl--; if (shake > 0) shake--; if (wideT > 0 && --wideT === 0) paddle.w = PW0 * diff.paddle; if (slowT > 0) slowT--;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.12; }
    popups = popups.filter(p => (p.ttl -= 1) > 0);
    const spd = 4; if (sh.input?.isDown?.("left")) paddle.x -= spd * 1.6; if (sh.input?.isDown?.("right")) paddle.x += spd * 1.6;
    if (g.autopilot) { const b = balls.filter(b => !b.stuck).sort((a, b) => b.y - a.y)[0] || balls[0]; paddle.x += ((b.x + (b.vx || 0) * 6 + Math.sin(tick / 90) * paddle.w * 0.35) - paddle.x) * 0.2; if (balls.some(b => b.stuck) && tick % 60 === 0) launch(sh); }
    paddle.x = Math.max(paddle.w / 2, Math.min(W - paddle.w / 2, paddle.x));
    for (const b of balls) {
      if (b.stuck) { b.x = paddle.x + (b.off || 0); b.y = H - 40; continue; }
      const k = slowT > 0 ? 0.6 : 1;
      b.x += b.vx * k; b.y += b.vy * k;
      if (b.x < BR) { b.x = BR; b.vx = Math.abs(b.vx); } if (b.x > W - BR) { b.x = W - BR; b.vx = -Math.abs(b.vx); }
      if (b.y < 36 + BR) { b.y = 36 + BR; b.vy = Math.abs(b.vy); }
      // paddle
      if (b.vy > 0 && b.y + BR >= H - 30 && b.y - BR <= H - 30 + PH && Math.abs(b.x - paddle.x) <= paddle.w / 2 + BR) {
        const rel = (b.x - paddle.x) / (paddle.w / 2); const ang = rel * 1.1; const sp = Math.hypot(b.vx, b.vy);
        b.vx = Math.sin(ang) * sp; b.vy = -Math.cos(ang) * sp; if (Math.abs(b.vx) < 1) b.vx = (b.vx < 0 || (b.vx === 0 && sh.rng.next() < 0.5) ? -1 : 1) * (1 + sh.rng.next()); b.y = H - 30 - BR; combo = 0; sh.audio.blip();
        if (sticky) { b.stuck = true; b.off = b.x - paddle.x; }
      }
      // bricks
      for (const br of bricks) {
        if (br.hp <= 0) continue;
        if (b.x + BR > br.x && b.x - BR < br.x + BW && b.y + BR > br.y && b.y - BR < br.y + BH) {
          const ox = Math.min(b.x + BR - br.x, br.x + BW - (b.x - BR)), oy = Math.min(b.y + BR - br.y, br.y + BH - (b.y - BR));
          if (ox < oy) b.vx *= -1; else b.vy *= -1;
          br.hp--; combo++;
          const pts = (10 * br.max + 5 * br.r) * (1 + Math.min(5, combo - 1) * 0.5) | 0; g.score += pts; pop(br.x + BW / 2, br.y, "+" + pts, T?.marquee);
          if (br.hp <= 0) { burst(br.x + BW / 2, br.y + BH / 2, 12, brickColor(br), sh); if (br.power) drops.push({ x: br.x + BW / 2, y: br.y, kind: br.power }); sh.audio.eat(); } else sh.audio.tone({ freq: 300, type: "square", dur: 0.05, vol: 0.08 });
          break;
        }
      }
      if (b.y > H + 10) b.dead = true;
    }
    balls = balls.filter(b => !b.dead);
    if (!balls.length) { lives--; shake = 14; sh.audio.hit(); if (lives <= 0) { say("Game over", 60); return sh.end(); } say(`${lives} ${lives === 1 ? "life" : "lives"} left`, 80); paddle.w = PW0 * diff.paddle; sticky = false; resetBall(); }
    for (const d of drops) {
      d.y += 1.6;
      if (d.y > H - 34 && d.y < H - 30 + PH + 8 && Math.abs(d.x - paddle.x) < paddle.w / 2 + 10) { d.dead = true; applyPower(d.kind, sh); }
      if (d.y > H + 10) d.dead = true;
    }
    drops = drops.filter(d => !d.dead);
    if (!bricks.some(b => b.hp > 0)) { g.score += 500 + lives * 100; sh.wallet?.earn(10 + g.level * 3); pop(W / 2, H / 2, `Level ${g.level} clear! +${500 + lives * 100}`, T?.marquee); g.level++; sh.audio.levelUp(); buildLevel(sh); }
  }
  function applyPower(kind, sh) {
    pop(paddle.x, H - 50, POWERS[kind], T?.cyan); sh.audio.levelUp();
    if (kind === "wide") { paddle.w = PW0 * diff.paddle * 1.6; wideT = 900; }
    if (kind === "slow") slowT = 600;
    if (kind === "sticky") sticky = true;
    if (kind === "life") lives++;
    if (kind === "multi") { const src = balls.find(b => !b.stuck) || balls[0]; for (let i = 0; i < 2; i++) { const a = (i ? 0.5 : -0.5); balls.push({ x: src.x, y: src.y, vx: src.vx * Math.cos(a) - src.vy * Math.sin(a) || 2, vy: src.vx * Math.sin(a) + src.vy * Math.cos(a) || -diff.speed, stuck: false }); } }
  }
  function burst(x, y, n, color, sh) { for (let i = 0; i < n; i++) { const a = sh.rng.next() * 6.28, sp = 1 + sh.rng.next() * 3; particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, ttl: 20 + sh.rng.int(25), color }); } }
  function brickColor(br) { return [T?.cyan, T?.marquee, T?.accent][br.max - 1] || T?.cyan; }
  function hud() { return `${diff.name} · level ${g.level} · ${lives} lives · ${bricks.filter(b => b.hp > 0).length} bricks${sticky ? " · sticky" : ""}${wideT ? " · wide" : ""}${slowT ? " · slow" : ""}`; }

  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    c.save(); if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.6, (Math.random() - 0.5) * shake * 0.6);
    const bg = c.createRadialGradient(W / 2, H * 0.3, 20, W / 2, H / 2, W * 0.8); bg.addColorStop(0, T.bgGlow1); bg.addColorStop(1, T.bg);
    c.fillStyle = bg; c.fillRect(-10, -10, W + 20, H + 20);
    c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(0, 0, W, 36);
    c.fillStyle = "#fff"; c.font = "700 14px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(`Level ${g.level}`, 14, 18);
    c.fillStyle = T.accent; for (let i = 0; i < lives; i++) { c.beginPath(); c.arc(W - 16 - i * 16, 18, 5, 0, 7); c.fill(); }
    for (const br of bricks) {
      if (br.hp <= 0) continue;
      const col = brickColor(br);
      c.fillStyle = "#00000055"; rr(c, br.x + 2, br.y + 3, BW - 3, BH - 2, 4); c.fill();
      const grd = c.createLinearGradient(br.x, br.y, br.x, br.y + BH); grd.addColorStop(0, shade(col, 0.35)); grd.addColorStop(1, shade(col, -0.35));
      c.fillStyle = grd; c.globalAlpha = 0.45 + 0.55 * (br.hp / br.max); rr(c, br.x + 1, br.y + 1, BW - 3, BH - 2, 4); c.fill(); c.globalAlpha = 1;
      c.fillStyle = "#ffffff33"; rr(c, br.x + 3, br.y + 2, BW - 7, 3, 2); c.fill();
      if (br.power) { c.fillStyle = "#fff"; c.font = "800 9px system-ui,sans-serif"; c.textAlign = "center"; c.fillText("★", br.x + BW / 2, br.y + BH / 2 + 1); }
    }
    for (const d of drops) { c.fillStyle = T.marquee; c.shadowColor = T.marquee; c.shadowBlur = 10; rr(c, d.x - 14, d.y - 7, 28, 14, 7); c.fill(); c.shadowBlur = 0; c.fillStyle = "#000"; c.font = "800 9px system-ui,sans-serif"; c.textAlign = "center"; c.fillText({ wide: "WIDE", multi: "×3", slow: "SLOW", sticky: "GLUE", life: "+1" }[d.kind], d.x, d.y + 1); }
    // paddle
    const px = paddle.x - paddle.w / 2, py = H - 30;
    c.fillStyle = "#00000066"; rr(c, px + 2, py + 4, paddle.w, PH, 6); c.fill();
    const pg = c.createLinearGradient(0, py, 0, py + PH); pg.addColorStop(0, shade(sticky ? T.marquee : T.cyan, 0.4)); pg.addColorStop(1, shade(sticky ? T.marquee : T.cyan, -0.4));
    c.fillStyle = pg; c.shadowColor = T.cyan; c.shadowBlur = 12; rr(c, px, py, paddle.w, PH, 6); c.fill(); c.shadowBlur = 0;
    for (const b of balls) { c.shadowColor = "#fff"; c.shadowBlur = 14; const bgd = c.createRadialGradient(b.x - 2, b.y - 2, 1, b.x, b.y, BR); bgd.addColorStop(0, "#fff"); bgd.addColorStop(1, T.cyan); c.fillStyle = bgd; c.beginPath(); c.arc(b.x, b.y, BR, 0, 7); c.fill(); c.shadowBlur = 0; }
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 15); c.fillStyle = p.color; c.fillRect(p.x, p.y, 3, 3); } c.globalAlpha = 1;
    for (const p of popups) { const k = 1 - p.ttl / 50; c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color || "#fff"; c.font = "800 13px system-ui,sans-serif"; c.textAlign = "center"; c.shadowColor = "#000"; c.shadowBlur = 5; c.fillText(p.text, p.x, p.y - k * 20); c.shadowBlur = 0; } c.globalAlpha = 1;
    if (balls.some(b => b.stuck) && !g.autopilot) { c.fillStyle = "#fff"; c.globalAlpha = 0.6 + 0.3 * Math.sin(tick / 10); c.font = "13px system-ui,sans-serif"; c.textAlign = "center"; c.fillText("Space or click to launch", W / 2, H - 60); c.globalAlpha = 1; }
    if (msgTtl > 0 && msg) { c.font = "800 24px 'Chakra Petch',system-ui,sans-serif"; c.textAlign = "center"; c.fillStyle = T.marquee; c.shadowColor = "#000"; c.shadowBlur = 10; c.globalAlpha = Math.min(1, msgTtl / 20); c.fillText(msg, W / 2, H / 2); c.shadowBlur = 0; c.globalAlpha = 1; }
    c.restore();
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
