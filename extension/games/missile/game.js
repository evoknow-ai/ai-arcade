// Missile Defence — protect six cities from waves of incoming warheads.
// Click / tap the sky to fire an interceptor from the nearest battery with ammo; the blast lingers and
// destroys anything it touches. MIRVs burst mid-air into several heads, smart warheads steer around
// your blasts, bombers drop more. Every warhead you stop earns credits (shared across games).
// B opens the shop: extra batteries you place on the ground, a mobile battery on a truck, an automated
// Patriot system that fires salvos, a flak turret, area shields over your cities, and a reload.
// The sky runs on its own clock: dawn → day → dusk → night → dawn.
const W = 640, H = 420, GROUND = H - 40, BAR = 36;
const DIFFICULTY = {
  beginner:     { name: "Beginner",     speed: 0.55, count: 8,  ammo: 12, grow: 1.4, smartFrom: 4, mirvFrom: 3 },
  intermediate: { name: "Intermediate", speed: 0.8,  count: 12, ammo: 10, grow: 1.2, smartFrom: 3, mirvFrom: 2 },
  advanced:     { name: "Advanced",     speed: 1.1,  count: 16, ammo: 9,  grow: 1.0, smartFrom: 2, mirvFrom: 2 },
};
const SHOP = [
  { id: "battery", name: "Battery",        cost: 120, place: true, desc: "Place a new battery on the ground (10 interceptors)." },
  { id: "shield",  name: "Area shield",    cost: 100, place: true, desc: "A dome over a 150px stretch that soaks up 3 hits." },
  { id: "truck",   name: "Missile truck",  cost: 200, place: false, desc: "Patrols the ground and fires anti-missile rounds on its own (16)." },
  { id: "patriot", name: "Patriot system", cost: 300, place: true, desc: "Automated launcher: salvos of 3 at the nearest threats (24 rounds)." },
  { id: "turret",  name: "Flak turret",    cost: 150, place: true, desc: "Short-range automatic flak for low warheads (20 rounds)." },
  { id: "reload",  name: "Reload all",     cost: 80,  place: false, desc: "Refill every battery you own." },
];
// sky keyframes across one day: [top, mid, horizon]
const SKY = [
  { t: 0.00, top: "#05070F", mid: "#0E1A33", bot: "#1C2B4A", stars: 1 },     // midnight
  { t: 0.20, top: "#1B1E3C", mid: "#6A3A66", bot: "#F2A65A", stars: 0.3 },   // dawn
  { t: 0.35, top: "#4F9BE8", mid: "#9ED1FF", bot: "#E6F4FF", stars: 0 },     // morning
  { t: 0.50, top: "#2E7FE0", mid: "#8CC4FF", bot: "#DDEEFF", stars: 0 },     // noon
  { t: 0.70, top: "#2A1B45", mid: "#B4436C", bot: "#F9A03F", stars: 0.2 },   // dusk
  { t: 0.85, top: "#070A18", mid: "#111C38", bot: "#1F2D4E", stars: 0.9 },   // night
  { t: 1.00, top: "#05070F", mid: "#0E1A33", bot: "#1C2B4A", stars: 1 },
];
const DAY_TICKS = 60 * 150; // one full day every 2.5 minutes

export default function createMissile({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0;
  const g = { id: "missile", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, onPointer, onHover, hud };
  let cities, batteries, warheads, shots, blasts, bombers, particles, popups, wave, toSpawn, spawnTimer, phase, phaseT, hover, msg, msgTtl, shake, stars, skyline, shop, placing, shields, trucks, patriots, turrets, dayT, killed;

  function init(sh) {
    g.score = 0; g.level = 1; wave = 0; particles = []; popups = []; shake = 0; killed = 0;
    stars = Array.from({ length: 90 }, () => [sh.rng.next() * W, sh.rng.next() * GROUND * 0.8, sh.rng.next()]);
    cities = [90, 160, 230, 410, 480, 550].map(x => ({ x, alive: true, h: 14 + sh.rng.int(10) }));
    skyline = cities.map(c => Array.from({ length: 5 }, (_, i) => ({ dx: -18 + i * 8, w: 7, h: 10 + sh.rng.int(c.h) })));
    batteries = [30, 320, 610].map(x => ({ x, ammo: diff.ammo, max: diff.ammo }));
    shields = []; trucks = []; patriots = []; turrets = []; shop = null; placing = null;
    dayT = 0.78 + sh.rng.next() * 0.1; // start at night, dawn comes soon
    startWave(sh);
  }
  function startWave(sh) {
    wave++; g.level = wave;
    warheads = []; shots = []; blasts = []; bombers = [];
    toSpawn = diff.count + wave * 2; spawnTimer = 30;
    for (const b of batteries) { b.max = diff.ammo + Math.floor(wave / 3); b.ammo = b.max; }
    phase = "wave"; phaseT = 0;
    say(`Wave ${wave}`, 120);
  }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x, y, text, color, ttl: 60 }); }

  // ---------- input ----------
  function onHover(px, py) { hover = px < 0 ? null : { x: px, y: py }; }
  function onInput(action, sh) {
    if (action === "shop") { if (placing) placing = null; else shop = shop ? null : { items: SHOP }; }
    if (action === "pause" && (shop || placing)) { shop = null; placing = null; }
  }
  function onPointer(px, py, sh) {
    if (shop) { shopClick(px, py, sh); return; }
    if (py < BAR) { if (px > W - 90) shop = { items: SHOP }; return; }
    if (placing) { if (py > GROUND - 120) { deploy(placing, px, sh); sh.record(3000 + Math.round(px)); placing = null; } return; }
    if (phase !== "wave" || py >= GROUND - 10) return;
    fireAt(px, py, sh, true);
  }
  function shopBox() { const w = 520, h = 44 + SHOP.length * 32 + 40; return { x: (W - w) / 2, y: (H - h) / 2, w, h }; }
  function shopClick(px, py, sh) {
    const b = shopBox();
    if (px < b.x || px > b.x + b.w || py < b.y || py > b.y + b.h || py > b.y + b.h - 34) { shop = null; return; }
    const item = SHOP[Math.floor((py - b.y - 44) / 32)]; if (!item) return;
    if (!sh.wallet?.spend(item.cost)) { say("Not enough credits", 50); sh.audio.hit(); return; }
    sh.record(2000 + SHOP.indexOf(item));
    sh.audio.eat(); shop = null;
    if (item.place) { placing = item.id; say(`Click the ground to place the ${item.name.toLowerCase()}`, 200); return; }
    if (item.id === "truck") { trucks.push({ x: 320, dir: 1, ammo: 16, cooldown: 60 }); say("Missile truck rolling", 80); }
    if (item.id === "reload") { for (const b of batteries) b.ammo = b.max; say("Batteries reloaded", 60); }
  }
  function deploy(id, x, sh) {
    x = Math.max(20, Math.min(W - 20, x));
    if (id === "battery") { batteries.push({ x, ammo: 10, max: 10, bought: true }); say("Battery deployed", 60); }
    if (id === "shield") { shields.push({ x, r: 75, hp: 3 }); say("Shield up", 60); }
    if (id === "patriot") { patriots.push({ x, ammo: 24, cooldown: 40 }); say("Patriot system online", 80); }
    if (id === "turret") { turrets.push({ x, ammo: 20, cooldown: 0 }); say("Flak turret online", 60); }
    sh.audio.levelUp();
  }
  function fireAt(px, py, sh, record, from) {
    let best = null;
    if (from) best = { b: from };
    else for (const b of batteries) { if (b.ammo <= 0) continue; const d = Math.abs(b.x - px); if (!best || d < best.d) best = { b, d }; }
    if (!best) { sh.audio.hit(); say("Out of interceptors — B to buy or reload", 60); return false; }
    if (record) sh.record(1000 + Math.round(px) * 1000 + Math.round(py));
    best.b.ammo--;
    const sx = best.b.x, sy = GROUND - 6, dx = px - sx, dy = py - sy, len = Math.hypot(dx, dy) || 1, sp = 6.5;
    shots.push({ x: sx, y: sy, vx: dx / len * sp, vy: dy / len * sp, tx: px, ty: py, trail: [], r: from?.small ? 18 : 32 * diff.grow });
    sh.audio.tone({ freq: 500, type: "triangle", dur: 0.12, slide: 300, vol: 0.1 });
    return true;
  }

  // ---------- simulation ----------
  function update(sh) {
    tick = sh.tick;
    dayT = (dayT + 1 / DAY_TICKS) % 1;
    if (msgTtl > 0) msgTtl--; if (shake > 0) shake--;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.05; }
    popups = popups.filter(p => (p.ttl -= 1) > 0);
    if (shop) return;
    if (phase === "between") { if (++phaseT > 140) startWave(sh); return; }
    if (phase === "lost") { if (++phaseT > 120) sh.end(); return; }

    if (toSpawn > 0 && --spawnTimer <= 0) {
      spawnTimer = Math.max(18, 60 - wave * 4);
      const n = 1 + (sh.rng.next() < 0.3 ? 1 : 0);
      for (let i = 0; i < n && toSpawn > 0; i++) spawnWarhead(sh);
      if (wave >= 3 && sh.rng.next() < 0.12 && !bombers.length) bombers.push({ x: sh.rng.next() < 0.5 ? -30 : W + 30, y: 60 + sh.rng.int(60), vx: 0, drop: 90 + sh.rng.int(60) });
    }
    for (const b of bombers) { if (!b.vx) b.vx = b.x < 0 ? 1 : -1; b.x += b.vx; if (--b.drop <= 0) { b.drop = 120; warheads.push(mkWarhead(sh, b.x, b.y, targetX(sh))); } }
    bombers = bombers.filter(b => !b.dead && b.x > -60 && b.x < W + 60);
    for (const w of warheads) {
      if (w.smart) { // evade: veer away from any blast ahead, then settle back toward the target
        let steer = 0;
        for (const bl of blasts) { const d = Math.hypot(bl.x - w.x, bl.y - w.y); if (d < bl.r + 45 && bl.y > w.y - 10) steer += Math.sign(w.x - bl.x || 1) * (1 - d / (bl.r + 45)) * 0.35; }
        for (const s of shots) { const d = Math.hypot(s.tx - w.x, s.ty - w.y); if (d < 70 && s.ty > w.y - 20) steer += Math.sign(w.x - s.tx || 1) * 0.12; }
        w.vx += steer; const toT = (w.tx - w.x) * 0.0008; w.vx += toT; w.vx = Math.max(-2.2, Math.min(2.2, w.vx));
      }
      w.x += w.vx; w.y += w.vy;
      if (tick % 3 === 0) w.trail.push([w.x, w.y]); if (w.trail.length > 60) w.trail.shift();
      if (w.mirv && w.y > w.splitY) { // mid-air burst into 3 heads
        w.mirv = false; burst(w.x, w.y, 16, T?.marquee, sh); sh.audio.tone({ freq: 240, type: "square", dur: 0.15, slide: -100, vol: 0.1 });
        for (let i = -1; i <= 1; i++) { const h = mkWarhead(sh, w.x, w.y, targetX(sh), 0.95); h.vx += i * 0.4; warheads.push(h); }
      }
      if (w.y >= GROUND) { w.dead = true; groundHit(w, sh); }
    }
    for (const s of shots) {
      s.x += s.vx; s.y += s.vy; if (tick % 2 === 0) s.trail.push([s.x, s.y]); if (s.trail.length > 30) s.trail.shift();
      if (Math.hypot(s.x - s.tx, s.y - s.ty) < 7) { s.dead = true; blasts.push({ x: s.tx, y: s.ty, r: 2, max: s.r, t: 0, kills: 0 }); sh.audio.tone({ freq: 120, type: "sawtooth", dur: 0.35, slide: -80, vol: 0.12 }); }
    }
    for (const b of blasts) {
      b.t++; b.r = b.t < 30 ? b.max * (b.t / 30) : b.max * Math.max(0, 1 - (b.t - 30) / 40);
      if (b.t > 70) b.dead = true;
      for (const w of warheads) if (!w.dead && Math.hypot(w.x - b.x, w.y - b.y) < b.r) { w.dead = true; b.kills++; killed++; const pts = 25 * (1 + Math.min(4, b.kills - 1)) * (w.smart ? 2 : 1), cr = w.smart ? 6 : 3; g.score += pts; sh.wallet?.earn(cr); pop(w.x, w.y, `+${pts} · ${cr} cr`, T?.marquee); burst(w.x, w.y, 10, T?.marquee, sh); }
      for (const bo of bombers) if (Math.hypot(bo.x - b.x, bo.y - b.y) < b.r + 8) { bo.dead = true; g.score += 150; sh.wallet?.earn(15); pop(bo.x, bo.y, "+150 · 15 cr", T?.cyan); burst(bo.x, bo.y, 24, T?.accent, sh); }
    }
    // automated defences
    for (const t of turrets) { if (t.cooldown > 0) t.cooldown--; else if (t.ammo > 0) { const w = warheads.find(w => !w.dead && w.y > 110 && w.y < GROUND - 60 && Math.abs(w.x - t.x) < 160); if (w) { t.cooldown = 40; t.ammo--; blasts.push({ x: w.x + w.vx * 10, y: w.y + w.vy * 10, r: 2, max: 18, t: 0, kills: 0 }); sh.audio.tone({ freq: 800, type: "square", dur: 0.06, vol: 0.06 }); } } }
    for (const p of patriots) { if (p.cooldown > 0) p.cooldown--; else if (p.ammo > 0) { const ts = warheads.filter(w => !w.dead && w.y > 50 && w.y < GROUND - 90).sort((a, b) => b.y - a.y).slice(0, 3); if (ts.length) { p.cooldown = 90; for (const w of ts) { if (p.ammo <= 0) break; p.ammo--; fireAt(w.x + w.vx * 18, w.y + w.vy * 18, sh, false, { x: p.x, ammo: Infinity, small: true }); } } } }
    for (const tr of trucks) { tr.x += tr.dir * 0.6; if (tr.x < 40 || tr.x > W - 40) tr.dir *= -1; if (tr.cooldown > 0) tr.cooldown--; else if (tr.ammo > 0) { const w = warheads.filter(w => !w.dead && w.y > 80 && w.y < GROUND - 70).sort((a, b) => Math.abs(a.x - tr.x) - Math.abs(b.x - tr.x))[0]; if (w) { tr.cooldown = 45; tr.ammo--; fireAt(w.x + w.vx * 16, w.y + w.vy * 16, sh, false, { x: tr.x, ammo: Infinity, small: true }); } } }
    trucks = trucks.filter(t => t.ammo > 0 || t.cooldown > 0);
    if (g.autopilot && tick % 24 === 0) { const w = warheads.filter(w => !w.dead && w.y > 60).sort((a, b) => b.y - a.y)[0]; if (w) fireAt(w.x + w.vx * 14, w.y + w.vy * 14, sh, false); }

    warheads = warheads.filter(w => !w.dead); shots = shots.filter(s => !s.dead); blasts = blasts.filter(b => !b.dead); shields = shields.filter(s => s.hp > 0);
    if (!cities.some(c => c.alive)) { phase = "lost"; phaseT = 0; say("All cities lost", 120); sh.audio.gameOver(); return; }
    if (toSpawn <= 0 && !warheads.length && !bombers.length && !shots.length && !blasts.length) endWave(sh);
  }
  function targetX(sh) { const alive = [...cities.filter(c => c.alive).map(c => c.x), ...batteries.map(b => b.x), ...patriots.map(p => p.x)]; return alive[sh.rng.int(alive.length)] + (sh.rng.next() - 0.5) * 20; }
  function mkWarhead(sh, x, y, tx, speedMul = 1) {
    const sp = (0.9 + wave * 0.08) * diff.speed * speedMul;
    const dx = tx - x, dy = GROUND - y, len = Math.hypot(dx, dy) || 1;
    return { x, y, tx, vx: dx / len * sp, vy: dy / len * sp, trail: [], mirv: wave >= diff.mirvFrom && sh.rng.next() < 0.15 + wave * 0.02, splitY: 100 + sh.rng.int(120), smart: wave >= diff.smartFrom && sh.rng.next() < 0.12 + wave * 0.02 };
  }
  function spawnWarhead(sh) { toSpawn--; warheads.push(mkWarhead(sh, sh.rng.next() * W, -10, targetX(sh))); }
  function groundHit(w, sh) {
    const sd = shields.find(s => s.hp > 0 && Math.abs(s.x - w.x) < s.r);
    if (sd) { sd.hp--; sd.flash = 20; burst(w.x, GROUND - 40, 14, T?.cyan, sh); pop(w.x, GROUND - 60, sd.hp ? `shield ${sd.hp}` : "shield down", T?.cyan); sh.audio.tone({ freq: 700, type: "sine", dur: 0.2, vol: 0.08 }); return; }
    burst(w.x, GROUND, 30, T?.accent, sh); shake = 14; sh.audio.hit();
    for (const c of cities) if (c.alive && Math.abs(c.x - w.x) < 26) { c.alive = false; say("City destroyed", 60); burst(c.x, GROUND, 50, T?.accent, sh); shake = 22; }
    for (const b of batteries) if (Math.abs(b.x - w.x) < 22 && b.ammo > 0) { b.ammo = 0; pop(b.x, GROUND - 30, "battery hit", T?.accent); }
    for (const p of patriots) if (Math.abs(p.x - w.x) < 22) { p.ammo = 0; pop(p.x, GROUND - 30, "launcher hit", T?.accent); }
    patriots = patriots.filter(p => p.ammo > 0);
  }
  function endWave(sh) {
    const alive = cities.filter(c => c.alive).length, ammo = batteries.reduce((a, b) => a + b.ammo, 0);
    const bonus = alive * 100 + ammo * 5, cr = alive * 8 + wave * 5;
    g.score += bonus; sh.wallet?.earn(cr);
    pop(W / 2, H / 2 - 20, `Wave ${wave} cleared · +${bonus}`, T?.marquee);
    pop(W / 2, H / 2 + 10, `${alive} cities × 100 · ${ammo} ammo × 5 · +${cr} cr`, T?.cyan);
    if (wave % 3 === 0) { const dead = cities.find(c => !c.alive); if (dead) { dead.alive = true; pop(dead.x, GROUND - 30, "rebuilt", T?.cyan); } }
    phase = "between"; phaseT = 0; sh.audio.levelUp();
  }
  function burst(x, y, n, color, sh) { for (let i = 0; i < n; i++) { const a = sh.rng.next() * 6.28, sp = 0.5 + sh.rng.next() * 3; particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.5, ttl: 25 + sh.rng.int(35), color }); } }

  function hud() { return `${diff.name} · wave ${wave} · ${cities.filter(c => c.alive).length} cities · ${batteries.reduce((a, b) => a + b.ammo, 0)} ammo · ${killed} shot down`; }

  // ---------- render ----------
  function skyNow() {
    let a = SKY[0], b = SKY[1];
    for (let i = 0; i < SKY.length - 1; i++) if (dayT >= SKY[i].t && dayT <= SKY[i + 1].t) { a = SKY[i]; b = SKY[i + 1]; break; }
    const k = (dayT - a.t) / (b.t - a.t || 1);
    return { top: mix(a.top, b.top, k), mid: mix(a.mid, b.mid, k), bot: mix(a.bot, b.bot, k), stars: a.stars + (b.stars - a.stars) * k };
  }
  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    const sky = skyNow();
    c.save();
    if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.7, (Math.random() - 0.5) * shake * 0.7);
    const grd = c.createLinearGradient(0, 0, 0, GROUND); grd.addColorStop(0, sky.top); grd.addColorStop(0.65, sky.mid); grd.addColorStop(1, sky.bot);
    c.fillStyle = grd; c.fillRect(-10, -10, W + 20, H + 20);
    if (sky.stars > 0.02) { c.fillStyle = "#fff"; for (const [x, y, s] of stars) { c.globalAlpha = sky.stars * (0.25 + 0.6 * Math.abs(Math.sin(tick / 50 + s * 9))); c.fillRect(x, y, s > 0.85 ? 2 : 1, s > 0.85 ? 2 : 1); } c.globalAlpha = 1; }
    // sun (day) and moon (night) travel an arc
    const sunA = (dayT - 0.25) * Math.PI * 2 / 1; // sun up from ~0.25 to ~0.75
    if (dayT > 0.22 && dayT < 0.78) { const k = (dayT - 0.22) / 0.56, sx = 60 + k * (W - 120), sy = GROUND - 40 - Math.sin(k * Math.PI) * (GROUND - 90); c.shadowColor = "#FFF2C0"; c.shadowBlur = 50; c.fillStyle = "#FFF4CC"; c.beginPath(); c.arc(sx, sy, 20, 0, 7); c.fill(); c.shadowBlur = 0; }
    if (dayT > 0.72 || dayT < 0.28) { const k = ((dayT + 0.28) % 1) / 0.56, mx = 60 + k * (W - 120), my = GROUND - 40 - Math.sin(k * Math.PI) * (GROUND - 90); c.shadowColor = "#F4F1E6"; c.shadowBlur = 30; c.fillStyle = "#EEEBE0"; c.beginPath(); c.arc(mx, my, 16, 0, 7); c.fill(); c.shadowBlur = 0; c.fillStyle = "rgba(0,0,0,0.1)"; c.beginPath(); c.arc(mx - 5, my - 3, 4, 0, 7); c.fill(); }
    void sunA;
    // ground
    const gg = c.createLinearGradient(0, GROUND, 0, H); gg.addColorStop(0, shade(T.surface3, 0.1)); gg.addColorStop(1, shade(T.surface, -0.4));
    c.fillStyle = gg; c.fillRect(-10, GROUND, W + 20, H - GROUND + 10);
    c.fillStyle = shade(T.cyan, 0.1); c.globalAlpha = 0.6; c.fillRect(0, GROUND, W, 2); c.globalAlpha = 1;
    cities.forEach((ci, i) => { if (ci.alive) drawCity(c, ci, skyline[i], sky.stars); else { c.fillStyle = "#1a1012"; for (const b of skyline[i]) c.fillRect(ci.x + b.dx, GROUND - 4, b.w, 4); c.fillStyle = T.accent; c.globalAlpha = 0.3 + 0.2 * Math.sin(tick / 7 + i); c.beginPath(); c.arc(ci.x, GROUND - 2, 6, Math.PI, 0); c.fill(); c.globalAlpha = 1; } });
    for (const b of batteries) drawBattery(c, b);
    for (const p of patriots) drawPatriot(c, p);
    for (const t of turrets) { c.fillStyle = T.marquee; rr(c, t.x - 10, GROUND - 24, 20, 10, 3); c.fill(); c.strokeStyle = T.marquee; c.lineWidth = 3; c.beginPath(); c.moveTo(t.x, GROUND - 20); c.lineTo(t.x + Math.cos(tick / 20) * 10, GROUND - 30 - Math.abs(Math.sin(tick / 20)) * 6); c.stroke(); c.fillStyle = "#fff"; c.font = "9px system-ui,sans-serif"; c.textAlign = "center"; c.fillText(t.ammo, t.x, GROUND - 34); }
    for (const tr of trucks) drawTruck(c, tr);
    for (const s of shields) { const k = s.flash ? (s.flash-- / 20) : 0; c.globalAlpha = 0.12 + 0.05 * Math.sin(tick / 8) + k * 0.3; c.fillStyle = T.cyan; c.beginPath(); c.arc(s.x, GROUND, s.r, Math.PI, 0); c.fill(); c.globalAlpha = 0.6 + k * 0.4; c.strokeStyle = T.cyan; c.lineWidth = 2; c.stroke(); c.globalAlpha = 1; c.fillStyle = T.cyan; c.font = "700 10px system-ui,sans-serif"; c.textAlign = "center"; c.fillText("●".repeat(s.hp), s.x, GROUND - s.r + 12); }
    for (const b of bombers) { c.fillStyle = sky.stars > 0.5 ? "#fff" : "#222"; c.beginPath(); c.moveTo(b.x - 14, b.y); c.lineTo(b.x + 14, b.y); c.lineTo(b.x + 4, b.y + 5); c.lineTo(b.x - 6, b.y + 5); c.closePath(); c.fill(); c.fillRect(b.x - 2, b.y - 5, 4, 5); c.fillStyle = T.accent; c.globalAlpha = 0.5 + 0.5 * Math.sin(tick / 4); c.fillRect(b.x + 12, b.y - 1, 2, 2); c.globalAlpha = 1; }
    for (const w of warheads) {
      const col = w.smart ? T.marquee : T.accent;
      c.strokeStyle = col; c.lineWidth = 1.5; c.globalAlpha = 0.55; c.beginPath(); for (const [x, y] of w.trail) c.lineTo(x, y); c.lineTo(w.x, w.y); c.stroke(); c.globalAlpha = 1;
      c.shadowColor = col; c.shadowBlur = 12; c.fillStyle = "#fff"; c.beginPath(); c.arc(w.x, w.y, w.mirv ? 3.5 : 2.5, 0, 7); c.fill(); c.shadowBlur = 0;
      if (w.smart) { c.strokeStyle = col; c.lineWidth = 1; c.globalAlpha = 0.5 + 0.4 * Math.sin(tick / 3); c.beginPath(); c.arc(w.x, w.y, 6, 0, 7); c.stroke(); c.globalAlpha = 1; }
      if (w.mirv) { c.fillStyle = col; c.globalAlpha = 0.6; c.beginPath(); c.arc(w.x - 3, w.y + 3, 1.5, 0, 7); c.arc(w.x + 3, w.y + 3, 1.5, 0, 7); c.fill(); c.globalAlpha = 1; }
    }
    for (const s of shots) {
      c.strokeStyle = T.cyan; c.lineWidth = 1.5; c.globalAlpha = 0.6; c.beginPath(); for (const [x, y] of s.trail) c.lineTo(x, y); c.lineTo(s.x, s.y); c.stroke(); c.globalAlpha = 1;
      c.shadowColor = T.cyan; c.shadowBlur = 10; c.fillStyle = T.cyan; c.beginPath(); c.arc(s.x, s.y, 2.5, 0, 7); c.fill(); c.shadowBlur = 0;
      c.strokeStyle = T.cyan; c.globalAlpha = 0.5; c.beginPath(); c.moveTo(s.tx - 5, s.ty); c.lineTo(s.tx + 5, s.ty); c.moveTo(s.tx, s.ty - 5); c.lineTo(s.tx, s.ty + 5); c.stroke(); c.globalAlpha = 1;
    }
    for (const b of blasts) {
      const k = Math.min(1, b.t / 30);
      const bg = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r + 1); bg.addColorStop(0, "#ffffff"); bg.addColorStop(0.35, T.marquee); bg.addColorStop(0.8, T.accent); bg.addColorStop(1, "rgba(0,0,0,0)");
      c.globalAlpha = 0.85; c.fillStyle = bg; c.beginPath(); c.arc(b.x, b.y, b.r, 0, 7); c.fill();
      c.globalAlpha = 0.5 * (1 - k); c.strokeStyle = "#fff"; c.lineWidth = 2; c.beginPath(); c.arc(b.x, b.y, b.r + 4 + k * 10, 0, 7); c.stroke(); c.globalAlpha = 1;
    }
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 20); c.fillStyle = p.color || T.marquee; c.beginPath(); c.arc(p.x, p.y, 1.8, 0, 7); c.fill(); }
    c.globalAlpha = 1;
    if (hover && !shop && !g.autopilot) {
      if (placing && hover.y > GROUND - 120) { c.globalAlpha = 0.6; c.fillStyle = T.cyan; if (placing === "shield") { c.beginPath(); c.arc(hover.x, GROUND, 75, Math.PI, 0); c.fill(); } else rr(c, hover.x - 16, GROUND - 16, 32, 16, 4), c.fill(); c.globalAlpha = 1; }
      else if (phase === "wave" && hover.y < GROUND - 10 && hover.y > BAR) { c.strokeStyle = "#fff"; c.lineWidth = 1; c.globalAlpha = 0.7; c.beginPath(); c.arc(hover.x, hover.y, 9, 0, 7); c.moveTo(hover.x - 14, hover.y); c.lineTo(hover.x - 4, hover.y); c.moveTo(hover.x + 4, hover.y); c.lineTo(hover.x + 14, hover.y); c.moveTo(hover.x, hover.y - 14); c.lineTo(hover.x, hover.y - 4); c.moveTo(hover.x, hover.y + 4); c.lineTo(hover.x, hover.y + 14); c.stroke(); c.globalAlpha = 1; }
    }
    // top bar
    c.fillStyle = "rgba(0,0,0,0.4)"; c.fillRect(0, 0, W, BAR);
    c.fillStyle = "#fff"; c.font = "700 14px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(`Wave ${wave}`, 14, BAR / 2);
    c.fillStyle = "rgba(255,255,255,0.7)"; c.font = "12px system-ui,sans-serif"; c.fillText(`${toSpawn + warheads.length} incoming · ${killed} down`, 86, BAR / 2);
    c.fillStyle = T.cyan; c.font = "700 12px system-ui,sans-serif"; c.textAlign = "right"; c.fillText(`${(sh.wallet?.balance ?? 0).toLocaleString()} cr`, W - 100, BAR / 2);
    c.fillStyle = T.marquee; rr(c, W - 86, 6, 78, 24, 7); c.fill(); c.fillStyle = "#000"; c.textAlign = "center"; c.fillText("Shop (B)", W - 47, BAR / 2);
    for (const p of popups) { const k = 1 - p.ttl / 60; c.globalAlpha = Math.min(1, p.ttl / 15); c.fillStyle = p.color || "#fff"; c.font = "800 14px system-ui,sans-serif"; c.textAlign = "center"; c.shadowColor = "#000"; c.shadowBlur = 6; c.fillText(p.text, p.x, p.y - k * 22); c.shadowBlur = 0; }
    c.globalAlpha = 1;
    if (msgTtl > 0 && msg) { c.font = "800 22px 'Chakra Petch',system-ui,sans-serif"; c.textAlign = "center"; c.fillStyle = T.marquee; c.shadowColor = "#000"; c.shadowBlur = 12; c.globalAlpha = Math.min(1, msgTtl / 20); c.fillText(msg, W / 2, H / 2 - 60); c.shadowBlur = 0; c.globalAlpha = 1; }
    if (shop) drawShop(c, sh);
    c.restore();
  }
  function drawShop(c, sh) {
    const b = shopBox();
    c.fillStyle = "rgba(0,0,0,0.55)"; c.fillRect(-10, -10, W + 20, H + 20);
    c.fillStyle = T.surface; c.shadowColor = "#000"; c.shadowBlur = 30; rr(c, b.x, b.y, b.w, b.h, 14); c.fill(); c.shadowBlur = 0;
    c.strokeStyle = "#ffffff22"; c.lineWidth = 1; rr(c, b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, 14); c.stroke();
    c.fillStyle = T.text; c.font = "800 18px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText("Defence depot", b.x + 16, b.y + 22);
    c.fillStyle = T.cyan; c.textAlign = "right"; c.font = "700 14px system-ui,sans-serif"; c.fillText(`${(sh.wallet?.balance ?? 0).toLocaleString()} credits`, b.x + b.w - 16, b.y + 22);
    SHOP.forEach((it, i) => {
      const y = b.y + 44 + i * 32, can = (sh.wallet?.balance ?? 0) >= it.cost;
      c.fillStyle = i % 2 ? "rgba(255,255,255,0.04)" : "transparent"; c.fillRect(b.x + 8, y, b.w - 16, 32);
      c.fillStyle = can ? T.text : T.textDim; c.font = "700 13px system-ui,sans-serif"; c.textAlign = "left"; c.fillText(it.name, b.x + 16, y + 16);
      c.fillStyle = T.textDim; c.font = "11px system-ui,sans-serif"; c.fillText(it.desc, b.x + 130, y + 16, b.w - 210);
      c.fillStyle = can ? T.marquee : T.textDim; c.font = "700 13px system-ui,sans-serif"; c.textAlign = "right"; c.fillText(it.cost + " cr", b.x + b.w - 16, y + 16);
    });
    c.fillStyle = T.textDim; c.font = "12px system-ui,sans-serif"; c.textAlign = "center"; c.fillText("Click to buy · placeable items ask for a spot on the ground · B closes", b.x + b.w / 2, b.y + b.h - 18);
  }
  function drawCity(c, ci, blocks, night) {
    for (const [i, b] of blocks.entries()) {
      const x = ci.x + b.dx, h = b.h, y = GROUND - h;
      const grd = c.createLinearGradient(x, y, x + b.w, y); grd.addColorStop(0, shade(T.surface3, 0.3)); grd.addColorStop(1, shade(T.surface2, -0.3));
      c.fillStyle = grd; c.fillRect(x, y, b.w, h);
      c.fillStyle = T.marquee; for (let wy = y + 3; wy < GROUND - 3; wy += 4) for (let wx = x + 1; wx < x + b.w - 1; wx += 3) { if (((wx * 7 + wy * 3 + i) % 5) < 3) { c.globalAlpha = (0.2 + 0.8 * night) * (0.5 + 0.4 * Math.abs(Math.sin(tick / 60 + wx + wy))); c.fillRect(wx, wy, 1.5, 2); } }
      c.globalAlpha = 1;
    }
  }
  function drawBattery(c, b) {
    const x = b.x, y = GROUND, col = b.bought ? T.marquee : T.cyan;
    c.fillStyle = "#00000055"; c.beginPath(); c.ellipse(x + 2, y + 1, 22, 6, 0, 0, 7); c.fill();
    const grd = c.createLinearGradient(x, y - 16, x, y); grd.addColorStop(0, shade(col, 0.2)); grd.addColorStop(1, shade(col, -0.5));
    c.fillStyle = grd; c.beginPath(); c.moveTo(x - 22, y); c.lineTo(x - 14, y - 14); c.lineTo(x + 14, y - 14); c.lineTo(x + 22, y); c.closePath(); c.fill();
    c.fillStyle = "#fff"; c.globalAlpha = 0.9; for (let i = 0; i < Math.min(b.ammo, 10); i++) c.fillRect(x - 11 + (i % 5) * 5, y - 11 + Math.floor(i / 5) * 5, 3, 3); c.globalAlpha = 1;
    if (b.ammo <= 0) { c.fillStyle = T.accent; c.font = "700 9px system-ui,sans-serif"; c.textAlign = "center"; c.fillText("EMPTY", x, y - 20); }
  }
  function drawPatriot(c, p) {
    const x = p.x, y = GROUND;
    c.fillStyle = shade(T.cyan, -0.4); rr(c, x - 16, y - 10, 32, 10, 3); c.fill();
    c.save(); c.translate(x, y - 10); c.rotate(-0.6); c.fillStyle = shade(T.cyan, 0.1); rr(c, -6, -22, 12, 22, 2); c.fill(); c.fillStyle = "#fff"; for (let i = 0; i < 4; i++) c.fillRect(-4 + (i % 2) * 5, -20 + Math.floor(i / 2) * 9, 3, 7); c.restore();
    c.fillStyle = "#fff"; c.font = "9px system-ui,sans-serif"; c.textAlign = "center"; c.fillText(`P·${p.ammo}`, x, y - 36);
  }
  function drawTruck(c, tr) {
    const x = tr.x, y = GROUND;
    c.fillStyle = "#00000055"; c.beginPath(); c.ellipse(x, y + 1, 20, 4, 0, 0, 7); c.fill();
    c.fillStyle = shade(T.marquee, -0.3); rr(c, x - 18, y - 12, 36, 9, 2); c.fill();
    c.fillStyle = shade(T.marquee, 0.1); rr(c, x + (tr.dir > 0 ? 8 : -18), y - 18, 10, 8, 2); c.fill();
    c.fillStyle = "#222"; c.beginPath(); c.arc(x - 11, y - 2, 3.5, 0, 7); c.arc(x + 11, y - 2, 3.5, 0, 7); c.fill();
    c.save(); c.translate(x - tr.dir * 4, y - 13); c.rotate(tr.dir > 0 ? -0.9 : -2.2); c.fillStyle = "#fff"; c.fillRect(-2, -14, 4, 14); c.restore();
    c.fillStyle = "#fff"; c.font = "9px system-ui,sans-serif"; c.textAlign = "center"; c.fillText(tr.ammo, x, y - 30);
  }
  function mix(a, b, t) { const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16)); return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join(""); }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
