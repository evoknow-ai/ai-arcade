// Missile Defence — protect six cities from waves of incoming warheads.
// Click (or tap) anywhere in the sky to fire an interceptor from the nearest battery that still has
// ammo; its blast lingers and destroys anything it touches. Later waves add MIRVs that split,
// bombers that drop warheads, and smart bombs that steer around blasts. Ammo and surviving cities pay
// out between waves. Credits can buy an automated flak turret (B).
const W = 640, H = 420, GROUND = H - 40;
const DIFFICULTY = {
  beginner:     { name: "Beginner",     speed: 0.55, count: 8,  ammo: 12, grow: 1.4 },
  intermediate: { name: "Intermediate", speed: 0.8,  count: 12, ammo: 10, grow: 1.2 },
  advanced:     { name: "Advanced",     speed: 1.1,  count: 16, ammo: 9,  grow: 1.0 },
};

export default function createMissile({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0;
  const g = { id: "missile", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, onPointer, onHover, hud };
  let cities, batteries, warheads, shots, blasts, bombers, particles, popups, wave, toSpawn, spawnTimer, phase, phaseT, hover, msg, msgTtl, shake, stars, turret, skyline;

  function init(sh) {
    g.score = 0; g.level = 1; wave = 0; particles = []; popups = []; shake = 0; turret = null;
    stars = Array.from({ length: 90 }, () => [sh.rng.next() * W, sh.rng.next() * GROUND * 0.8, sh.rng.next()]);
    cities = [90, 160, 230, 410, 480, 550].map(x => ({ x, alive: true, h: 14 + sh.rng.int(10) }));
    skyline = cities.map(c => Array.from({ length: 5 }, (_, i) => ({ dx: -18 + i * 8, w: 7, h: 10 + sh.rng.int(c.h) })));
    batteries = [30, 320, 610].map(x => ({ x, ammo: diff.ammo }));
    startWave(sh);
  }
  function startWave(sh) {
    wave++; g.level = wave;
    warheads = []; shots = []; blasts = []; bombers = [];
    toSpawn = diff.count + wave * 2; spawnTimer = 30;
    for (const b of batteries) b.ammo = diff.ammo + Math.floor(wave / 3);
    phase = "wave"; phaseT = 0;
    say(`Wave ${wave}`, 120);
  }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x, y, text, color, ttl: 60 }); }

  // ---------- input ----------
  function onHover(px, py) { hover = px < 0 ? null : { x: px, y: py }; }
  function onInput(action, sh) { if (action === "shop") buyTurret(sh); }
  function buyTurret(sh) {
    if (turret) { say("Turret already deployed", 50); return; }
    if (!sh.wallet?.spend(150)) { say("Flak turret costs 150 credits", 60); sh.audio.hit(); return; }
    turret = { x: 320, cooldown: 0, ammo: 20 }; say("Flak turret online", 80); sh.audio.levelUp();
  }
  function onPointer(px, py, sh) {
    if (py < 36 && px > W - 120) { buyTurret(sh); return; }
    if (phase !== "wave" || py >= GROUND - 10) return;
    fireAt(px, py, sh, true);
  }
  function fireAt(px, py, sh, record) {
    // nearest battery with ammo
    let best = null;
    for (const b of batteries) { if (b.ammo <= 0) continue; const d = Math.abs(b.x - px); if (!best || d < best.d) best = { b, d }; }
    if (!best) { sh.audio.hit(); say("Out of interceptors", 40); return; }
    if (record) sh.record(1000 + Math.round(px) * 1000 + Math.round(py));
    best.b.ammo--;
    const dx = px - best.b.x, dy = py - (GROUND - 6), len = Math.hypot(dx, dy) || 1, sp = 6;
    shots.push({ x: best.b.x, y: GROUND - 6, vx: dx / len * sp, vy: dy / len * sp, tx: px, ty: py, trail: [] });
    sh.audio.tone({ freq: 500, type: "triangle", dur: 0.12, slide: 300, vol: 0.12 });
  }

  // ---------- simulation ----------
  function update(sh) {
    tick = sh.tick;
    if (msgTtl > 0) msgTtl--; if (shake > 0) shake--;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.05; }
    popups = popups.filter(p => (p.ttl -= 1) > 0);
    if (phase === "between") { if (++phaseT > 140) startWave(sh); return; }
    if (phase === "lost") { if (++phaseT > 120) sh.end(); return; }

    // spawn
    if (toSpawn > 0 && --spawnTimer <= 0) {
      spawnTimer = Math.max(18, 60 - wave * 4);
      const n = 1 + (sh.rng.next() < 0.3 ? 1 : 0);
      for (let i = 0; i < n && toSpawn > 0; i++) spawnWarhead(sh);
      if (wave >= 3 && sh.rng.next() < 0.12 && !bombers.length) bombers.push({ x: sh.rng.next() < 0.5 ? -30 : W + 30, y: 60 + sh.rng.int(60), vx: 0, drop: 90 + sh.rng.int(60) });
    }
    for (const b of bombers) { if (!b.vx) b.vx = b.x < 0 ? 1 : -1; b.x += b.vx; if (--b.drop <= 0) { b.drop = 120; warheads.push(mkWarhead(sh, b.x, b.y, targetX(sh))); } }
    bombers = bombers.filter(b => !b.dead && b.x > -60 && b.x < W + 60);
    // warheads
    for (const w of warheads) {
      if (w.smart) { for (const bl of blasts) { const d = Math.hypot(bl.x - w.x, bl.y - w.y); if (d < bl.r + 30 && w.y < bl.y) w.vx += Math.sign(w.x - bl.x) * 0.08; } }
      w.x += w.vx; w.y += w.vy;
      if (tick % 3 === 0) w.trail.push([w.x, w.y]); if (w.trail.length > 60) w.trail.shift();
      if (w.mirv && w.y > w.splitY) { w.mirv = false; for (let i = -1; i <= 1; i += 2) warheads.push(mkWarhead(sh, w.x, w.y, targetX(sh), 0.9)); }
      if (w.y >= GROUND) { w.dead = true; groundHit(w, sh); }
    }
    // interceptors
    for (const s of shots) {
      s.x += s.vx; s.y += s.vy; if (tick % 2 === 0) s.trail.push([s.x, s.y]); if (s.trail.length > 30) s.trail.shift();
      if (Math.hypot(s.x - s.tx, s.y - s.ty) < 6) { s.dead = true; blasts.push({ x: s.tx, y: s.ty, r: 2, max: 32 * diff.grow, t: 0, kills: 0 }); sh.audio.tone({ freq: 120, type: "sawtooth", dur: 0.35, slide: -80, vol: 0.14 }); }
    }
    // blasts: grow then fade, kill warheads/bombers inside
    for (const b of blasts) {
      b.t++; b.r = b.t < 30 ? b.max * (b.t / 30) : b.max * Math.max(0, 1 - (b.t - 30) / 40);
      if (b.t > 70) b.dead = true;
      for (const w of warheads) if (!w.dead && Math.hypot(w.x - b.x, w.y - b.y) < b.r) { w.dead = true; b.kills++; const pts = 25 * (1 + Math.min(4, b.kills - 1)) * (w.smart ? 2 : 1); g.score += pts; pop(w.x, w.y, "+" + pts, T?.marquee); burst(w.x, w.y, 10, T?.marquee, sh); }
      for (const bo of bombers) if (Math.hypot(bo.x - b.x, bo.y - b.y) < b.r + 8) { bo.dead = true; g.score += 150; pop(bo.x, bo.y, "+150", T?.cyan); burst(bo.x, bo.y, 24, T?.accent, sh); }
    }
    // auto turret
    if (turret) { if (turret.cooldown > 0) turret.cooldown--; else if (turret.ammo > 0) { const w = warheads.find(w => !w.dead && w.y > 90 && w.y < GROUND - 80); if (w) { turret.cooldown = 45; turret.ammo--; blasts.push({ x: w.x + w.vx * 12, y: w.y + w.vy * 12, r: 2, max: 18, t: 0, kills: 0 }); sh.audio.tone({ freq: 800, type: "square", dur: 0.06, vol: 0.08 }); } } }
    // autopilot: intercept whatever is lowest
    if (g.autopilot && tick % 24 === 0) { const w = warheads.filter(w => !w.dead && w.y > 60).sort((a, b) => b.y - a.y)[0]; if (w) fireAt(w.x + w.vx * 14, w.y + w.vy * 14, sh, false); }

    warheads = warheads.filter(w => !w.dead); shots = shots.filter(s => !s.dead); blasts = blasts.filter(b => !b.dead);
    if (!cities.some(c => c.alive)) { phase = "lost"; phaseT = 0; say("All cities lost", 120); sh.audio.gameOver(); return; }
    if (toSpawn <= 0 && !warheads.length && !bombers.length && !shots.length && !blasts.length) endWave(sh);
  }
  function targetX(sh) { const alive = [...cities.filter(c => c.alive).map(c => c.x), ...batteries.map(b => b.x)]; return alive[sh.rng.int(alive.length)] + (sh.rng.next() - 0.5) * 20; }
  function mkWarhead(sh, x, y, tx, speedMul = 1) {
    const sp = (0.9 + wave * 0.08) * diff.speed * speedMul;
    const dx = tx - x, dy = GROUND - y, len = Math.hypot(dx, dy) || 1;
    return { x, y, vx: dx / len * sp, vy: dy / len * sp, trail: [], mirv: wave >= 2 && sh.rng.next() < 0.15 + wave * 0.02, splitY: 120 + sh.rng.int(120), smart: wave >= 4 && sh.rng.next() < 0.12 };
  }
  function spawnWarhead(sh) { toSpawn--; warheads.push(mkWarhead(sh, sh.rng.next() * W, -10, targetX(sh))); }
  function groundHit(w, sh) {
    burst(w.x, GROUND, 30, T?.accent, sh); shake = 14; sh.audio.hit();
    for (const c of cities) if (c.alive && Math.abs(c.x - w.x) < 26) { c.alive = false; say("City destroyed", 60); burst(c.x, GROUND, 50, T?.accent, sh); shake = 22; }
    for (const b of batteries) if (Math.abs(b.x - w.x) < 22 && b.ammo > 0) { b.ammo = 0; pop(b.x, GROUND - 30, "battery hit", T?.accent); }
  }
  function endWave(sh) {
    const alive = cities.filter(c => c.alive).length, ammo = batteries.reduce((a, b) => a + b.ammo, 0);
    const bonus = alive * 100 + ammo * 5;
    g.score += bonus; sh.wallet?.earn(alive * 8 + wave * 5);
    pop(W / 2, H / 2 - 20, `Wave ${wave} cleared · +${bonus}`, T?.marquee);
    pop(W / 2, H / 2 + 10, `${alive} cities × 100 · ${ammo} ammo × 5 · +${alive * 8 + wave * 5} cr`, T?.cyan);
    if (wave % 3 === 0) { const dead = cities.find(c => !c.alive); if (dead) { dead.alive = true; pop(dead.x, GROUND - 30, "rebuilt", T?.cyan); } }
    phase = "between"; phaseT = 0; sh.audio.levelUp();
  }
  function burst(x, y, n, color, sh) { for (let i = 0; i < n; i++) { const a = sh.rng.next() * 6.28, sp = 0.5 + sh.rng.next() * 3; particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.5, ttl: 25 + sh.rng.int(35), color }); } }

  function hud() { return `${diff.name} · wave ${wave} · ${cities.filter(c => c.alive).length} cities · ammo ${batteries.map(b => b.ammo).join("/")}${turret ? ` · turret ${turret.ammo}` : ""}`; }

  // ---------- render ----------
  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    c.save();
    if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.7, (Math.random() - 0.5) * shake * 0.7);
    const sky = c.createLinearGradient(0, 0, 0, GROUND); sky.addColorStop(0, T.bg); sky.addColorStop(0.7, T.bgGlow1); sky.addColorStop(1, T.bgGlow2);
    c.fillStyle = sky; c.fillRect(-10, -10, W + 20, H + 20);
    c.fillStyle = "#fff"; for (const [x, y, s] of stars) { c.globalAlpha = 0.25 + 0.6 * Math.abs(Math.sin(tick / 50 + s * 9)); c.fillRect(x, y, s > 0.85 ? 2 : 1, s > 0.85 ? 2 : 1); } c.globalAlpha = 1;
    // ground
    const gg = c.createLinearGradient(0, GROUND, 0, H); gg.addColorStop(0, shade(T.surface3, 0.1)); gg.addColorStop(1, shade(T.surface, -0.4));
    c.fillStyle = gg; c.fillRect(-10, GROUND, W + 20, H - GROUND + 10);
    c.fillStyle = shade(T.cyan, 0.1); c.globalAlpha = 0.6; c.fillRect(0, GROUND, W, 2); c.globalAlpha = 1;
    // cities
    cities.forEach((ci, i) => { if (ci.alive) drawCity(c, ci, skyline[i]); else { c.fillStyle = "#1a1012"; for (const b of skyline[i]) c.fillRect(ci.x + b.dx, GROUND - 4, b.w, 4); c.fillStyle = T.accent; c.globalAlpha = 0.3 + 0.2 * Math.sin(tick / 7 + i); c.beginPath(); c.arc(ci.x, GROUND - 2, 6, Math.PI, 0); c.fill(); c.globalAlpha = 1; } });
    for (const b of batteries) drawBattery(c, b);
    if (turret) { c.fillStyle = T.marquee; rr(c, turret.x - 10, GROUND - 26, 20, 10, 3); c.fill(); c.strokeStyle = T.marquee; c.lineWidth = 3; c.beginPath(); c.moveTo(turret.x, GROUND - 22); c.lineTo(turret.x + Math.cos(tick / 20) * 10, GROUND - 32 - Math.abs(Math.sin(tick / 20)) * 6); c.stroke(); }
    // bombers
    for (const b of bombers) { c.fillStyle = T.text; c.beginPath(); c.moveTo(b.x - 14, b.y); c.lineTo(b.x + 14, b.y); c.lineTo(b.x + 4, b.y + 5); c.lineTo(b.x - 6, b.y + 5); c.closePath(); c.fill(); c.fillRect(b.x - 2, b.y - 5, 4, 5); c.fillStyle = T.accent; c.globalAlpha = 0.5 + 0.5 * Math.sin(tick / 4); c.fillRect(b.x + 12, b.y - 1, 2, 2); c.globalAlpha = 1; }
    // warheads
    for (const w of warheads) {
      c.strokeStyle = w.smart ? T.marquee : T.accent; c.lineWidth = 1.5; c.globalAlpha = 0.55; c.beginPath(); for (const [x, y] of w.trail) c.lineTo(x, y); c.lineTo(w.x, w.y); c.stroke(); c.globalAlpha = 1;
      c.shadowColor = w.smart ? T.marquee : T.accent; c.shadowBlur = 12; c.fillStyle = "#fff"; c.beginPath(); c.arc(w.x, w.y, w.mirv ? 3.5 : 2.5, 0, 7); c.fill(); c.shadowBlur = 0;
    }
    // interceptors
    for (const s of shots) {
      c.strokeStyle = T.cyan; c.lineWidth = 1.5; c.globalAlpha = 0.6; c.beginPath(); for (const [x, y] of s.trail) c.lineTo(x, y); c.lineTo(s.x, s.y); c.stroke(); c.globalAlpha = 1;
      c.shadowColor = T.cyan; c.shadowBlur = 10; c.fillStyle = T.cyan; c.beginPath(); c.arc(s.x, s.y, 2.5, 0, 7); c.fill(); c.shadowBlur = 0;
      c.strokeStyle = T.cyan; c.globalAlpha = 0.5; c.beginPath(); c.moveTo(s.tx - 5, s.ty); c.lineTo(s.tx + 5, s.ty); c.moveTo(s.tx, s.ty - 5); c.lineTo(s.tx, s.ty + 5); c.stroke(); c.globalAlpha = 1;
    }
    // blasts: layered glowing rings
    for (const b of blasts) {
      const k = Math.min(1, b.t / 30);
      const grd = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r + 1); grd.addColorStop(0, "#ffffff"); grd.addColorStop(0.35, T.marquee); grd.addColorStop(0.8, T.accent); grd.addColorStop(1, "rgba(0,0,0,0)");
      c.globalAlpha = 0.85; c.fillStyle = grd; c.beginPath(); c.arc(b.x, b.y, b.r, 0, 7); c.fill();
      c.globalAlpha = 0.5 * (1 - k); c.strokeStyle = "#fff"; c.lineWidth = 2; c.beginPath(); c.arc(b.x, b.y, b.r + 4 + k * 10, 0, 7); c.stroke(); c.globalAlpha = 1;
    }
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 20); c.fillStyle = p.color || T.marquee; c.beginPath(); c.arc(p.x, p.y, 1.8, 0, 7); c.fill(); }
    c.globalAlpha = 1;
    // crosshair
    if (hover && phase === "wave" && !g.autopilot && hover.y < GROUND - 10) { c.strokeStyle = T.text; c.lineWidth = 1; c.globalAlpha = 0.6; c.beginPath(); c.arc(hover.x, hover.y, 9, 0, 7); c.moveTo(hover.x - 14, hover.y); c.lineTo(hover.x - 4, hover.y); c.moveTo(hover.x + 4, hover.y); c.lineTo(hover.x + 14, hover.y); c.moveTo(hover.x, hover.y - 14); c.lineTo(hover.x, hover.y - 4); c.moveTo(hover.x, hover.y + 4); c.lineTo(hover.x, hover.y + 14); c.stroke(); c.globalAlpha = 1; }
    // top bar
    c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(0, 0, W, 36);
    c.fillStyle = T.text; c.font = "700 14px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(`Wave ${wave}`, 14, 18);
    c.fillStyle = T.textDim; c.font = "12px system-ui,sans-serif"; c.fillText(`${toSpawn + warheads.length} incoming`, 90, 18);
    c.fillStyle = turret ? T.surface3 : T.marquee; rr(c, W - 112, 6, 104, 24, 7); c.fill(); c.fillStyle = turret ? T.textDim : "#000"; c.font = "700 11px system-ui,sans-serif"; c.textAlign = "center"; c.fillText(turret ? `Turret · ${turret.ammo} rounds` : "Flak turret · 150 cr (B)", W - 60, 18);
    for (const p of popups) { const k = 1 - p.ttl / 60; c.globalAlpha = Math.min(1, p.ttl / 15); c.fillStyle = p.color || T.text; c.font = "800 15px system-ui,sans-serif"; c.textAlign = "center"; c.shadowColor = "#000"; c.shadowBlur = 6; c.fillText(p.text, p.x, p.y - k * 22); c.shadowBlur = 0; }
    c.globalAlpha = 1;
    if (msgTtl > 0 && msg) { c.font = "800 26px 'Chakra Petch',system-ui,sans-serif"; c.textAlign = "center"; c.fillStyle = T.marquee; c.shadowColor = T.marquee; c.shadowBlur = 20; c.globalAlpha = Math.min(1, msgTtl / 20); c.fillText(msg, W / 2, H / 2 - 60); c.shadowBlur = 0; c.globalAlpha = 1; }
    c.restore();
  }
  function drawCity(c, ci, blocks) {
    for (const [i, b] of blocks.entries()) {
      const x = ci.x + b.dx, h = b.h, y = GROUND - h;
      const grd = c.createLinearGradient(x, y, x + b.w, y); grd.addColorStop(0, shade(T.surface3, 0.3)); grd.addColorStop(1, shade(T.surface2, -0.3));
      c.fillStyle = grd; c.fillRect(x, y, b.w, h);
      c.fillStyle = T.marquee; for (let wy = y + 3; wy < GROUND - 3; wy += 4) for (let wx = x + 1; wx < x + b.w - 1; wx += 3) { if (((wx * 7 + wy * 3 + i) % 5) < 3) { c.globalAlpha = 0.5 + 0.4 * Math.abs(Math.sin(tick / 60 + wx + wy)); c.fillRect(wx, wy, 1.5, 2); } }
      c.globalAlpha = 1;
    }
  }
  function drawBattery(c, b) {
    const x = b.x, y = GROUND;
    c.fillStyle = "#00000055"; c.beginPath(); c.ellipse(x + 2, y + 1, 22, 6, 0, 0, 7); c.fill();
    const grd = c.createLinearGradient(x, y - 16, x, y); grd.addColorStop(0, shade(T.cyan, 0.2)); grd.addColorStop(1, shade(T.cyan, -0.5));
    c.fillStyle = grd; c.beginPath(); c.moveTo(x - 22, y); c.lineTo(x - 14, y - 14); c.lineTo(x + 14, y - 14); c.lineTo(x + 22, y); c.closePath(); c.fill();
    c.fillStyle = "#fff"; c.globalAlpha = 0.9; for (let i = 0; i < Math.min(b.ammo, 10); i++) c.fillRect(x - 11 + (i % 5) * 5, y - 11 + Math.floor(i / 5) * 5, 3, 3); c.globalAlpha = 1;
    if (b.ammo <= 0) { c.fillStyle = T.accent; c.font = "700 9px system-ui,sans-serif"; c.textAlign = "center"; c.fillText("EMPTY", x, y - 20); }
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
