// Invaders — five rows of aliens march and drop bombs, four bunkers crumble pixel by pixel, a mystery
// saucer crosses the top. ←/→ move, Space fires (one shot in the air at a time, like the original).
// The formation speeds up as it thins. Background: parallax starfield, drifting nebulae, a slow
// planet, warp streaks on wave change, shockwaves and bloom on every kill.
const W = 560, H = 480, COLS = 11, ROWS = 5, AW = 28, AH = 20, GAPX = 14, GAPY = 16;
const DIFFICULTY = {
  beginner:     { name: "Beginner",     bombRate: 0.008, speed: 0.8, lives: 4 },
  intermediate: { name: "Intermediate", bombRate: 0.014, speed: 1.0, lives: 3 },
  advanced:     { name: "Advanced",     bombRate: 0.022, speed: 1.3, lives: 2 },
};
// alien sprites, two animation frames each (8 wide bitmaps)
const SPR = {
  squid: [["00111100", "01111110", "11011011", "11111111", "00100100", "01011010", "10100101"], ["00111100", "01111110", "11011011", "11111111", "01011010", "10000001", "01000010"]],
  crab:  [["00100100", "10111101", "11111111", "11011011", "11111111", "01100110", "10000001"], ["00100100", "00111100", "01111110", "11011011", "11111111", "00100100", "01000010"]],
  octo:  [["00011000", "01111110", "11111111", "11100111", "11111111", "00100100", "01000010"], ["00011000", "01111110", "11111111", "11100111", "11111111", "01011010", "10000001"]],
};
const ROW_KIND = ["squid", "crab", "crab", "octo", "octo"], ROW_PTS = [30, 20, 20, 10, 10];

export default function createInvaders({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0;
  const g = { id: "invaders", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, hud };
  let aliens, dir, stepT, stepEvery, frame, player, shot, bombs, bunkers, ufo, lives, wave, particles, rings, popups, stars, nebulae, warp, flash, msg, msgTtl, shake, respawn, between, ufoT;

  function init(sh) {
    g.score = 0; g.level = 1; wave = 0; lives = diff.lives; particles = []; rings = []; popups = []; shake = 0; flash = 0; warp = 0; respawn = 0; between = 0;
    stars = Array.from({ length: 160 }, () => ({ x: sh.rng.next() * W, y: sh.rng.next() * H, z: 0.2 + sh.rng.next() * 0.8, tw: sh.rng.next() * 6.28 }));
    nebulae = Array.from({ length: 4 }, (_, i) => ({ x: sh.rng.next() * W, y: sh.rng.next() * H * 0.7, r: 120 + sh.rng.int(120), hue: i, drift: (sh.rng.next() - 0.5) * 0.08 }));
    player = { x: W / 2, inv: 0 }; shot = null; bombs = []; ufo = null; ufoT = 600 + sh.rng.int(600);
    newWave(sh);
  }
  function newWave(sh) {
    wave++; g.level = wave;
    aliens = []; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) aliens.push({ c, r, x: 50 + c * (AW + GAPX), y: 70 + Math.min(wave - 1, 4) * 14 + r * (AH + GAPY), kind: ROW_KIND[r], pts: ROW_PTS[r] });
    dir = 1; stepT = 0; frame = 0; bombs = []; shot = null; warp = 70;
    bunkers = [0, 1, 2, 3].map(i => mkBunker(110 + i * 115, H - 120));
    say(`Wave ${wave}`, 100);
  }
  function mkBunker(x, y) { // 22x16 pixel bunker, 3px pixels, with the classic arch
    const px = []; for (let yy = 0; yy < 16; yy++) for (let xx = 0; xx < 22; xx++) { if (yy < 3 && (xx < 3 - yy || xx > 18 + yy)) continue; if (yy > 11 && xx > 6 && xx < 15 && yy - 11 > Math.abs(xx - 10.5) - 1) continue; px.push(true); } return { x, y, w: 22, h: 16, px }; }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x, y, text, color, ttl: 50 }); }
  function onInput(action, sh) { if (action === "action") fire(sh); }
  function fire(sh) { if (shot || respawn > 0 || between > 0) return; shot = { x: player.x, y: H - 54, vy: -9 }; flash = 2; sh.audio.tone({ freq: 900, type: "square", dur: 0.06, slide: -500, vol: 0.07 }); }
  const alive = () => aliens.filter(a => !a.dead);

  function update(sh) {
    tick = sh.tick;
    if (msgTtl > 0) msgTtl--; if (shake > 0) shake--; if (flash > 0) flash--; if (warp > 0) warp--;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.03; }
    rings = rings.filter(r => (r.t += 1) < 30); popups = popups.filter(p => (p.ttl -= 1) > 0);
    for (const s of stars) s.y = (s.y + s.z * (0.25 + warp * 0.3)) % H;
    for (const n of nebulae) n.x = (n.x + n.drift + W) % W;
    if (between > 0) { if (--between === 0) newWave(sh); return; }
    if (respawn > 0) { if (--respawn === 0) { if (lives <= 0) return sh.end(); player = { x: W / 2, inv: 120 }; bombs = []; } return; }
    // player
    let l = sh.input?.isDown?.("left"), r = sh.input?.isDown?.("right");
    if (g.autopilot) {
      const danger = bombs.filter(b => b.y > H - 150 && Math.abs(b.x - player.x) < 26)[0];
      if (danger) { l = danger.x > player.x; r = !l; }
      else { const live = alive(); const tgt = live.sort((a, b) => b.y - a.y || Math.abs(a.x - player.x) - Math.abs(b.x - player.x))[0]; if (tgt) { const lead = tgt.x + AW / 2 + dir * 8; l = lead < player.x - 4; r = lead > player.x + 4; if (Math.abs(lead - player.x) < 10 && tick % 8 === 0) fire(sh); } }
    }
    if (l) player.x -= 4; if (r) player.x += 4; player.x = Math.max(22, Math.min(W - 22, player.x)); if (player.inv > 0) player.inv--;
    // formation march
    const n = alive().length; stepEvery = Math.max(3, Math.round((40 - (55 - n) * 0.65) / diff.speed));
    if (++stepT >= stepEvery) {
      stepT = 0; frame ^= 1;
      const live = alive(); const minX = Math.min(...live.map(a => a.x)), maxX = Math.max(...live.map(a => a.x + AW));
      if ((dir > 0 && maxX + 10 >= W - 10) || (dir < 0 && minX - 10 <= 10)) { dir *= -1; for (const a of live) a.y += 14; }
      else for (const a of live) a.x += dir * 10;
      sh.audio.tone({ freq: 90 + (frame ? 20 : 0) + (55 - n), type: "square", dur: 0.05, vol: 0.05 });
      if (live.some(a => a.y + AH >= H - 70)) { say("They've landed", 90); lives = 0; respawn = 60; return; }
    }
    // bombs: from the lowest alien in a random column
    if (sh.rng.next() < diff.bombRate + wave * 0.002) { const live = alive(); const cols = [...new Set(live.map(a => a.c))]; const c = cols[sh.rng.int(cols.length)]; const low = live.filter(a => a.c === c).sort((a, b) => b.y - a.y)[0]; if (low) bombs.push({ x: low.x + AW / 2, y: low.y + AH, vy: 2.4 + wave * 0.15, zig: sh.rng.next() < 0.3 }); }
    for (const b of bombs) { b.y += b.vy; if (b.zig) b.x += Math.sin(b.y / 8) * 1.2; }
    // ufo
    if (!ufo && --ufoT <= 0) { ufoT = 900 + sh.rng.int(900); ufo = { x: sh.rng.next() < 0.5 ? -30 : W + 30, vx: 0 }; ufo.vx = ufo.x < 0 ? 1.6 : -1.6; }
    if (ufo) { ufo.x += ufo.vx; if (tick % 10 === 0) sh.audio.tone({ freq: 500 + (tick % 20) * 10, type: "sine", dur: 0.08, vol: 0.04 }); if (ufo.x < -40 || ufo.x > W + 40) ufo = null; }
    // player shot
    if (shot) {
      shot.y += shot.vy;
      if (shot.y < 30) shot = null;
      else {
        let hit = false;
        for (const a of aliens) if (!a.dead && shot.x > a.x && shot.x < a.x + AW && shot.y > a.y && shot.y < a.y + AH) { a.dead = true; hit = true; g.score += a.pts * wave; sh.wallet?.earn(1); pop(a.x + AW / 2, a.y, "+" + a.pts * wave, "#fff"); kill(a.x + AW / 2, a.y + AH / 2, a.kind === "squid" ? T?.accent : a.kind === "crab" ? T?.cyan : T?.marquee, sh); break; }
        if (!hit && ufo && Math.abs(shot.x - ufo.x) < 20 && shot.y < 56 && shot.y > 36) { const pts = [50, 100, 150, 300][sh.rng.int(4)] * wave; g.score += pts; sh.wallet?.earn(10); pop(ufo.x, 46, "+" + pts, T?.marquee); kill(ufo.x, 46, T?.marquee, sh); rings.push({ x: ufo.x, y: 46, t: 0, big: true }); ufo = null; hit = true; }
        if (!hit) for (const b of bombs) if (!b.dead && Math.abs(b.x - shot.x) < 5 && Math.abs(b.y - shot.y) < 10) { b.dead = true; hit = true; g.score += 5; burst(b.x, b.y, 6, T?.cyan, sh); break; }
        if (!hit && chipBunker(shot.x, shot.y, 2)) hit = true;
        if (hit) shot = null;
      }
    }
    // bombs vs bunkers / player
    for (const b of bombs) {
      if (b.dead) continue;
      if (chipBunker(b.x, b.y, 3)) { b.dead = true; continue; }
      if (b.y > H - 60 && b.y < H - 36 && Math.abs(b.x - player.x) < 18 && player.inv <= 0) { b.dead = true; die(sh); }
      if (b.y > H - 20) { b.dead = true; burst(b.x, H - 22, 5, T?.textDim, sh); }
    }
    bombs = bombs.filter(b => !b.dead);
    if (!alive().length) { const bonus = 200 * wave + lives * 100; g.score += bonus; sh.wallet?.earn(12 + wave * 4); pop(W / 2, H / 2, `Wave ${wave} cleared · +${bonus}`, T?.marquee); sh.audio.levelUp(); between = 140; warp = 140; }
  }
  function chipBunker(x, y, radius) {
    for (const bk of bunkers) {
      const lx = Math.floor((x - bk.x) / 3), ly = Math.floor((y - bk.y) / 3);
      if (lx < 0 || ly < 0 || lx >= bk.w || ly >= bk.h || !bk.px[ly * bk.w + lx]) continue;
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) { const ax = lx + dx, ay = ly + dy; if (ax >= 0 && ay >= 0 && ax < bk.w && ay < bk.h && dx * dx + dy * dy <= radius * radius + 1) bk.px[ay * bk.w + ax] = false; }
      return true;
    }
    return false;
  }
  function die(sh) { lives--; shake = 20; flash = 8; sh.audio.hit(); burst(player.x, H - 48, 50, T?.cyan, sh); rings.push({ x: player.x, y: H - 48, t: 0, big: true }); respawn = 90; say(lives > 0 ? `${lives} ${lives === 1 ? "cannon" : "cannons"} left` : "Game over", 90); }
  function kill(x, y, color, sh) { burst(x, y, 18, color, sh); rings.push({ x, y, t: 0, color }); sh.audio.tone({ freq: 160, type: "sawtooth", dur: 0.12, slide: -80, vol: 0.1 }); }
  function burst(x, y, n, color, sh) { for (let i = 0; i < n; i++) { const a = sh.rng.next() * 6.28, sp = 0.5 + sh.rng.next() * 3; particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ttl: 20 + sh.rng.int(30), color }); } }
  function hud() { return `${diff.name} · wave ${wave} · ${lives} cannons · ${alive().length} invaders`; }

  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    c.save(); if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.7, (Math.random() - 0.5) * shake * 0.7);
    // deep space
    const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#02030A"); bg.addColorStop(1, shade(T.bgGlow1, -0.5)); c.fillStyle = bg; c.fillRect(-10, -10, W + 20, H + 20);
    for (const [i, n] of nebulae.entries()) { const col = [T.accent, T.cyan, T.marquee, "#B57BFF"][i % 4]; const ng = c.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r); ng.addColorStop(0, col + "33"); ng.addColorStop(0.6, col + "0E"); ng.addColorStop(1, col + "00"); c.fillStyle = ng; c.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2); }
    // planet on the horizon
    const pg = c.createRadialGradient(W - 120, H + 80, 40, W - 120, H + 80, 240); pg.addColorStop(0, shade(T.cyan, -0.2)); pg.addColorStop(0.6, shade(T.bgGlow2, -0.1)); pg.addColorStop(1, "#02030A"); c.fillStyle = pg; c.beginPath(); c.arc(W - 120, H + 80, 240, 0, 7); c.fill();
    c.strokeStyle = T.cyan + "55"; c.lineWidth = 1; c.beginPath(); c.arc(W - 120, H + 80, 244, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
    for (const s of stars) { const a = 0.3 + 0.7 * Math.abs(Math.sin(tick / 40 + s.tw)); c.globalAlpha = a * s.z; c.fillStyle = "#fff"; if (warp > 0) c.fillRect(s.x, s.y, 1, 2 + warp * s.z * 0.6); else c.fillRect(s.x, s.y, s.z > 0.8 ? 2 : 1, s.z > 0.8 ? 2 : 1); } c.globalAlpha = 1;
    // bunkers
    for (const bk of bunkers) { c.fillStyle = shade(T.cyan, -0.1); c.shadowColor = T.cyan; c.shadowBlur = 6; for (let yy = 0; yy < bk.h; yy++) for (let xx = 0; xx < bk.w; xx++) if (bk.px[yy * bk.w + xx]) c.fillRect(bk.x + xx * 3, bk.y + yy * 3, 3, 3); c.shadowBlur = 0; }
    // aliens
    for (const a of aliens) { if (a.dead) continue; const col = a.kind === "squid" ? T.accent : a.kind === "crab" ? T.cyan : T.marquee; drawSprite(c, SPR[a.kind][frame], a.x, a.y, col); }
    if (ufo) { c.save(); c.translate(ufo.x, 46); c.shadowColor = T.marquee; c.shadowBlur = 18; c.fillStyle = shade(T.marquee, -0.2); c.beginPath(); c.ellipse(0, 0, 20, 7, 0, 0, 7); c.fill(); c.fillStyle = shade(T.marquee, 0.5); c.beginPath(); c.arc(0, -3, 8, Math.PI, 0); c.fill(); c.shadowBlur = 0; c.fillStyle = T.accent; for (let i = -1; i <= 1; i++) { c.globalAlpha = 0.5 + 0.5 * Math.sin(tick / 4 + i); c.fillRect(i * 10 - 1.5, 2, 3, 3); } c.globalAlpha = 1; c.restore(); }
    for (const b of bombs) { c.shadowColor = T.accent; c.shadowBlur = 8; c.strokeStyle = T.accent; c.lineWidth = 2; c.beginPath(); c.moveTo(b.x, b.y - 8); c.lineTo(b.x + (b.zig ? Math.sin(tick / 3) * 3 : 0), b.y); c.stroke(); c.shadowBlur = 0; }
    if (shot) { c.shadowColor = "#fff"; c.shadowBlur = 10; c.fillStyle = "#fff"; c.fillRect(shot.x - 1.5, shot.y - 8, 3, 12); c.shadowBlur = 0; }
    // shockwave rings
    for (const r of rings) { const k = r.t / 30; c.globalAlpha = (1 - k) * 0.8; c.strokeStyle = r.color || "#fff"; c.lineWidth = r.big ? 3 : 1.5; c.beginPath(); c.arc(r.x, r.y, k * (r.big ? 70 : 28), 0, 7); c.stroke(); } c.globalAlpha = 1;
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color || "#fff"; c.fillRect(p.x, p.y, 2.5, 2.5); } c.globalAlpha = 1;
    // cannon
    if (respawn === 0 || lives > 0) if (respawn === 0) drawCannon(c);
    // ground line
    c.strokeStyle = T.cyan; c.globalAlpha = 0.6; c.lineWidth = 2; c.beginPath(); c.moveTo(0, H - 18); c.lineTo(W, H - 18); c.stroke(); c.globalAlpha = 1;
    // HUD
    c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(0, 0, W, 30);
    c.fillStyle = "#fff"; c.font = "700 13px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(`Wave ${wave}`, 12, 15);
    c.fillStyle = T.cyan; for (let i = 0; i < lives; i++) { c.fillRect(W - 24 - i * 22, 11, 14, 5); c.fillRect(W - 19 - i * 22, 7, 4, 4); }
    for (const p of popups) { const k = 1 - p.ttl / 50; c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color || "#fff"; c.font = "800 12px system-ui,sans-serif"; c.textAlign = "center"; c.shadowColor = "#000"; c.shadowBlur = 5; c.fillText(p.text, p.x, p.y - k * 18); c.shadowBlur = 0; } c.globalAlpha = 1;
    if (flash > 0) { c.fillStyle = `rgba(255,255,255,${flash / 20})`; c.fillRect(-10, -10, W + 20, H + 20); }
    // scanlines + vignette for the CRT feel
    c.fillStyle = "rgba(0,0,0,0.12)"; for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
    const vg = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.8); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.45)"); c.fillStyle = vg; c.fillRect(0, 0, W, H);
    if (msgTtl > 0 && msg) { c.font = "800 26px 'Chakra Petch',system-ui,sans-serif"; c.textAlign = "center"; c.fillStyle = T.marquee; c.shadowColor = T.marquee; c.shadowBlur = 20; c.globalAlpha = Math.min(1, msgTtl / 20); c.fillText(msg, W / 2, H / 2 - 40); c.shadowBlur = 0; c.globalAlpha = 1; }
    c.restore();
  }
  function drawSprite(c, rows, x, y, color) {
    const px = AW / 8, py = AH / 7;
    c.shadowColor = color; c.shadowBlur = 10; c.fillStyle = color;
    for (let r = 0; r < rows.length; r++) for (let k = 0; k < 8; k++) if (rows[r][k] === "1") c.fillRect(x + k * px, y + r * py, px + 0.4, py + 0.4);
    c.shadowBlur = 0;
    c.fillStyle = "#ffffff55"; for (let r = 0; r < 2; r++) for (let k = 0; k < 8; k++) if (rows[r][k] === "1") c.fillRect(x + k * px, y + r * py, px, 1);
  }
  function drawCannon(c) {
    const x = player.x, y = H - 48;
    if (player.inv > 0) c.globalAlpha = 0.5 + 0.3 * Math.sin(tick / 3);
    c.shadowColor = T.cyan; c.shadowBlur = 14;
    const grd = c.createLinearGradient(x - 18, 0, x + 18, 0); grd.addColorStop(0, shade(T.cyan, -0.3)); grd.addColorStop(0.5, shade(T.cyan, 0.5)); grd.addColorStop(1, shade(T.cyan, -0.3));
    c.fillStyle = grd; c.beginPath(); c.moveTo(x - 18, y + 12); c.lineTo(x - 18, y + 4); c.lineTo(x - 8, y); c.lineTo(x - 3, y - 6); c.lineTo(x - 2, y - 12); c.lineTo(x + 2, y - 12); c.lineTo(x + 3, y - 6); c.lineTo(x + 8, y); c.lineTo(x + 18, y + 4); c.lineTo(x + 18, y + 12); c.closePath(); c.fill(); c.shadowBlur = 0;
    if (flash > 0 && shot) { c.fillStyle = "#fff"; c.beginPath(); c.arc(x, y - 14, 5, 0, 7); c.fill(); }
    c.globalAlpha = 1;
  }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
