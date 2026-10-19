// Chopper Command — a desert road, a convoy of trucks, and enemy jets and helicopters trying to
// bomb them. Fly with arrows/WASD (the chopper faces the way you last moved), Space fires. The world
// is wider than the screen and scrolls with you; the radar at the top shows everything. Save the
// trucks for the wave bonus; lose them all or run out of choppers and it's over.
const W = 640, H = 400, WORLD = 2400, GROUND = H - 48, RADAR_H = 34;
const DIFFICULTY = {
  beginner:     { name: "Beginner",     enemies: 4, speed: 1.4, lives: 4, aim: 0.5 },
  intermediate: { name: "Intermediate", enemies: 6, speed: 1.8, lives: 3, aim: 0.75 },
  advanced:     { name: "Advanced",     enemies: 8, speed: 2.3, lives: 2, aim: 1.0 },
};

export default function createChopper({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0;
  const g = { id: "chopper", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, hud };
  let heli, cam, trucks, enemies, bullets, eBullets, bombs, particles, popups, lives, wave, msg, msgTtl, shake, dunes, fireCool, respawn, between;

  function init(sh) { g.score = 0; g.level = 1; wave = 0; lives = diff.lives; particles = []; popups = []; shake = 0; respawn = 0; between = 0; dunes = Array.from({ length: 40 }, (_, i) => ({ x: i * 70 + sh.rng.int(40), w: 60 + sh.rng.int(80), h: 10 + sh.rng.int(22) })); spawnHeli(); newWave(sh); }
  function spawnHeli() { heli = { x: WORLD / 2, y: 180, vx: 0, vy: 0, dir: 1, inv: 120 }; cam = heli.x - W / 2; }
  function newWave(sh) {
    wave++; g.level = wave;
    trucks = Array.from({ length: 6 }, (_, i) => ({ x: 300 + i * 320 + sh.rng.int(100), alive: true, flash: 0 }));
    enemies = []; bullets = []; eBullets = []; bombs = [];
    for (let i = 0; i < diff.enemies + wave; i++) enemies.push(mkEnemy(sh));
    say(`Wave ${wave}`, 100);
  }
  function mkEnemy(sh) { const jet = sh.rng.next() < 0.4 + wave * 0.05; return { x: sh.rng.next() * WORLD, y: 60 + sh.rng.int(200), vx: (sh.rng.next() < 0.5 ? -1 : 1) * (jet ? diff.speed * 1.6 : diff.speed * 0.9), jet, cool: 60 + sh.rng.int(120), bombCool: 120 + sh.rng.int(200), hp: jet ? 1 : 2, wob: sh.rng.next() * 6.28 }; }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x, y, text, color, ttl: 55 }); }
  function onInput(action, sh) { if (action === "action") fire(sh); }
  function fire(sh) { if (!heli || fireCool > 0) return; fireCool = 10; bullets.push({ x: heli.x + heli.dir * 22, y: heli.y + 4, vx: heli.dir * 9 + heli.vx, ttl: 70 }); sh.audio.tone({ freq: 600, type: "square", dur: 0.05, slide: -250, vol: 0.07 }); }
  const sx = (x) => x - cam;

  function update(sh) {
    tick = sh.tick;
    if (msgTtl > 0) msgTtl--; if (shake > 0) shake--; if (fireCool > 0) fireCool--;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.08; }
    popups = popups.filter(p => (p.ttl -= 1) > 0);
    if (between > 0) { if (--between === 0) newWave(sh); return; }
    if (heli) {
      let l = sh.input?.isDown?.("left"), r = sh.input?.isDown?.("right"), u = sh.input?.isDown?.("up"), d = sh.input?.isDown?.("down");
      if (g.autopilot) { // hunt the nearest enemy, prefer the one closest to a truck
        const e = enemies.sort((a, b) => Math.abs(a.x - heli.x) - Math.abs(b.x - heli.x))[0];
        if (e) { l = e.x < heli.x - 40; r = e.x > heli.x + 40; u = e.y < heli.y - 8; d = e.y > heli.y + 8; if (Math.abs(e.y - heli.y) < 14 && Math.abs(e.x - heli.x) < 320 && Math.sign(e.x - heli.x) === heli.dir && tick % 8 === 0) fire(sh); }
        for (const b of [...eBullets, ...bombs]) if (Math.abs(b.x - heli.x) < 40 && Math.abs(b.y - heli.y) < 40) { u = b.y > heli.y; d = !u; }
      }
      heli.vx += ((r ? 1 : 0) - (l ? 1 : 0)) * 0.35; heli.vy += ((d ? 1 : 0) - (u ? 1 : 0)) * 0.3;
      if (l) heli.dir = -1; if (r) heli.dir = 1;
      heli.vx *= 0.93; heli.vy *= 0.9; heli.x += heli.vx; heli.y += heli.vy;
      heli.x = Math.max(30, Math.min(WORLD - 30, heli.x)); heli.y = Math.max(RADAR_H + 30, Math.min(GROUND - 30, heli.y)); if (heli.inv > 0) heli.inv--;
      const target = heli.x - W / 2 + heli.dir * 120; cam += (target - cam) * 0.08; cam = Math.max(0, Math.min(WORLD - W, cam));
    } else if (--respawn <= 0) { if (lives <= 0) return sh.end(); spawnHeli(); }
    for (const e of enemies) {
      e.x += e.vx; e.y += Math.sin(tick / 30 + e.wob) * 0.6; if (e.x < -40) e.x = WORLD + 40; if (e.x > WORLD + 40) e.x = -40;
      if (heli && --e.cool <= 0) { e.cool = 90 + Math.round(sh.rng.next() * 120 / diff.aim); if (Math.abs(e.x - heli.x) < 360) { const dx = heli.x - e.x, dy = heli.y - e.y, len = Math.hypot(dx, dy) || 1; eBullets.push({ x: e.x, y: e.y, vx: dx / len * 4, vy: dy / len * 4, ttl: 110 }); } }
      if (--e.bombCool <= 0) { e.bombCool = 150 + sh.rng.int(200); const t = trucks.filter(t => t.alive).sort((a, b) => Math.abs(a.x - e.x) - Math.abs(b.x - e.x))[0]; if (t && Math.abs(t.x - e.x) < 140) bombs.push({ x: e.x, y: e.y, vx: e.vx * 0.5, vy: 0 }); }
    }
    for (const b of bullets) { b.x += b.vx; b.ttl--; } bullets = bullets.filter(b => b.ttl > 0);
    for (const b of eBullets) { b.x += b.vx; b.y += b.vy; b.ttl--; } eBullets = eBullets.filter(b => b.ttl > 0);
    for (const b of bombs) { b.vy += 0.12; b.x += b.vx; b.y += b.vy; if (b.y >= GROUND - 6) { b.dead = true; burst(b.x, GROUND - 6, 16, T?.accent, sh); for (const t of trucks) if (t.alive && Math.abs(t.x - b.x) < 24) { t.alive = false; shake = 16; say("Truck lost", 60); burst(t.x, GROUND - 10, 30, T?.accent, sh); sh.audio.hit(); } } }
    bombs = bombs.filter(b => !b.dead);
    for (const b of bullets) { for (const e of enemies) if (!e.dead && Math.abs(b.x - e.x) < 18 && Math.abs(b.y - e.y) < 12) { b.ttl = 0; if (--e.hp <= 0) { e.dead = true; const pts = e.jet ? 150 : 100; g.score += pts; sh.wallet?.earn(e.jet ? 4 : 3); pop(e.x, e.y, `+${pts}`, T?.marquee); burst(e.x, e.y, 24, e.jet ? T?.cyan : T?.accent, sh); sh.audio.tone({ freq: 120, type: "sawtooth", dur: 0.25, slide: -60, vol: 0.12 }); } else sh.audio.tone({ freq: 300, type: "square", dur: 0.04, vol: 0.06 }); break; }
      for (const bm of bombs) if (Math.abs(b.x - bm.x) < 8 && Math.abs(b.y - bm.y) < 8) { b.ttl = 0; bm.dead = true; g.score += 50; pop(bm.x, bm.y, "+50", "#fff"); burst(bm.x, bm.y, 8, T?.marquee, sh); } }
    enemies = enemies.filter(e => !e.dead); bombs = bombs.filter(b => !b.dead);
    if (heli && heli.inv <= 0) {
      const hit = eBullets.some(b => Math.abs(b.x - heli.x) < 16 && Math.abs(b.y - heli.y) < 10) || enemies.some(e => Math.abs(e.x - heli.x) < 22 && Math.abs(e.y - heli.y) < 14);
      if (hit) { burst(heli.x, heli.y, 40, T?.marquee, sh); shake = 22; sh.audio.hit(); lives--; heli = null; respawn = 100; say(lives > 0 ? `${lives} ${lives === 1 ? "chopper" : "choppers"} left` : "Chopper down", 90); }
    }
    if (!trucks.some(t => t.alive)) { say("Convoy destroyed", 90); lives = 0; if (heli) { heli = null; respawn = 90; } }
    if (!enemies.length && heli) { const alive = trucks.filter(t => t.alive).length, bonus = alive * 200 + wave * 100; g.score += bonus; sh.wallet?.earn(alive * 5 + wave * 4); pop(heli.x, heli.y - 40, `Wave ${wave} clear · +${bonus}`, T?.marquee); sh.audio.levelUp(); between = 120; }
  }
  function burst(x, y, n, color, sh) { for (let i = 0; i < n; i++) { const a = sh.rng.next() * 6.28, sp = 0.5 + sh.rng.next() * 3; particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, ttl: 20 + sh.rng.int(30), color }); } }
  function hud() { return `${diff.name} · wave ${wave} · ${lives} choppers · ${trucks.filter(t => t.alive).length} trucks · ${enemies.length} hostiles`; }

  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    c.save(); if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.7, (Math.random() - 0.5) * shake * 0.7);
    const sky = c.createLinearGradient(0, 0, 0, GROUND); sky.addColorStop(0, "#1C3F72"); sky.addColorStop(0.7, "#E9A66B"); sky.addColorStop(1, "#F6D6A8");
    c.fillStyle = sky; c.fillRect(-10, -10, W + 20, H + 20);
    c.fillStyle = "#FFF3C4"; c.shadowColor = "#FFE08A"; c.shadowBlur = 40; c.beginPath(); c.arc(sx(WORLD * 0.3) * 0.3 + 420, 80, 26, 0, 7); c.fill(); c.shadowBlur = 0;
    // dunes (parallax) and ground
    c.fillStyle = "#C98A4B"; for (const d of dunes) { const x = sx(d.x) * 0.5 + 100; c.beginPath(); c.ellipse(x, GROUND, d.w, d.h, 0, Math.PI, 0); c.fill(); }
    const gg = c.createLinearGradient(0, GROUND, 0, H); gg.addColorStop(0, "#B8793F"); gg.addColorStop(1, "#6E4220"); c.fillStyle = gg; c.fillRect(-10, GROUND, W + 20, H - GROUND + 10);
    c.fillStyle = "#3A2A1E"; c.fillRect(-10, GROUND + 6, W + 20, 10); c.strokeStyle = "#F4E2B8"; c.setLineDash([14, 14]); c.lineDashOffset = -cam; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, GROUND + 11); c.lineTo(W, GROUND + 11); c.stroke(); c.setLineDash([]);
    for (const t of trucks) { const x = sx(t.x); if (x < -40 || x > W + 40) continue; if (t.alive) { c.fillStyle = "#3B6B3B"; rr(c, x - 18, GROUND - 14, 36, 12, 2); c.fill(); c.fillStyle = "#5C9A5C"; rr(c, x + 8, GROUND - 22, 12, 9, 2); c.fill(); c.fillStyle = "#222"; c.beginPath(); c.arc(x - 10, GROUND - 2, 4, 0, 7); c.arc(x + 10, GROUND - 2, 4, 0, 7); c.fill(); } else { c.fillStyle = "#2a1a12"; rr(c, x - 16, GROUND - 8, 32, 8, 2); c.fill(); c.fillStyle = "#555"; c.globalAlpha = 0.5 + 0.3 * Math.sin(tick / 9 + t.x); c.beginPath(); c.arc(x + Math.sin(tick / 20) * 4, GROUND - 18 - (tick % 40) / 4, 6, 0, 7); c.fill(); c.globalAlpha = 1; } }
    for (const e of enemies) { const x = sx(e.x); if (x < -60 || x > W + 60) continue; if (e.jet) drawJet(c, x, e.y, Math.sign(e.vx)); else drawHeli(c, x, e.y, Math.sign(e.vx), T.accent, false); }
    for (const b of bombs) { const x = sx(b.x); c.fillStyle = "#222"; c.beginPath(); c.ellipse(x, b.y, 3, 6, 0, 0, 7); c.fill(); }
    for (const b of eBullets) { const x = sx(b.x); c.shadowColor = T.accent; c.shadowBlur = 8; c.fillStyle = T.accent; c.beginPath(); c.arc(x, b.y, 2.5, 0, 7); c.fill(); c.shadowBlur = 0; }
    for (const b of bullets) { const x = sx(b.x); c.shadowColor = T.marquee; c.shadowBlur = 8; c.fillStyle = "#fff"; c.fillRect(x - 5, b.y - 1, 10, 2); c.shadowBlur = 0; }
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color || "#fff"; c.fillRect(sx(p.x), p.y, 2.5, 2.5); } c.globalAlpha = 1;
    if (heli) drawHeli(c, sx(heli.x), heli.y, heli.dir, T.cyan, heli.inv > 0);
    // radar
    c.fillStyle = "rgba(0,0,0,0.55)"; c.fillRect(0, 0, W, RADAR_H);
    const rx = (x) => 100 + x / WORLD * (W - 200);
    c.fillStyle = "#ffffff22"; c.fillRect(rx(cam), 6, (W / WORLD) * (W - 200), RADAR_H - 12);
    for (const t of trucks) { c.fillStyle = t.alive ? "#5C9A5C" : "#553"; c.fillRect(rx(t.x) - 2, RADAR_H - 10, 4, 4); }
    for (const e of enemies) { c.fillStyle = T.accent; c.fillRect(rx(e.x) - 1.5, 8 + e.y / GROUND * (RADAR_H - 20), 3, 3); }
    if (heli) { c.fillStyle = T.cyan; c.fillRect(rx(heli.x) - 2, 8 + heli.y / GROUND * (RADAR_H - 20), 4, 4); }
    c.fillStyle = "#fff"; c.font = "700 13px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(`Wave ${wave}`, 12, RADAR_H / 2);
    c.fillStyle = T.cyan; for (let i = 0; i < lives; i++) { c.fillRect(W - 16 - i * 14, RADAR_H / 2 - 2, 10, 4); c.fillRect(W - 13 - i * 14, RADAR_H / 2 - 6, 4, 2); }
    for (const p of popups) { const k = 1 - p.ttl / 55; c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color || "#fff"; c.font = "800 13px system-ui,sans-serif"; c.textAlign = "center"; c.shadowColor = "#000"; c.shadowBlur = 5; c.fillText(p.text, sx(p.x), p.y - k * 20); c.shadowBlur = 0; } c.globalAlpha = 1;
    if (msgTtl > 0 && msg) { c.font = "800 24px 'Chakra Petch',system-ui,sans-serif"; c.textAlign = "center"; c.fillStyle = T.marquee; c.shadowColor = "#000"; c.shadowBlur = 10; c.globalAlpha = Math.min(1, msgTtl / 20); c.fillText(msg, W / 2, 90); c.shadowBlur = 0; c.globalAlpha = 1; }
    c.restore();
  }
  function drawHeli(c, x, y, dir, color, inv) {
    c.save(); c.translate(x, y); c.scale(dir, 1);
    if (inv) { c.globalAlpha = 0.5 + 0.3 * Math.sin(tick / 3); }
    c.fillStyle = "#00000044"; c.beginPath(); c.ellipse(2, 10, 20, 4, 0, 0, 7); c.fill();
    const grd = c.createLinearGradient(0, -8, 0, 8); grd.addColorStop(0, shade(color, 0.4)); grd.addColorStop(1, shade(color, -0.4));
    c.fillStyle = grd; c.beginPath(); c.ellipse(4, 0, 16, 8, 0, 0, 7); c.fill();
    c.fillRect(-26, -2, 16, 3); c.beginPath(); c.moveTo(-26, -8); c.lineTo(-26, 2); c.lineTo(-20, -1); c.closePath(); c.fill();
    c.fillStyle = "#0a1020"; c.beginPath(); c.ellipse(10, -1, 6, 4, 0, 0, 7); c.fill();
    c.fillStyle = shade(color, -0.5); c.fillRect(-8, 9, 24, 2); c.fillRect(-2, 6, 2, 4); c.fillRect(8, 6, 2, 4);
    c.strokeStyle = "#ddd"; c.lineWidth = 2; c.globalAlpha *= 0.7; c.beginPath(); const rot = Math.cos(tick / 1.5) * 26; c.moveTo(4 - rot, -10); c.lineTo(4 + rot, -10); c.stroke();
    c.restore();
  }
  function drawJet(c, x, y, dir) {
    c.save(); c.translate(x, y); c.scale(dir, 1);
    c.fillStyle = "#00000044"; c.beginPath(); c.ellipse(0, 9, 18, 3, 0, 0, 7); c.fill();
    const grd = c.createLinearGradient(0, -6, 0, 6); grd.addColorStop(0, shade(T.accent, 0.3)); grd.addColorStop(1, shade(T.accent, -0.4));
    c.fillStyle = grd; c.beginPath(); c.moveTo(22, 0); c.lineTo(-14, -5); c.lineTo(-20, -9); c.lineTo(-20, 5); c.lineTo(-14, 4); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(4, 0); c.lineTo(-10, -12); c.lineTo(-14, -12); c.lineTo(-6, 0); c.closePath(); c.fill();
    c.fillStyle = T.marquee; c.globalAlpha = 0.7 + 0.3 * Math.sin(tick / 2); c.beginPath(); c.moveTo(-20, -2); c.lineTo(-30 - Math.random() * 6, 0); c.lineTo(-20, 2); c.closePath(); c.fill();
    c.restore();
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
