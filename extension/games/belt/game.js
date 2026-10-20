// Asteroid Belt — fly up through a scrolling belt. Arrows/WASD steer in all directions, Space fires.
// Blast rocks, grab ore crystals for credits, pick up shields and rapid-fire. The belt thickens the
// further you go; distance and ore both score. Three hulls, then it's over.
import { loadPack, draw as spr } from "../../shell/sprites.js";
const W = 420, H = 480;
const DIFFICULTY = {
  beginner:     { name: "Beginner",     density: 0.016, speed: 1.4, hulls: 4 },
  intermediate: { name: "Intermediate", density: 0.024, speed: 1.8, hulls: 3 },
  advanced:     { name: "Advanced",     density: 0.034, speed: 2.3, hulls: 2 },
};

export default function createBelt({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0, pack = null; loadPack("space").then(p => { pack = p; });
  const g = { id: "belt", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, hud };
  let ship, rocks, bullets, pickups, particles, popups, stars, hulls, dist, shield, rapid, fireCool, msg, msgTtl, shake, ore, respawn;

  function init(sh) { g.score = 0; g.level = 1; hulls = diff.hulls; dist = 0; ore = 0; rocks = []; bullets = []; pickups = []; particles = []; popups = []; shake = 0; shield = 0; rapid = 0; fireCool = 0; respawn = 0; ship = { x: W / 2, y: H - 80, vx: 0, vy: 0, inv: 120 }; stars = Array.from({ length: 120 }, () => [sh.rng.next() * W, sh.rng.next() * H, 0.3 + sh.rng.next()]); say("Into the belt", 90); }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x, y, text, color, ttl: 50 }); }
  function onInput(action, sh) { if (action === "action") fire(sh); }
  function fire(sh) { if (!ship || fireCool > 0) return; fireCool = rapid > 0 ? 5 : 12; bullets.push({ x: ship.x - 6, y: ship.y - 10, vy: -9 }, { x: ship.x + 6, y: ship.y - 10, vy: -9 }); sh.audio.tone({ freq: 800, type: "square", dur: 0.04, slide: -300, vol: 0.06 }); }
  function mkRock(sh) { const size = 1 + sh.rng.int(3); return { x: sh.rng.next() * W, y: -40, size, r: size * 11 + 6, vx: (sh.rng.next() - 0.5) * 0.8, vy: (0.6 + sh.rng.next() * 0.8) * diff.speed, rot: sh.rng.next() * 6.28, vr: (sh.rng.next() - 0.5) * 0.04, pts: Array.from({ length: 8 }, () => 0.7 + sh.rng.next() * 0.5), ore: sh.rng.next() < 0.25 }; }

  function update(sh) {
    tick = sh.tick;
    if (msgTtl > 0) msgTtl--; if (shake > 0) shake--; if (fireCool > 0) fireCool--; if (shield > 0) shield--; if (rapid > 0) rapid--;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; }
    popups = popups.filter(p => (p.ttl -= 1) > 0);
    const scroll = diff.speed; dist += scroll / 10; g.level = 1 + Math.floor(dist / 300);
    for (const s of stars) { s[1] += scroll * s[2] * 0.6; if (s[1] > H) { s[1] = -2; s[0] = sh.rng.next() * W; } }
    if (sh.rng.next() < diff.density + g.level * 0.004) rocks.push(mkRock(sh));
    if (ship) {
      let l = sh.input?.isDown?.("left"), r = sh.input?.isDown?.("right"), u = sh.input?.isDown?.("up"), d = sh.input?.isDown?.("down");
      if (g.autopilot) { // steer away from the nearest threat, drift to pickups, shoot what's ahead
        const threat = rocks.filter(k => k.y < ship.y && k.y > ship.y - 220).sort((a, b) => Math.abs(a.x - ship.x) - Math.abs(b.x - ship.x))[0];
        const pick = pickups.sort((a, b) => Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y))[0];
        if (threat && Math.abs(threat.x - ship.x) < threat.r + 30) { l = threat.x > ship.x; r = !l; if (Math.abs(threat.x - ship.x) < 12 && tick % 4 === 0) fire(sh); }
        else if (pick) { l = pick.x < ship.x - 6; r = pick.x > ship.x + 6; }
        if (rocks.some(k => Math.abs(k.x - ship.x) < k.r + 8 && k.y < ship.y) && tick % 6 === 0) fire(sh);
        if (ship.x < 30) r = true; if (ship.x > W - 30) l = true; d = ship.y < H - 90; u = ship.y > H - 70;
      }
      ship.vx += ((r ? 1 : 0) - (l ? 1 : 0)) * 0.5; ship.vy += ((d ? 1 : 0) - (u ? 1 : 0)) * 0.4;
      ship.vx *= 0.88; ship.vy *= 0.88; ship.x += ship.vx; ship.y += ship.vy;
      ship.x = Math.max(14, Math.min(W - 14, ship.x)); ship.y = Math.max(60, Math.min(H - 30, ship.y)); if (ship.inv > 0) ship.inv--;
      if (tick % 2 === 0) particles.push({ x: ship.x + (sh.rng.next() - 0.5) * 4, y: ship.y + 14, vx: (sh.rng.next() - 0.5) * 0.5, vy: 2 + sh.rng.next(), ttl: 12, color: T?.marquee });
    } else if (--respawn <= 0) { if (hulls <= 0) return sh.end(); ship = { x: W / 2, y: H - 80, vx: 0, vy: 0, inv: 150 }; }
    for (const b of bullets) b.y += b.vy; bullets = bullets.filter(b => b.y > -10);
    for (const k of rocks) { k.x += k.vx; k.y += k.vy + scroll * 0.4; k.rot += k.vr; }
    for (const p of pickups) p.y += scroll * 0.7;
    for (const b of bullets) for (const k of rocks) if (!k.dead && Math.hypot(b.x - k.x, b.y - k.y) < k.r) { b.y = -99; hitRock(k, sh); break; }
    if (ship && ship.inv <= 0) for (const k of rocks) if (!k.dead && Math.hypot(k.x - ship.x, k.y - ship.y) < k.r + 9) {
      if (shield > 0) { shield = 0; hitRock(k, sh); pop(ship.x, ship.y - 20, "shield gone", T?.cyan); } else { hulls--; burst(ship.x, ship.y, 40, T?.accent, sh); shake = 20; sh.audio.hit(); ship = null; respawn = 90; say(hulls > 0 ? `${hulls} ${hulls === 1 ? "hull" : "hulls"} left` : "Hull breached", 90); }
      break;
    }
    if (ship) for (const p of pickups) if (Math.hypot(p.x - ship.x, p.y - ship.y) < 16) {
      p.dead = true; sh.audio.eat();
      if (p.kind === "ore") { ore++; g.score += 50; sh.wallet?.earn(2); pop(p.x, p.y, "+50 · 2 cr", T?.marquee); }
      if (p.kind === "shield") { shield = 900; pop(p.x, p.y, "Shield", T?.cyan); }
      if (p.kind === "rapid") { rapid = 600; pop(p.x, p.y, "Rapid fire", T?.cyan); }
    }
    rocks = rocks.filter(k => !k.dead && k.y < H + 60); pickups = pickups.filter(p => !p.dead && p.y < H + 20);
    if (Math.floor(dist) % 300 === 0 && Math.floor(dist) > 0 && Math.floor(dist - scroll / 10) % 300 !== 0) { g.score += 200; sh.wallet?.earn(8); say(`${Math.floor(dist)} km · belt thickens`, 80); sh.audio.levelUp(); }
    if (tick % 30 === 0) g.score += 1;
  }
  function hitRock(k, sh) {
    k.dead = true; const pts = [0, 60, 40, 25][k.size]; g.score += pts; pop(k.x, k.y, "+" + pts, "#fff");
    burst(k.x, k.y, 6 * k.size, T?.textDim, sh); sh.audio.tone({ freq: 100 + k.size * 40, type: "sawtooth", dur: 0.15, slide: -40, vol: 0.1 });
    if (k.size > 1) for (let i = 0; i < 2; i++) rocks.push({ ...mkRock(sh), x: k.x + (i ? 8 : -8), y: k.y, size: k.size - 1, r: (k.size - 1) * 11 + 6, vx: (i ? 1 : -1) * (0.6 + sh.rng.next()), ore: false });
    if (k.ore) pickups.push({ x: k.x, y: k.y, kind: sh.rng.next() < 0.75 ? "ore" : sh.rng.next() < 0.5 ? "shield" : "rapid" });
  }
  function burst(x, y, n, color, sh) { for (let i = 0; i < n; i++) { const a = sh.rng.next() * 6.28, sp = 0.5 + sh.rng.next() * 3; particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ttl: 18 + sh.rng.int(25), color }); } }
  function hud() { return `${diff.name} · ${Math.floor(dist)} km · ${hulls} hulls · ${ore} ore${shield ? " · shield" : ""}${rapid ? " · rapid" : ""}`; }

  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    c.save(); if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.7, (Math.random() - 0.5) * shake * 0.7);
    const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, T.bg); bg.addColorStop(1, T.bgGlow1);
    c.fillStyle = bg; c.fillRect(-10, -10, W + 20, H + 20);
    c.fillStyle = "#fff"; for (const [x, y, s] of stars) { c.globalAlpha = 0.15 + s * 0.5; c.fillRect(x, y, s > 1 ? 2 : 1, s > 1 ? 4 : 2); } c.globalAlpha = 1;
    for (const k of rocks) {
      if (spr(c, pack, ["", "meteor_small", "meteor_med", "meteor_big"][k.size], k.x, k.y, { rot: k.rot })) { if (k.ore) { c.fillStyle = T.marquee; c.globalAlpha = 0.5 + 0.4 * Math.sin(tick / 6); c.beginPath(); c.arc(k.x, k.y, 3, 0, 7); c.fill(); c.globalAlpha = 1; } continue; }
      c.save(); c.translate(k.x, k.y); c.rotate(k.rot);
      c.beginPath(); k.pts.forEach((kk, i) => { const a = i / k.pts.length * 6.283; c.lineTo(Math.cos(a) * k.r * kk, Math.sin(a) * k.r * kk); }); c.closePath();
      const grd = c.createRadialGradient(-k.r * 0.3, -k.r * 0.3, 2, 0, 0, k.r); grd.addColorStop(0, shade(T.rock, 0.5)); grd.addColorStop(1, shade(T.rock, -0.45));
      c.fillStyle = grd; c.shadowColor = "#000"; c.shadowBlur = 8; c.fill(); c.shadowBlur = 0; c.strokeStyle = shade(T.rock, 0.25); c.lineWidth = 1.5; c.stroke();
      if (k.ore) { c.fillStyle = T.marquee; c.globalAlpha = 0.5 + 0.4 * Math.sin(tick / 6); c.beginPath(); c.moveTo(0, -5); c.lineTo(4, 0); c.lineTo(0, 5); c.lineTo(-4, 0); c.closePath(); c.fill(); c.globalAlpha = 1; }
      c.restore();
    }
    for (const p of pickups) { const col = p.kind === "ore" ? T.marquee : T.cyan; c.shadowColor = col; c.shadowBlur = 12; c.fillStyle = col; c.save(); c.translate(p.x, p.y); c.rotate(tick / 20); if (p.kind === "ore") { c.beginPath(); c.moveTo(0, -8); c.lineTo(6, 0); c.lineTo(0, 8); c.lineTo(-6, 0); c.closePath(); c.fill(); } else { c.beginPath(); c.arc(0, 0, 7, 0, 7); c.fill(); c.fillStyle = "#000"; c.font = "800 9px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.rotate(-tick / 20); c.fillText(p.kind === "shield" ? "S" : "R", 0, 1); } c.restore(); c.shadowBlur = 0; }
    for (const b of bullets) { if (spr(c, pack, "laser", b.x, b.y, { rot: -Math.PI / 2 })) continue; c.shadowColor = T.cyan; c.shadowBlur = 8; c.fillStyle = "#fff"; c.fillRect(b.x - 1.5, b.y - 6, 3, 10); c.shadowBlur = 0; }
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 10); c.fillStyle = p.color || "#fff"; c.fillRect(p.x, p.y, 2, 2); } c.globalAlpha = 1;
    if (ship && pack?.sprites?.ship) { if (shield > 0 || ship.inv > 0) { c.globalAlpha = (shield > 0 ? 0.3 : 0.15) + 0.1 * Math.sin(tick / 4); c.fillStyle = T.cyan; c.beginPath(); c.arc(ship.x, ship.y, 22, 0, 7); c.fill(); c.globalAlpha = 1; } spr(c, pack, "flame", ship.x, ship.y + 16, { rot: Math.PI / 2 }); spr(c, pack, "ship", ship.x, ship.y, { rot: -Math.PI / 2 + ship.vx * 0.08 }); }
    else if (ship) {
      c.save(); c.translate(ship.x, ship.y); c.rotate(ship.vx * 0.08);
      if (shield > 0 || ship.inv > 0) { c.globalAlpha = (shield > 0 ? 0.3 : 0.15) + 0.1 * Math.sin(tick / 4); c.fillStyle = T.cyan; c.beginPath(); c.arc(0, 0, 22, 0, 7); c.fill(); c.globalAlpha = 1; }
      const grd = c.createLinearGradient(-12, 0, 12, 0); grd.addColorStop(0, shade(T.cyan, -0.3)); grd.addColorStop(0.5, shade(T.cyan, 0.5)); grd.addColorStop(1, shade(T.cyan, -0.3));
      c.fillStyle = grd; c.shadowColor = T.cyan; c.shadowBlur = 12; c.beginPath(); c.moveTo(0, -16); c.lineTo(12, 10); c.lineTo(5, 6); c.lineTo(0, 12); c.lineTo(-5, 6); c.lineTo(-12, 10); c.closePath(); c.fill(); c.shadowBlur = 0;
      c.fillStyle = "#fff"; c.beginPath(); c.arc(0, -4, 2.5, 0, 7); c.fill();
      c.restore();
    }
    c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(0, 0, W, 30);
    c.fillStyle = "#fff"; c.font = "700 13px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(`${Math.floor(dist)} km`, 12, 15);
    c.fillStyle = T.marquee; c.fillText(`◆ ${ore}`, 90, 15);
    c.fillStyle = T.cyan; for (let i = 0; i < hulls; i++) { c.beginPath(); c.moveTo(W - 14 - i * 16, 8); c.lineTo(W - 8 - i * 16, 22); c.lineTo(W - 20 - i * 16, 22); c.closePath(); c.fill(); }
    for (const p of popups) { const k = 1 - p.ttl / 50; c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color || "#fff"; c.font = "800 12px system-ui,sans-serif"; c.textAlign = "center"; c.shadowColor = "#000"; c.shadowBlur = 5; c.fillText(p.text, p.x, p.y - k * 18); c.shadowBlur = 0; } c.globalAlpha = 1;
    if (msgTtl > 0 && msg) { c.font = "800 20px 'Chakra Petch',system-ui,sans-serif"; c.textAlign = "center"; c.fillStyle = T.marquee; c.shadowColor = "#000"; c.shadowBlur = 10; c.globalAlpha = Math.min(1, msgTtl / 20); c.fillText(msg, W / 2, 70); c.shadowBlur = 0; c.globalAlpha = 1; }
    c.restore();
  }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
