// Rock Field — spin, thrust, shoot. ←/→ rotate, ↑ thrust, Space fires, ↓ hyperspace (random jump,
// risky). Rocks split into smaller rocks; a saucer shows up now and then and shoots back. Three lives,
// a brief shield after each respawn, extra life every 10,000. The autopilot plays attract mode.
import { loadPack, draw as spr } from "../../shell/sprites.js";
const W = 600, H = 440;
const DIFFICULTY = {
  beginner:     { name: "Beginner",     rocks: 3, speed: 0.7, lives: 4, saucer: 0.0008 },
  intermediate: { name: "Intermediate", rocks: 4, speed: 1.0, lives: 3, saucer: 0.0015 },
  advanced:     { name: "Advanced",     rocks: 5, speed: 1.35, lives: 2, saucer: 0.0025 },
};

export default function createRocks({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0, pack = null; loadPack("space").then(p => { pack = p; });
  const g = { id: "rocks", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, hud };
  let ship, rocks, bullets, saucer, sBullets, particles, popups, lives, msg, msgTtl, shake, stars, nextLife, fireCool;

  function init(sh) { g.score = 0; g.level = 1; lives = diff.lives; particles = []; popups = []; shake = 0; nextLife = 10000; stars = Array.from({ length: 70 }, () => [sh.rng.next() * W, sh.rng.next() * H, sh.rng.next()]); spawnShip(); bullets = []; sBullets = []; saucer = null; fireCool = 0; newWave(sh); }
  function spawnShip() { ship = { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2, shield: 150, thrust: false }; }
  function newWave(sh) { rocks = []; for (let i = 0; i < diff.rocks + g.level - 1; i++) rocks.push(mkRock(sh, 3)); say(`Field ${g.level}`, 90); }
  function mkRock(sh, size, x, y) {
    let rx = x, ry = y;
    if (rx == null) { do { rx = sh.rng.next() * W; ry = sh.rng.next() * H; } while (Math.hypot(rx - ship.x, ry - ship.y) < 120); }
    const a = sh.rng.next() * 6.28, sp = (0.6 + sh.rng.next() * 0.8) * diff.speed * (4 - size) * 0.6 + 0.3;
    return { x: rx, y: ry, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size, r: size * 14, rot: sh.rng.next() * 6.28, vr: (sh.rng.next() - 0.5) * 0.03, pts: Array.from({ length: 9 }, () => 0.7 + sh.rng.next() * 0.5) };
  }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x, y, text, color, ttl: 50 }); }

  function onInput(action, sh) {
    if (!ship) return;
    if (action === "action") fire(sh);
    if (action === "down") { ship.x = sh.rng.next() * W; ship.y = sh.rng.next() * H; ship.vx = ship.vy = 0; ship.shield = 40; sh.audio.tone({ freq: 900, type: "sine", dur: 0.2, slide: -600, vol: 0.1 }); }
  }
  function fire(sh) { if (fireCool > 0 || bullets.length > 5) return; fireCool = 9; bullets.push({ x: ship.x + Math.cos(ship.a) * 14, y: ship.y + Math.sin(ship.a) * 14, vx: Math.cos(ship.a) * 7 + ship.vx * 0.3, vy: Math.sin(ship.a) * 7 + ship.vy * 0.3, ttl: 55 }); sh.audio.tone({ freq: 700, type: "square", dur: 0.05, slide: -300, vol: 0.07 }); }
  function wrap(o) { if (o.x < -20) o.x += W + 40; if (o.x > W + 20) o.x -= W + 40; if (o.y < -20) o.y += H + 40; if (o.y > H + 20) o.y -= H + 40; }

  function update(sh) {
    tick = sh.tick;
    if (msgTtl > 0) msgTtl--; if (shake > 0) shake--; if (fireCool > 0) fireCool--;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; }
    popups = popups.filter(p => (p.ttl -= 1) > 0);
    if (ship) {
      let left = sh.input?.isDown?.("left"), right = sh.input?.isDown?.("right"), up = sh.input?.isDown?.("up");
      if (g.autopilot) { // aim at the nearest rock, keep distance
        const tgt = [...rocks, ...(saucer ? [saucer] : [])].sort((a, b) => dist(a, ship) - dist(b, ship))[0];
        if (tgt) { const want = Math.atan2(tgt.y - ship.y, tgt.x - ship.x); let d = want - ship.a; while (d > Math.PI) d -= 6.283; while (d < -Math.PI) d += 6.283; left = d < -0.08; right = d > 0.08; if (Math.abs(d) < 0.15 && tick % 10 === 0) fire(sh); up = dist(tgt, ship) > 220 && Math.abs(d) < 0.3; if (dist(tgt, ship) < 70 && tick % 40 === 0) onInput("down", sh); }
      }
      if (left) ship.a -= 0.07; if (right) ship.a += 0.07;
      ship.thrust = !!up; if (up) { ship.vx += Math.cos(ship.a) * 0.12; ship.vy += Math.sin(ship.a) * 0.12; if (tick % 2 === 0) particles.push({ x: ship.x - Math.cos(ship.a) * 12, y: ship.y - Math.sin(ship.a) * 12, vx: -Math.cos(ship.a) * 3 + (sh.rng.next() - 0.5), vy: -Math.sin(ship.a) * 3 + (sh.rng.next() - 0.5), ttl: 14, color: T?.marquee }); }
      ship.vx *= 0.992; ship.vy *= 0.992; ship.x += ship.vx; ship.y += ship.vy; wrap(ship); if (ship.shield > 0) ship.shield--;
    } else if (--g._respawn <= 0) { if (lives <= 0) return sh.end(); spawnShip(); }
    for (const r of rocks) { r.x += r.vx; r.y += r.vy; r.rot += r.vr; wrap(r); }
    for (const b of bullets) { b.x += b.vx; b.y += b.vy; b.ttl--; wrap(b); }
    bullets = bullets.filter(b => b.ttl > 0);
    // saucer
    if (!saucer && sh.rng.next() < diff.saucer + g.level * 0.0003) saucer = { x: sh.rng.next() < 0.5 ? -20 : W + 20, y: 60 + sh.rng.next() * (H - 120), vx: 0, r: 12, cool: 60, big: sh.rng.next() < 0.5 };
    if (saucer) { if (!saucer.vx) saucer.vx = saucer.x < 0 ? 1.4 : -1.4; saucer.x += saucer.vx; saucer.y += Math.sin(tick / 40) * 0.8; if (saucer.x < -40 || saucer.x > W + 40) saucer = null; else if (ship && --saucer.cool <= 0) { saucer.cool = saucer.big ? 90 : 60; const a = Math.atan2(ship.y - saucer.y, ship.x - saucer.x) + (saucer.big ? (sh.rng.next() - 0.5) * 0.6 : (sh.rng.next() - 0.5) * 0.2); sBullets.push({ x: saucer.x, y: saucer.y, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, ttl: 90 }); sh.audio.tone({ freq: 400, type: "sawtooth", dur: 0.08, slide: -200, vol: 0.06 }); } }
    for (const b of sBullets) { b.x += b.vx; b.y += b.vy; b.ttl--; wrap(b); } sBullets = sBullets.filter(b => b.ttl > 0);
    // collisions
    for (const b of bullets) {
      for (const r of rocks) if (!r.dead && dist(b, r) < r.r) { b.ttl = 0; splitRock(r, sh); break; }
      if (saucer && dist(b, saucer) < saucer.r + 4) { b.ttl = 0; const pts = saucer.big ? 200 : 1000; g.score += pts; sh.wallet?.earn(saucer.big ? 5 : 15); pop(saucer.x, saucer.y, "+" + pts, T?.cyan); burst(saucer.x, saucer.y, 30, T?.cyan, sh); saucer = null; sh.audio.levelUp(); }
    }
    rocks = rocks.filter(r => !r.dead); bullets = bullets.filter(b => b.ttl > 0);
    if (ship && ship.shield <= 0) {
      const hit = rocks.some(r => dist(r, ship) < r.r + 8) || sBullets.some(b => dist(b, ship) < 10) || (saucer && dist(saucer, ship) < saucer.r + 10);
      if (hit) { burst(ship.x, ship.y, 40, T?.accent, sh); shake = 20; sh.audio.hit(); lives--; ship = null; g._respawn = 90; say(lives > 0 ? `${lives} ${lives === 1 ? "ship" : "ships"} left` : "Out of ships", 90); }
    }
    if (g.score >= nextLife) { nextLife += 10000; lives++; pop(W / 2, 60, "Extra ship!", T?.marquee); sh.audio.levelUp(); }
    if (!rocks.length && ship) { g.score += 300 * g.level; sh.wallet?.earn(10 + g.level * 3); g.level++; sh.audio.levelUp(); newWave(sh); }
  }
  function splitRock(r, sh) {
    r.dead = true; const pts = [0, 100, 50, 20][r.size]; g.score += pts; sh.wallet?.earn(r.size === 1 ? 2 : 1); pop(r.x, r.y, "+" + pts, T?.marquee);
    burst(r.x, r.y, 8 * r.size, T?.textDim, sh); sh.audio.tone({ freq: 90 + r.size * 40, type: "sawtooth", dur: 0.2, slide: -50, vol: 0.12 });
    if (r.size > 1) for (let i = 0; i < 2; i++) rocks.push(mkRock(sh, r.size - 1, r.x, r.y));
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function burst(x, y, n, color, sh) { for (let i = 0; i < n; i++) { const a = sh.rng.next() * 6.28, sp = 0.5 + sh.rng.next() * 3; particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ttl: 20 + sh.rng.int(30), color }); } }
  function hud() { return `${diff.name} · field ${g.level} · ${lives} ships · ${rocks.length} rocks`; }

  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    c.save(); if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.7, (Math.random() - 0.5) * shake * 0.7);
    const bg = c.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, W * 0.75); bg.addColorStop(0, T.bgGlow1); bg.addColorStop(1, T.bg);
    c.fillStyle = bg; c.fillRect(-10, -10, W + 20, H + 20);
    c.fillStyle = "#fff"; for (const [x, y, s] of stars) { c.globalAlpha = 0.2 + 0.6 * Math.abs(Math.sin(tick / 45 + s * 8)); c.fillRect(x, y, s > 0.85 ? 2 : 1, s > 0.85 ? 2 : 1); } c.globalAlpha = 1;
    for (const r of rocks) {
      if (spr(c, pack, ["", "meteor_small", "meteor_med", "meteor_big"][r.size], r.x, r.y, { rot: r.rot })) continue;
      c.save(); c.translate(r.x, r.y); c.rotate(r.rot);
      c.beginPath(); r.pts.forEach((k, i) => { const a = i / r.pts.length * 6.283; c.lineTo(Math.cos(a) * r.r * k, Math.sin(a) * r.r * k); }); c.closePath();
      const grd = c.createRadialGradient(-r.r * 0.3, -r.r * 0.3, 2, 0, 0, r.r); grd.addColorStop(0, shade(T.rock, 0.5)); grd.addColorStop(1, shade(T.rock, -0.45));
      c.fillStyle = grd; c.shadowColor = "#000"; c.shadowBlur = 10; c.fill(); c.shadowBlur = 0; c.strokeStyle = shade(T.rock, 0.25); c.lineWidth = 1.5; c.stroke();
      c.restore();
    }
    if (saucer && spr(c, pack, "ufo", saucer.x, saucer.y, { rot: tick / 40, scale: saucer.big ? 1.3 : 0.9 })) {} else if (saucer) { c.fillStyle = shade(T.cyan, -0.2); c.beginPath(); c.ellipse(saucer.x, saucer.y, saucer.r * 1.6, saucer.r * 0.5, 0, 0, 7); c.fill(); c.fillStyle = shade(T.cyan, 0.4); c.beginPath(); c.arc(saucer.x, saucer.y - 3, saucer.r * 0.6, Math.PI, 0); c.fill(); c.fillStyle = T.accent; c.globalAlpha = 0.6 + 0.4 * Math.sin(tick / 4); c.beginPath(); c.arc(saucer.x, saucer.y - 1, 2, 0, 7); c.fill(); c.globalAlpha = 1; }
    for (const b of bullets) { if (spr(c, pack, "laser", b.x, b.y, { rot: Math.atan2(b.vy, b.vx) })) continue; c.shadowColor = T.marquee; c.shadowBlur = 8; c.fillStyle = "#fff"; c.beginPath(); c.arc(b.x, b.y, 2, 0, 7); c.fill(); c.shadowBlur = 0; }
    for (const b of sBullets) { c.shadowColor = T.accent; c.shadowBlur = 8; c.fillStyle = T.accent; c.beginPath(); c.arc(b.x, b.y, 2.5, 0, 7); c.fill(); c.shadowBlur = 0; }
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color || "#fff"; c.fillRect(p.x, p.y, 2, 2); } c.globalAlpha = 1;
    if (ship && pack?.sprites?.ship) { if (ship.shield > 0) { c.globalAlpha = 0.25 + 0.15 * Math.sin(tick / 4); c.fillStyle = T.cyan; c.beginPath(); c.arc(ship.x, ship.y, 22, 0, 7); c.fill(); c.globalAlpha = 1; } if (ship.thrust) spr(c, pack, "flame", ship.x - Math.cos(ship.a) * 16, ship.y - Math.sin(ship.a) * 16, { rot: ship.a + Math.PI }); spr(c, pack, "ship", ship.x, ship.y, { rot: ship.a }); }
    else if (ship) {
      c.save(); c.translate(ship.x, ship.y); c.rotate(ship.a);
      if (ship.shield > 0) { c.globalAlpha = 0.25 + 0.15 * Math.sin(tick / 4); c.fillStyle = T.cyan; c.beginPath(); c.arc(0, 0, 20, 0, 7); c.fill(); c.globalAlpha = 1; }
      if (ship.thrust) { c.fillStyle = T.marquee; c.shadowColor = T.marquee; c.shadowBlur = 14; c.beginPath(); c.moveTo(-10, -5); c.lineTo(-18 - Math.random() * 8, 0); c.lineTo(-10, 5); c.closePath(); c.fill(); c.shadowBlur = 0; }
      const grd = c.createLinearGradient(0, -10, 0, 10); grd.addColorStop(0, shade(T.cyan, 0.5)); grd.addColorStop(1, shade(T.cyan, -0.3));
      c.fillStyle = grd; c.shadowColor = T.cyan; c.shadowBlur = 10; c.beginPath(); c.moveTo(14, 0); c.lineTo(-10, -9); c.lineTo(-6, 0); c.lineTo(-10, 9); c.closePath(); c.fill(); c.shadowBlur = 0;
      c.fillStyle = "#fff"; c.beginPath(); c.arc(3, 0, 2.5, 0, 7); c.fill();
      c.restore();
    }
    c.fillStyle = T.cyan; for (let i = 0; i < lives; i++) { c.save(); c.translate(W - 20 - i * 18, 20); c.rotate(-Math.PI / 2); c.beginPath(); c.moveTo(8, 0); c.lineTo(-6, -5); c.lineTo(-3, 0); c.lineTo(-6, 5); c.closePath(); c.fill(); c.restore(); }
    for (const p of popups) { const k = 1 - p.ttl / 50; c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color || "#fff"; c.font = "800 13px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.shadowColor = "#000"; c.shadowBlur = 5; c.fillText(p.text, p.x, p.y - k * 20); c.shadowBlur = 0; } c.globalAlpha = 1;
    if (msgTtl > 0 && msg) { c.font = "800 24px 'Chakra Petch',system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = T.marquee; c.shadowColor = "#000"; c.shadowBlur = 10; c.globalAlpha = Math.min(1, msgTtl / 20); c.fillText(msg, W / 2, 60); c.shadowBlur = 0; c.globalAlpha = 1; }
    c.restore();
  }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
