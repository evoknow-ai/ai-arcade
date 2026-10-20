// Brick Break — paddle, ball, and a wall full of magic. Move with the mouse/touch or ←/→; Space or a
// click launches (and fires lasers when you have them). Bricks come in flavours: glass (one hit),
// armoured (crack through 2–3 hits), star bricks that drop power-ups, explosive bricks that take out
// their neighbours, steel bricks that only fire or explosions remove, and sliders that move. Levels
// drop in with an animation; the background drifts, shards fly, the ball leaves a comet trail.
import { loadPack, draw as spr } from "../../shell/sprites.js";
const W = 560, H = 440, PW0 = 90, PH = 12, BR = 6, COLS = 12, BW = 42, BH = 16, OX = (W - COLS * BW) / 2;
const DIFFICULTY = {
  beginner:     { name: "Beginner",     speed: 3.6, lives: 5, paddle: 1.3, bad: 0.05 },
  intermediate: { name: "Intermediate", speed: 4.4, lives: 3, paddle: 1.0, bad: 0.12 },
  advanced:     { name: "Advanced",     speed: 5.2, lives: 2, paddle: 0.85, bad: 0.2 },
};
const POWERS = {
  wide: { name: "Wide paddle", tag: "WIDE", good: true }, multi: { name: "Multiball", tag: "×3", good: true }, slow: { name: "Slow ball", tag: "SLOW", good: true },
  sticky: { name: "Sticky", tag: "GLUE", good: true }, life: { name: "+1 life", tag: "+1", good: true }, laser: { name: "Lasers", tag: "LASER", good: true },
  fire: { name: "Fireball", tag: "FIRE", good: true }, x2: { name: "Double points", tag: "×2", good: true },
  shrink: { name: "Narrow paddle", tag: "TINY", good: false }, fast: { name: "Fast ball", tag: "FAST", good: false },
};
const GOOD = Object.keys(POWERS).filter(k => POWERS[k].good), BAD = Object.keys(POWERS).filter(k => !POWERS[k].good);
const ROW_HUES = [340, 25, 48, 95, 165, 195, 225, 270, 300];

export default function createBreakout({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0, pack = null; loadPack("breakout").then(p => { pack = p; });
  const g = { id: "breakout", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, onHover, onPointer, hud };
  let paddle, balls, bricks, drops, lasers, lives, particles, shards, rings, popups, msg, msgTtl, shake, wideT, slowT, fastT, sticky, laserT, fireT, x2T, combo, flash, stars, bands, intro;

  function init(sh) { g.score = 0; g.level = 1; lives = diff.lives; particles = []; shards = []; rings = []; popups = []; shake = 0; combo = 0; flash = 0; stars = Array.from({ length: 70 }, () => ({ x: sh.rng.next() * W, y: sh.rng.next() * H, z: 0.3 + sh.rng.next() * 0.7, p: sh.rng.next() * 6.28 })); bands = Array.from({ length: 4 }, (_, i) => ({ y: 80 + i * 90, amp: 20 + sh.rng.next() * 30, f: 0.006 + sh.rng.next() * 0.006, ph: sh.rng.next() * 6.28, hue: i })); buildLevel(sh); }
  function buildLevel(sh) {
    bricks = []; drops = []; lasers = []; wideT = 0; slowT = 0; fastT = 0; sticky = false; laserT = 0; fireT = 0; x2T = 0; intro = 70;
    const L = g.level, rows = Math.min(9, 4 + L), pattern = (L - 1) % 5;
    for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) {
      const cx = c - COLS / 2 + 0.5;
      const keep = pattern === 0 ? true : pattern === 1 ? (r + c) % 2 === 0 || r < 2 : pattern === 2 ? Math.abs(cx) > r / 2 - 1 : pattern === 3 ? Math.abs(cx) + Math.abs(r - rows / 2) < rows / 2 + 2 : (c % 3 !== 1 || r % 2 === 0);
      if (!keep) continue;
      let kind = "glass", hp = 1;
      const roll = sh.rng.next();
      if (r < 2 && L > 2 && roll < 0.6) { kind = "armour"; hp = 3; } else if (r < 4 && L > 1 && roll < 0.45) { kind = "armour"; hp = 2; }
      if (sh.rng.next() < 0.14) { kind = "star"; hp = 1; }
      else if (L > 1 && sh.rng.next() < 0.05 + L * 0.01) { kind = "boom"; hp = 1; }
      else if (L > 2 && sh.rng.next() < 0.03 + L * 0.005) { kind = "steel"; hp = Infinity; }
      else if (L > 3 && r > 2 && sh.rng.next() < 0.06) { kind = "slider"; hp = 1; }
      bricks.push({ x: OX + c * BW, y: 50 + r * (BH + 4), x0: OX + c * BW, hp, max: hp, kind, r, c, delay: (r * 3 + c) * 2, hit: 0, vx: kind === "slider" ? (sh.rng.next() < 0.5 ? -0.5 : 0.5) : 0 });
    }
    paddle = { x: W / 2, w: PW0 * diff.paddle };
    resetBall(); say(`Level ${g.level}`, 100);
  }
  function resetBall() { balls = [{ x: paddle.x, y: H - 40, vx: 0, vy: 0, stuck: true, trail: [] }]; }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x, y, text, color, ttl: 50 }); }

  function onHover(px) { if (px >= 0 && !g.autopilot) paddle.x = Math.max(paddle.w / 2, Math.min(W - paddle.w / 2, px)); }
  function onPointer(px, py, sh) { sh.record(1000 + Math.round(px)); act(sh); }
  function onInput(action, sh) { if (action === "action") act(sh); }
  function act(sh) { if (balls.some(b => b.stuck)) launch(sh); else if (laserT > 0 && lasers.filter(l => l.mine).length < 4) { lasers.push({ x: paddle.x - paddle.w / 2 + 8, y: H - 32, mine: true }, { x: paddle.x + paddle.w / 2 - 8, y: H - 32, mine: true }); sh.audio.tone({ freq: 900, type: "square", dur: 0.05, slide: -400, vol: 0.06 }); } }
  function launch(sh) { for (const b of balls) if (b.stuck) { b.stuck = false; b.vx = (sh.rng.next() - 0.5) * 3; b.vy = -diff.speed; sh.audio.blip(); } }

  function update(sh) {
    tick = sh.tick;
    if (msgTtl > 0) msgTtl--; if (shake > 0) shake--; if (flash > 0) flash--; if (intro > 0) intro--;
    if (wideT > 0 && --wideT === 0) paddle.w = PW0 * diff.paddle; if (slowT > 0) slowT--; if (fastT > 0) fastT--; if (laserT > 0) laserT--; if (fireT > 0) fireT--; if (x2T > 0) x2T--;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.12; }
    shards = shards.filter(p => (p.ttl -= 1) > 0); for (const p of shards) { p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.rot += p.vr; }
    rings = rings.filter(r => (r.t += 1) < 24); popups = popups.filter(p => (p.ttl -= 1) > 0);
    for (const br of bricks) { if (br.hit > 0) br.hit--; if (br.kind === "slider" && br.hp > 0 && intro === 0) { br.x += br.vx; if (br.x < OX || br.x > OX + (COLS - 1) * BW) br.vx *= -1; } }
    if (intro > 0) return;
    const spd = 4; if (sh.input?.isDown?.("left")) paddle.x -= spd * 1.6; if (sh.input?.isDown?.("right")) paddle.x += spd * 1.6;
    if (g.autopilot) { const b = balls.filter(b => !b.stuck).sort((a, b) => b.y - a.y)[0] || balls[0]; const d = drops.sort((a, b) => b.y - a.y)[0]; const target = d && POWERS[d.kind].good && d.y > H - 160 && (!b || b.vy < 0 || b.y < H - 200) ? d.x : b.x + (b.vx || 0) * 6 + Math.sin(tick / 90) * paddle.w * 0.35; paddle.x += (target - paddle.x) * 0.2; if (balls.some(b => b.stuck) && tick % 60 === 0) launch(sh); if (laserT > 0 && tick % 30 === 0) act(sh); }
    paddle.x = Math.max(paddle.w / 2, Math.min(W - paddle.w / 2, paddle.x));
    for (const b of balls) {
      if (b.stuck) { b.x = paddle.x + (b.off || 0); b.y = H - 40; continue; }
      const k = (slowT > 0 ? 0.6 : 1) * (fastT > 0 ? 1.4 : 1);
      b.x += b.vx * k; b.y += b.vy * k;
      if (tick % 2 === 0) { b.trail.push([b.x, b.y]); if (b.trail.length > 10) b.trail.shift(); }
      if (b.x < BR) { b.x = BR; b.vx = Math.abs(b.vx); } if (b.x > W - BR) { b.x = W - BR; b.vx = -Math.abs(b.vx); }
      if (b.y < 36 + BR) { b.y = 36 + BR; b.vy = Math.abs(b.vy); }
      if (b.vy > 0 && b.y + BR >= H - 30 && b.y - BR <= H - 30 + PH && Math.abs(b.x - paddle.x) <= paddle.w / 2 + BR) {
        const rel = (b.x - paddle.x) / (paddle.w / 2); const ang = rel * 1.1; const sp = Math.hypot(b.vx, b.vy);
        b.vx = Math.sin(ang) * sp; b.vy = -Math.cos(ang) * sp; if (Math.abs(b.vx) < 1) b.vx = (b.vx < 0 || (b.vx === 0 && sh.rng.next() < 0.5) ? -1 : 1) * (1 + sh.rng.next()); b.y = H - 30 - BR; combo = 0; sh.audio.blip();
        rings.push({ x: b.x, y: H - 30, t: 0, color: T?.cyan });
        if (sticky) { b.stuck = true; b.off = b.x - paddle.x; }
      }
      for (const br of bricks) {
        if (br.hp <= 0) continue;
        if (b.x + BR > br.x && b.x - BR < br.x + BW && b.y + BR > br.y && b.y - BR < br.y + BH) {
          const ox = Math.min(b.x + BR - br.x, br.x + BW - (b.x - BR)), oy = Math.min(b.y + BR - br.y, br.y + BH - (b.y - BR));
          if (!(fireT > 0 && br.kind !== "steel")) { if (ox < oy) b.vx *= -1; else b.vy *= -1; }
          hitBrick(br, sh, fireT > 0 ? 99 : 1, b.x, b.y);
          break;
        }
      }
      if (b.y > H + 10) b.dead = true;
    }
    balls = balls.filter(b => !b.dead);
    if (!balls.length) { lives--; shake = 14; flash = 6; sh.audio.hit(); if (lives <= 0) { say("Game over", 60); return sh.end(); } say(`${lives} ${lives === 1 ? "life" : "lives"} left`, 80); paddle.w = PW0 * diff.paddle; sticky = false; laserT = 0; fireT = 0; resetBall(); }
    for (const l of lasers) { l.y -= 9; for (const br of bricks) if (br.hp > 0 && l.x > br.x && l.x < br.x + BW && l.y > br.y && l.y < br.y + BH) { l.dead = true; hitBrick(br, sh, br.kind === "steel" ? 99 : 1, l.x, l.y); break; } if (l.y < 30) l.dead = true; }
    lasers = lasers.filter(l => !l.dead);
    for (const d of drops) {
      d.y += 1.7; d.rot += 0.05;
      if (d.y > H - 34 && d.y < H - 30 + PH + 8 && Math.abs(d.x - paddle.x) < paddle.w / 2 + 10) { d.dead = true; applyPower(d.kind, sh); }
      if (d.y > H + 10) d.dead = true;
    }
    drops = drops.filter(d => !d.dead);
    if (!bricks.some(b => b.hp > 0 && b.kind !== "steel")) { g.score += 500 + lives * 100; sh.wallet?.earn(10 + g.level * 3); pop(W / 2, H / 2, `Level ${g.level} clear! +${500 + lives * 100}`, T?.marquee); g.level++; sh.audio.levelUp(); buildLevel(sh); }
  }
  function hitBrick(br, sh, dmg, hx, hy) {
    if (br.kind === "steel" && dmg < 99) { br.hit = 10; sh.audio.tone({ freq: 220, type: "triangle", dur: 0.06, vol: 0.08 }); rings.push({ x: hx, y: hy, t: 0, color: "#ccc" }); return; }
    br.hp -= dmg; br.hit = 10; combo++;
    const mult = (1 + Math.min(5, combo - 1) * 0.5) * (x2T > 0 ? 2 : 1);
    const pts = ((br.kind === "steel" ? 50 : 10 * br.max + 5 * br.r) * mult) | 0; g.score += pts; pop(br.x + BW / 2, br.y, "+" + pts, x2T > 0 ? T?.marquee : "#fff");
    rings.push({ x: hx, y: hy, t: 0, color: brickColor(br) });
    if (br.hp <= 0) {
      shatter(br, sh); sh.audio.eat();
      if (br.kind === "star") drops.push({ x: br.x + BW / 2, y: br.y, kind: sh.rng.next() < diff.bad ? BAD[sh.rng.int(BAD.length)] : GOOD[sh.rng.int(GOOD.length)], rot: 0 });
      if (br.kind === "boom") { flash = 8; shake = 12; sh.audio.hit(); rings.push({ x: br.x + BW / 2, y: br.y + BH / 2, t: 0, color: "#FFB454", big: true }); for (const o of bricks) if (o !== br && o.hp > 0 && Math.abs(o.x - br.x) <= BW + 2 && Math.abs(o.y - br.y) <= BH + 6) hitBrick(o, sh, 99, o.x + BW / 2, o.y + BH / 2); }
    } else sh.audio.tone({ freq: 300 + br.hp * 60, type: "square", dur: 0.05, vol: 0.08 });
  }
  function applyPower(kind, sh) {
    const p = POWERS[kind]; pop(paddle.x, H - 50, p.name, p.good ? T?.cyan : T?.accent); sh.audio[p.good ? "levelUp" : "hit"]();
    if (kind === "wide") { paddle.w = PW0 * diff.paddle * 1.6; wideT = 900; }
    if (kind === "shrink") { paddle.w = PW0 * diff.paddle * 0.6; wideT = 600; }
    if (kind === "slow") { slowT = 600; fastT = 0; } if (kind === "fast") { fastT = 500; slowT = 0; }
    if (kind === "sticky") sticky = true; if (kind === "life") lives++; if (kind === "laser") laserT = 720; if (kind === "fire") fireT = 480; if (kind === "x2") x2T = 900;
    if (kind === "multi") { const src = balls.find(b => !b.stuck) || balls[0]; for (let i = 0; i < 2; i++) { const a = (i ? 0.5 : -0.5); balls.push({ x: src.x, y: src.y, vx: src.vx * Math.cos(a) - src.vy * Math.sin(a) || 2, vy: src.vx * Math.sin(a) + src.vy * Math.cos(a) || -diff.speed, stuck: false, trail: [] }); } }
  }
  function shatter(br, sh) { const col = brickColor(br); for (let i = 0; i < 8; i++) shards.push({ x: br.x + sh.rng.next() * BW, y: br.y + sh.rng.next() * BH, vx: (sh.rng.next() - 0.5) * 5, vy: -1 - sh.rng.next() * 3, w: 4 + sh.rng.next() * 8, h: 3 + sh.rng.next() * 4, rot: sh.rng.next() * 6.28, vr: (sh.rng.next() - 0.5) * 0.3, ttl: 30 + sh.rng.int(25), color: col }); for (let i = 0; i < 6; i++) { const a = sh.rng.next() * 6.28, sp = 1 + sh.rng.next() * 2; particles.push({ x: br.x + BW / 2, y: br.y + BH / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, ttl: 20 + sh.rng.int(20), color: col }); } }
  function brickColor(br) { if (br.kind === "steel") return "#9AA3B2"; if (br.kind === "boom") return "#FF7A3D"; if (br.kind === "star") return T?.marquee || "#FFCF4A"; if (br.kind === "slider") return "#B57BFF"; if (br.kind === "armour") return br.max === 3 ? "#6FB7FF" : "#8ED3FF"; return `hsl(${ROW_HUES[br.r % ROW_HUES.length]} 85% 62%)`; }
  function hud() { const fx = [wideT && "wide", slowT && "slow", fastT && "fast", sticky && "sticky", laserT && "lasers", fireT && "fireball", x2T && "×2"].filter(Boolean).join(" · "); return `${diff.name} · level ${g.level} · ${lives} lives · ${bricks.filter(b => b.hp > 0 && b.kind !== "steel").length} bricks${fx ? " · " + fx : ""}`; }

  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    c.save(); if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.6, (Math.random() - 0.5) * shake * 0.6);
    // animated backdrop: drifting aurora bands, parallax stars, slow hex grid
    const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, T.bg); bg.addColorStop(1, shade(T.bgGlow1, -0.3)); c.fillStyle = bg; c.fillRect(-10, -10, W + 20, H + 20);
    for (const b of bands) { const col = [T.cyan, T.accent, T.marquee, "#B57BFF"][b.hue]; c.globalAlpha = 0.05; c.fillStyle = col; c.beginPath(); c.moveTo(0, H); for (let x = 0; x <= W; x += 10) c.lineTo(x, b.y + Math.sin(x * b.f + tick / 120 + b.ph) * b.amp + Math.sin(tick / 200 + b.ph) * 20); c.lineTo(W, H); c.fill(); } c.globalAlpha = 1;
    c.strokeStyle = "#ffffff07"; c.lineWidth = 1; const gs = 28, off = (tick * 0.15) % gs; for (let x = -gs; x < W + gs; x += gs) { c.beginPath(); c.moveTo(x + off, 0); c.lineTo(x + off - 20, H); c.stroke(); } for (let y = -gs; y < H + gs; y += gs) { c.beginPath(); c.moveTo(0, y + off); c.lineTo(W, y + off); c.stroke(); }
    for (const s of stars) { s.y += s.z * 0.15; if (s.y > H) s.y = 0; c.globalAlpha = (0.2 + 0.6 * Math.abs(Math.sin(tick / 50 + s.p))) * s.z; c.fillStyle = "#fff"; c.fillRect(s.x, s.y, s.z > 0.8 ? 2 : 1, s.z > 0.8 ? 2 : 1); } c.globalAlpha = 1;
    c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(0, 0, W, 36);
    c.fillStyle = "#fff"; c.font = "700 14px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(`Level ${g.level}`, 14, 18);
    c.fillStyle = T.accent; for (let i = 0; i < lives; i++) { c.beginPath(); c.arc(W - 16 - i * 16, 18, 5, 0, 7); c.fill(); }
    for (const br of bricks) { if (br.hp > 0) drawBrick(c, br); }
    for (const p of shards) { c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); c.restore(); } c.globalAlpha = 1;
    for (const r of rings) { const k = r.t / 24; c.globalAlpha = (1 - k) * 0.8; c.strokeStyle = r.color || "#fff"; c.lineWidth = r.big ? 3 : 1.5; c.beginPath(); c.arc(r.x, r.y, k * (r.big ? 80 : 26), 0, 7); c.stroke(); } c.globalAlpha = 1;
    for (const d of drops) { const p = POWERS[d.kind], col = p.good ? T.marquee : T.accent; c.save(); c.translate(d.x, d.y); c.rotate(Math.sin(d.rot) * 0.2); c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 14; rr(c, -16, -8, 32, 16, 8); c.fill(); c.shadowBlur = 0; c.fillStyle = "#000"; c.font = "800 9px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(p.tag, 0, 1); c.restore(); }
    for (const l of lasers) { c.shadowColor = T.accent; c.shadowBlur = 10; c.fillStyle = T.accent; c.fillRect(l.x - 1.5, l.y - 8, 3, 12); c.shadowBlur = 0; }
    // paddle
    const px = paddle.x - paddle.w / 2, py = H - 30, pc = sticky ? T.marquee : laserT > 0 ? T.accent : T.cyan;
    if (pack?.sprites?.paddle) { const s = pack.sprites.paddle; c.save(); c.translate(paddle.x, py + PH / 2); c.scale(paddle.w / (s.w * pack.scale), 1); c.drawImage(s.img, -s.w / 2 * pack.scale, -s.h / 2 * pack.scale, s.w * pack.scale, s.h * pack.scale); c.restore(); }
    else {
    c.fillStyle = "#00000066"; rr(c, px + 2, py + 4, paddle.w, PH, 6); c.fill();
    const pg = c.createLinearGradient(0, py, 0, py + PH); pg.addColorStop(0, shade(pc, 0.45)); pg.addColorStop(1, shade(pc, -0.4));
    c.fillStyle = pg; c.shadowColor = pc; c.shadowBlur = 14 + 4 * Math.sin(tick / 8); rr(c, px, py, paddle.w, PH, 6); c.fill(); c.shadowBlur = 0;
    c.fillStyle = "#ffffff55"; rr(c, px + 6, py + 2, paddle.w - 12, 3, 2); c.fill();
    }
    if (laserT > 0) { c.fillStyle = T.accent; c.fillRect(px + 5, py - 5, 6, 6); c.fillRect(px + paddle.w - 11, py - 5, 6, 6); }
    for (const b of balls) {
      const col = fireT > 0 ? "#FF7A3D" : T.cyan;
      b.trail.forEach(([x, y], i) => { c.globalAlpha = (i + 1) / b.trail.length * 0.5; c.fillStyle = col; c.beginPath(); c.arc(x, y, BR * (i + 1) / b.trail.length, 0, 7); c.fill(); }); c.globalAlpha = 1;
      if (spr(c, pack, fireT > 0 ? "ball_fire" : "ball", b.x, b.y)) continue;
      c.shadowColor = col; c.shadowBlur = 16; const bgd = c.createRadialGradient(b.x - 2, b.y - 2, 1, b.x, b.y, BR); bgd.addColorStop(0, "#fff"); bgd.addColorStop(1, col); c.fillStyle = bgd; c.beginPath(); c.arc(b.x, b.y, BR, 0, 7); c.fill(); c.shadowBlur = 0;
    }
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 15); c.fillStyle = p.color; c.fillRect(p.x, p.y, 3, 3); } c.globalAlpha = 1;
    for (const p of popups) { const k = 1 - p.ttl / 50; c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color || "#fff"; c.font = "800 13px system-ui,sans-serif"; c.textAlign = "center"; c.shadowColor = "#000"; c.shadowBlur = 5; c.fillText(p.text, p.x, p.y - k * 20); c.shadowBlur = 0; } c.globalAlpha = 1;
    if (flash > 0) { c.fillStyle = `rgba(255,255,255,${flash / 24})`; c.fillRect(-10, -10, W + 20, H + 20); }
    if (balls.some(b => b.stuck) && !g.autopilot && intro === 0) { c.fillStyle = "#fff"; c.globalAlpha = 0.6 + 0.3 * Math.sin(tick / 10); c.font = "13px system-ui,sans-serif"; c.textAlign = "center"; c.fillText(laserT > 0 ? "Space or click to launch · fire lasers" : "Space or click to launch", W / 2, H - 60); c.globalAlpha = 1; }
    if (msgTtl > 0 && msg) { c.font = "800 24px 'Chakra Petch',system-ui,sans-serif"; c.textAlign = "center"; c.fillStyle = T.marquee; c.shadowColor = "#000"; c.shadowBlur = 10; c.globalAlpha = Math.min(1, msgTtl / 20); c.fillText(msg, W / 2, H / 2); c.shadowBlur = 0; c.globalAlpha = 1; }
    c.restore();
  }
  function drawBrick(c, br) {
    const col = brickColor(br);
    if (pack?.sprites?.["brick_" + br.kind] || pack?.sprites?.brick_glass) { const dropK = intro > 0 ? Math.max(0, Math.min(1, (70 - intro - br.delay / 2) / 14)) : 1; if (dropK <= 0) return; const ease = 1 - Math.pow(1 - dropK, 3), y = br.y - (1 - ease) * 120; c.globalAlpha = ease; spr(c, pack, pack.sprites["brick_" + br.kind] ? "brick_" + br.kind : "brick_glass", br.x + BW / 2, y + BH / 2, { scale: 1 + br.hit / 10 * 0.12 }); if (br.kind === "armour" && br.hp < br.max) { c.globalAlpha = 0.5; spr(c, pack, "crack", br.x + BW / 2, y + BH / 2); } c.globalAlpha = 1; return; }
    // level intro: bricks drop into place with a stagger
    const dropK = intro > 0 ? Math.max(0, Math.min(1, (70 - intro - br.delay / 2) / 14)) : 1;
    if (dropK <= 0) return;
    const ease = 1 - Math.pow(1 - dropK, 3), y = br.y - (1 - ease) * 120, hitK = br.hit / 10;
    c.save(); c.translate(br.x + BW / 2, y + BH / 2); c.scale(1 + hitK * 0.12, 1 + hitK * 0.12); c.translate(-(br.x + BW / 2), -(y + BH / 2)); c.globalAlpha = ease;
    c.fillStyle = "#00000055"; rr(c, br.x + 2, y + 3, BW - 3, BH - 2, 4); c.fill();
    if (br.kind === "steel") { const grd = c.createLinearGradient(br.x, y, br.x, y + BH); grd.addColorStop(0, "#C9CFD9"); grd.addColorStop(0.5, "#7C8594"); grd.addColorStop(1, "#4B5260"); c.fillStyle = grd; rr(c, br.x + 1, y + 1, BW - 3, BH - 2, 3); c.fill(); c.fillStyle = "#2c313b"; for (const [dx, dy] of [[5, 4], [BW - 8, 4], [5, BH - 6], [BW - 8, BH - 6]]) { c.beginPath(); c.arc(br.x + dx, y + dy, 1.4, 0, 7); c.fill(); } }
    else {
      const grd = c.createLinearGradient(br.x, y, br.x, y + BH); grd.addColorStop(0, shade(col, 0.4)); grd.addColorStop(0.5, col); grd.addColorStop(1, shade(col, -0.35));
      c.fillStyle = grd; c.shadowColor = col; c.shadowBlur = br.kind === "star" ? 10 + 6 * Math.sin(tick / 6) : 0; rr(c, br.x + 1, y + 1, BW - 3, BH - 2, 4); c.fill(); c.shadowBlur = 0;
      c.fillStyle = "#ffffff55"; rr(c, br.x + 4, y + 2, BW - 9, 3, 2); c.fill(); // glass highlight
      if (br.kind === "armour") { c.strokeStyle = "#ffffff44"; c.lineWidth = 1; c.strokeRect(br.x + 3.5, y + 3.5, BW - 8, BH - 7); if (br.hp < br.max) { c.strokeStyle = "#00000088"; c.lineWidth = 1.2; c.beginPath(); c.moveTo(br.x + 8, y + 2); c.lineTo(br.x + 16, y + 9); c.lineTo(br.x + 12, y + BH - 2); if (br.hp < br.max - 1) { c.moveTo(br.x + 26, y + 1); c.lineTo(br.x + 22, y + 8); c.lineTo(br.x + 30, y + BH - 1); } c.stroke(); } }
      if (br.kind === "star") { c.fillStyle = "#fff"; c.save(); c.translate(br.x + BW / 2, y + BH / 2); c.rotate(Math.sin(tick / 10) * 0.3); star(c, 0, 0, 5.5, 2.5); c.fill(); c.restore(); }
      if (br.kind === "boom") { c.fillStyle = "#2b1200"; c.beginPath(); c.arc(br.x + BW / 2, y + BH / 2, 5, 0, 7); c.fill(); c.strokeStyle = "#FFF2A8"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(br.x + BW / 2 + 3, y + BH / 2 - 4); c.lineTo(br.x + BW / 2 + 7, y + BH / 2 - 8); c.stroke(); c.fillStyle = "#FFF2A8"; c.globalAlpha *= 0.6 + 0.4 * Math.sin(tick / 3); c.beginPath(); c.arc(br.x + BW / 2 + 7, y + BH / 2 - 8, 2, 0, 7); c.fill(); }
      if (br.kind === "slider") { c.fillStyle = "#ffffffaa"; c.beginPath(); c.moveTo(br.x + 6, y + BH / 2); c.lineTo(br.x + 11, y + BH / 2 - 4); c.lineTo(br.x + 11, y + BH / 2 + 4); c.closePath(); c.fill(); c.beginPath(); c.moveTo(br.x + BW - 7, y + BH / 2); c.lineTo(br.x + BW - 12, y + BH / 2 - 4); c.lineTo(br.x + BW - 12, y + BH / 2 + 4); c.closePath(); c.fill(); }
    }
    if (hitK > 0) { c.fillStyle = `rgba(255,255,255,${hitK * 0.5})`; rr(c, br.x + 1, y + 1, BW - 3, BH - 2, 4); c.fill(); }
    c.restore();
  }
  function star(c, cx, cy, r1, r2) { c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? r2 : r1, a = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } c.closePath(); }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
