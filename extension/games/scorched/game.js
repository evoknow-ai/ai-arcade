// Scorched Ridge — turn-based artillery on destructible terrain against an AI gunner.
// Keyboard: ←/→ angle, ↑/↓ power, Space fire. Mouse/touch: hover to aim (angle + power follow the
// pointer), click to fire. Wind changes every turn. Shells carve craters; a tank with no ground under
// it falls. Beat the AI to move to the next ridge; the AI gets sharper every level.
const W = 640, H = 400, G = 0.11;

const DIFFICULTY = {
  beginner:     { name: "Beginner",     aiNoise: 14, aiLearn: 0.4, hp: 150, windMax: 1.0 },
  intermediate: { name: "Intermediate", aiNoise: 8,  aiLearn: 0.6, hp: 100, windMax: 1.8 },
  advanced:     { name: "Advanced",     aiNoise: 4,  aiLearn: 0.8, hp: 80,  windMax: 2.6 },
};

export default function createScorched({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null;
  const g = { id: "scorched", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, onPointer, onHover, hud };
  let ground, tanks, turn, shell, wind, particles, popups, msg, msgTtl, shake, aiMemory, phase, phaseT, aim, hoverAim, stars;

  function init(shell_) {
    g.score = 0; g.level = 1; particles = []; popups = []; shake = 0;
    aiMemory = { angle: 55, power: 60, lastMiss: 0 };
    stars = Array.from({ length: 60 }, () => [shell_.rng.next() * W, shell_.rng.next() * H * 0.6, shell_.rng.next()]);
    newRound(shell_);
  }

  function newRound(sh) {
    // terrain: layered sine ridge with noise, stored as height per x column
    const base = 220 + sh.rng.int(60), a1 = 30 + sh.rng.int(50), a2 = 10 + sh.rng.int(30), f1 = 0.004 + sh.rng.next() * 0.006, f2 = 0.02 + sh.rng.next() * 0.02, ph = sh.rng.next() * 9;
    ground = new Float32Array(W);
    for (let x = 0; x < W; x++) ground[x] = base + Math.sin(x * f1 + ph) * a1 + Math.sin(x * f2) * a2 + Math.sin(x * 0.11) * 3;
    const px = 40 + sh.rng.int(140), ex = W - 40 - sh.rng.int(140);
    tanks = [
      { x: px, y: ground[px | 0], angle: 60, power: 60, hp: diff.hp, maxHp: diff.hp, color: null, name: "You", ai: false },
      { x: ex, y: ground[ex | 0], angle: 120, power: 60, hp: diff.hp, maxHp: diff.hp, color: null, name: "AI", ai: true },
    ];
    flatten(px); flatten(ex);
    turn = 0; shell = null; phase = "aim"; phaseT = 0; aim = null; hoverAim = null;
    wind = (sh.rng.next() * 2 - 1) * diff.windMax;
    say(`Ridge ${g.level} · your shot`, 120);
  }
  function flatten(x) { const h = ground[x | 0]; for (let i = -10; i <= 10; i++) if (x + i >= 0 && x + i < W) ground[x + i | 0] = Math.max(ground[x + i | 0], h); }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x, y, text, color, ttl: 60 }); }

  // ---------- input ----------
  function onInput(action, sh) {
    if (phase !== "aim" || turn !== 0 || g.autopilot) return;
    const t = tanks[0];
    if (action === "left") t.angle = Math.min(175, t.angle + 2);
    if (action === "right") t.angle = Math.max(5, t.angle - 2);
    if (action === "up") t.power = Math.min(100, t.power + 2);
    if (action === "down") t.power = Math.max(10, t.power - 2);
    if (action === "action") fire(0, sh);
    sh.audio.blip();
  }
  function aimFromPoint(px, py) {
    const t = tanks[0];
    const dx = px - t.x, dy = (t.y - 10) - py;
    const angle = Math.max(5, Math.min(175, Math.atan2(dy, dx) * 180 / Math.PI));
    const power = Math.max(10, Math.min(100, Math.hypot(dx, dy) / 3.2));
    return { angle: Math.round(angle), power: Math.round(power) };
  }
  function onHover(px, py) { hoverAim = px < 0 ? null : aimFromPoint(px, py); }
  function onPointer(px, py, sh) {
    if (phase !== "aim" || turn !== 0 || g.autopilot) return;
    const a = aimFromPoint(px, py); tanks[0].angle = a.angle; tanks[0].power = a.power;
    sh.record(1000 + Math.round(px) * 1000 + Math.round(py)); // replay: encoded aim point
    fire(0, sh);
  }

  // ---------- simulation ----------
  function fire(i, sh) {
    const t = tanks[i];
    const rad = t.angle * Math.PI / 180, v = t.power * 0.12;
    shell = { x: t.x + Math.cos(rad) * 16, y: t.y - 10 - Math.sin(rad) * 16, vx: Math.cos(rad) * v, vy: -Math.sin(rad) * v, owner: i, trail: [], big: g.level >= 3 && sh.rng.next() < 0.25 };
    phase = "flight"; sh.audio.tone({ freq: 180, type: "sawtooth", dur: 0.25, slide: -100, vol: 0.2 });
    if (shell.big) say("Heavy shell!", 60);
  }
  function update(sh) {
    if (msgTtl > 0) msgTtl--; if (shake > 0) shake--;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.12; }
    popups = popups.filter(p => (p.ttl -= 1) > 0);
    // tanks fall if the ground under them was blown away
    for (const t of tanks) { const gy = ground[Math.max(0, Math.min(W - 1, t.x | 0))]; if (t.y < gy - 0.5) { t.y = Math.min(gy, t.y + 2); if (t.y === gy) { t.hp -= 8; pop(t.x, t.y - 30, "-8 fall", T?.accent); } } else t.y = gy; }

    if (phase === "aim") {
      if (turn === 1 || g.autopilot) { phaseT++; if (phaseT > 50) { phaseT = 0; aiShot(sh, turn); fire(turn, sh); } }
      return;
    }
    if (phase === "flight") {
      for (let step = 0; step < 3; step++) { // substeps for accuracy
        shell.vx += wind * 0.0025; shell.vy += G;
        shell.x += shell.vx; shell.y += shell.vy;
        if (sh.tick % 2 === 0 && step === 0) shell.trail.push([shell.x, shell.y]);
        if (shell.trail.length > 40) shell.trail.shift();
        if (shell.x < -50 || shell.x > W + 50 || shell.y > H + 50) { endShot(sh, null); return; }
        const gx = shell.x | 0;
        if (gx >= 0 && gx < W && shell.y >= ground[gx]) { explode(shell.x, shell.y, shell.big ? 34 : 22, sh); return; }
        for (const t of tanks) if (Math.hypot(t.x - shell.x, t.y - 8 - shell.y) < 14) { explode(shell.x, shell.y, shell.big ? 34 : 22, sh); return; }
      }
      return;
    }
    if (phase === "between") { if (++phaseT > 70) { phaseT = 0; afterShot(sh); } }
  }
  function explode(x, y, r, sh) {
    // crater
    for (let gx = Math.max(0, x - r | 0); gx <= Math.min(W - 1, x + r | 0); gx++) {
      const d = Math.sqrt(Math.max(0, r * r - (gx - x) * (gx - x)));
      const top = y - d, bottom = y + d;
      if (ground[gx] < bottom) ground[gx] = Math.max(ground[gx], bottom);
      if (ground[gx] > top && ground[gx] < bottom) ground[gx] = bottom;
    }
    for (let i = 0; i < 60; i++) { const a = sh.rng.next() * 6.28, sp = 1 + sh.rng.next() * 4; particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, ttl: 30 + sh.rng.int(40), color: i % 3 ? T?.marquee : T?.accent }); }
    shake = 18; sh.audio.hit();
    // damage
    let hitSomeone = false, closest = Infinity;
    for (const [i, t] of tanks.entries()) {
      const d = Math.hypot(t.x - x, t.y - 8 - y);
      if (i !== shell.owner) closest = Math.min(closest, (t.x - x) * (i === 1 ? 1 : -1));
      if (d < r + 10) {
        const dmg = Math.round(Math.max(0, 1 - d / (r + 10)) * (shell.big ? 70 : 45)) + 5;
        t.hp -= dmg; hitSomeone = true; pop(t.x, t.y - 30, "-" + dmg, T?.accent);
        if (i !== shell.owner) { if (shell.owner === 0) { g.score += dmg * 10; pop(x, y - 20, "+" + dmg * 10, T?.marquee); } }
        else { pop(t.x, t.y - 44, "own goal", T?.textDim); }
      }
    }
    endShot(sh, closest);
  }
  function endShot(sh, miss) {
    if (shell.owner === 1 && miss !== null && !isNaN(miss)) aiMemory.lastMiss = miss; // signed horizontal miss distance
    shell = null; phase = "between"; phaseT = 0;
    // only the 'between' phase checks for a kill, so the explosion can play
    if (tanks[1].hp <= 0) { const bonus = 500 + Math.round(tanks[0].hp * 3); g.score += bonus; say(`Ridge ${g.level} cleared! +${bonus}`, 150); sh.audio.levelUp(); }
    else if (tanks[0].hp <= 0) { say("Your tank is gone", 120); }
  }
  function afterShot(sh) {
    if (tanks[0].hp <= 0) return sh.end();
    if (tanks[1].hp <= 0) { g.level++; newRound(sh); return; }
    turn = 1 - turn; phase = "aim";
    wind = Math.max(-diff.windMax, Math.min(diff.windMax, wind + (sh.rng.next() - 0.5) * 1.2));
    say(turn === 0 ? "Your shot" : "AI is aiming…", 60);
  }

  // AI: simulate shots across a grid of angle/power and pick the closest, then add noise that shrinks
  // with difficulty and level; it also nudges from its last miss.
  function aiShot(sh, i) {
    const me = tanks[i], target = tanks[1 - i];
    let best = null;
    for (let angle = 20; angle <= 160; angle += 5) for (let power = 20; power <= 100; power += 5) {
      const d = simulate(me, angle, power, target);
      if (d !== null && (!best || d < best.d)) best = { angle, power, d };
    }
    if (!best) best = { angle: 60, power: 60 };
    const noise = Math.max(1, diff.aiNoise - g.level * 1.2) * (i === 0 ? 0.3 : 1);
    me.angle = Math.max(5, Math.min(175, best.angle + (sh.rng.next() - 0.5) * noise));
    me.power = Math.max(10, Math.min(100, best.power + (sh.rng.next() - 0.5) * noise));
  }
  function simulate(from, angle, power, target) {
    const rad = angle * Math.PI / 180, v = power * 0.12;
    let x = from.x + Math.cos(rad) * 16, y = from.y - 10 - Math.sin(rad) * 16, vx = Math.cos(rad) * v, vy = -Math.sin(rad) * v;
    for (let n = 0; n < 2000; n++) {
      vx += wind * 0.0025; vy += G; x += vx; y += vy;
      if (x < 0 || x >= W || y > H) return null;
      if (y >= ground[x | 0]) return Math.hypot(target.x - x, target.y - y);
    }
    return null;
  }

  function hud() { const t = tanks[0]; return `${diff.name} · angle ${Math.round(t.angle)}° · power ${Math.round(t.power)} · wind ${wind > 0 ? "→" : "←"} ${Math.abs(wind).toFixed(1)} · HP ${Math.max(0, tanks[0].hp)} vs ${Math.max(0, tanks[1].hp)}`; }

  // ---------- render ----------
  function render(c, sh) {
    T = sh.theme; _tick = sh.tick;
    c.save();
    if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.8, (Math.random() - 0.5) * shake * 0.8);
    // sky
    const sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, T.bg); sky.addColorStop(0.6, T.bgGlow1); sky.addColorStop(1, T.bgGlow2);
    c.fillStyle = sky; c.fillRect(-10, -10, W + 20, H + 20);
    c.fillStyle = T.text; for (const [x, y, s] of stars) { c.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(sh.tick / 40 + s * 7)); c.fillRect(x, y, s > 0.8 ? 2 : 1, s > 0.8 ? 2 : 1); } c.globalAlpha = 1;
    // distant ridge (parallax)
    c.fillStyle = shade(T.surface, -0.2); c.beginPath(); c.moveTo(0, H); for (let x = 0; x <= W; x += 8) c.lineTo(x, ground[Math.min(W - 1, x)] * 0.75 + 60 + Math.sin(x * 0.03) * 8); c.lineTo(W, H); c.fill();
    // terrain with layered gradient and a lit edge
    const tg = c.createLinearGradient(0, 150, 0, H); tg.addColorStop(0, shade(T.surface3, 0.1)); tg.addColorStop(0.5, T.surface2); tg.addColorStop(1, shade(T.surface, -0.4));
    c.fillStyle = tg; c.beginPath(); c.moveTo(0, H); for (let x = 0; x < W; x++) c.lineTo(x, ground[x]); c.lineTo(W, H); c.closePath(); c.fill();
    c.strokeStyle = shade(T.cyan, 0.2); c.lineWidth = 2; c.globalAlpha = 0.7; c.beginPath(); for (let x = 0; x < W; x++) c.lineTo(x, ground[x]); c.stroke(); c.globalAlpha = 1;
    // wind indicator
    c.fillStyle = T.textDim; c.font = "12px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("wind", W / 2, 16);
    c.strokeStyle = T.cyan; c.lineWidth = 3; c.beginPath(); c.moveTo(W / 2 - wind * 18, 30); c.lineTo(W / 2 + wind * 18, 30); c.stroke();
    c.beginPath(); const tip = W / 2 + wind * 18, dir = Math.sign(wind) || 1; c.moveTo(tip, 30); c.lineTo(tip - dir * 6, 25); c.lineTo(tip - dir * 6, 35); c.closePath(); c.fillStyle = T.cyan; c.fill();
    // tanks
    for (const [i, t] of tanks.entries()) drawTank(c, t, i === 0 ? T.cyan : T.accent, i === turn && phase === "aim");
    // aim preview for the player
    if (turn === 0 && phase === "aim" && !g.autopilot) {
      const t = tanks[0], a = hoverAim || { angle: t.angle, power: t.power };
      c.setLineDash([3, 6]); c.strokeStyle = hoverAim ? T.marquee : T.textDim; c.lineWidth = 1.5; c.beginPath();
      const rad = a.angle * Math.PI / 180, v = a.power * 0.12; let x = t.x + Math.cos(rad) * 16, y = t.y - 10 - Math.sin(rad) * 16, vx = Math.cos(rad) * v, vy = -Math.sin(rad) * v;
      c.moveTo(x, y);
      for (let n = 0; n < 45; n++) { vx += wind * 0.0025; vy += G; x += vx; y += vy; if (y >= ground[Math.max(0, Math.min(W - 1, x | 0))]) break; c.lineTo(x, y); }
      c.stroke(); c.setLineDash([]);
    }
    // shell + trail
    if (shell) {
      c.strokeStyle = T.marquee; c.lineWidth = 2; c.globalAlpha = 0.6; c.beginPath(); for (const [x, y] of shell.trail) c.lineTo(x, y); c.stroke(); c.globalAlpha = 1;
      c.shadowColor = T.marquee; c.shadowBlur = 14; c.fillStyle = T.marquee; c.beginPath(); c.arc(shell.x, shell.y, shell.big ? 5 : 3.5, 0, 7); c.fill(); c.shadowBlur = 0;
    }
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 20); c.fillStyle = p.color || T.marquee; c.beginPath(); c.arc(p.x, p.y, 2, 0, 7); c.fill(); }
    c.globalAlpha = 1;
    for (const p of popups) { const k = 1 - p.ttl / 60; c.globalAlpha = Math.min(1, p.ttl / 15); c.fillStyle = p.color || T.text; c.font = "800 15px system-ui,sans-serif"; c.textAlign = "center"; c.shadowColor = "#000"; c.shadowBlur = 6; c.fillText(p.text, p.x, p.y - k * 26); c.shadowBlur = 0; }
    c.globalAlpha = 1;
    if (msgTtl > 0 && msg) {
      c.font = "700 16px system-ui,sans-serif"; c.textAlign = "center"; const tw = c.measureText(msg).width + 24;
      c.fillStyle = T.bg; c.globalAlpha = 0.85; rr(c, W / 2 - tw / 2, H - 36, tw, 26, 13); c.fill(); c.globalAlpha = 1;
      c.fillStyle = T.marquee; c.fillText(msg, W / 2, H - 23);
    }
    c.restore();
  }
  function drawTank(c, t, color, active) {
    const x = t.x, y = t.y;
    // hp bar
    c.fillStyle = "#00000088"; rr(c, x - 18, y - 36, 36, 5, 2); c.fill();
    c.fillStyle = t.hp > t.maxHp * 0.3 ? color : T.accent; rr(c, x - 18, y - 36, 36 * Math.max(0, t.hp) / t.maxHp, 5, 2); c.fill();
    // body: domed hull with a lit top
    c.fillStyle = "#00000066"; c.beginPath(); c.ellipse(x + 2, y + 2, 18, 7, 0, 0, 7); c.fill();
    const bg = c.createLinearGradient(x, y - 16, x, y); bg.addColorStop(0, shade(color, 0.35)); bg.addColorStop(1, shade(color, -0.4));
    c.fillStyle = bg; c.beginPath(); c.moveTo(x - 16, y); c.lineTo(x - 12, y - 8); c.lineTo(x + 12, y - 8); c.lineTo(x + 16, y); c.closePath(); c.fill();
    c.beginPath(); c.arc(x, y - 8, 7, Math.PI, 0); c.fill();
    // turret
    const rad = t.angle * Math.PI / 180;
    c.strokeStyle = shade(color, -0.2); c.lineWidth = 4; c.lineCap = "round"; c.beginPath(); c.moveTo(x, y - 10); c.lineTo(x + Math.cos(rad) * 16, y - 10 - Math.sin(rad) * 16); c.stroke();
    // treads
    c.fillStyle = shade(color, -0.6); rr(c, x - 17, y - 3, 34, 5, 2); c.fill();
    if (active) { c.globalAlpha = 0.4 + 0.3 * Math.sin(tickNow() / 6); c.strokeStyle = color; c.lineWidth = 2; c.beginPath(); c.arc(x, y - 6, 24, 0, 7); c.stroke(); c.globalAlpha = 1; }
    c.fillStyle = T.textDim; c.font = "11px system-ui,sans-serif"; c.textAlign = "center"; c.fillText(t.name, x, y - 42);
  }
  let _tick = 0; function tickNow() { return _tick; }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
