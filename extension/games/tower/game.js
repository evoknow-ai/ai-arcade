// Tower Defence — enemies march the path; build towers beside it. 1–5 picks a tower, click a free tile
// to build, click a tower to select it (U upgrades, S sells), Space calls the next wave early for bonus
// gold. Five towers (arrow, cannon, frost, tesla, sniper), five enemies (runner, grunt, tank, flyer,
// boss), three maps that rotate every five waves. 20 lives. Credits paid per wave cleared.
const COLS = 16, ROWS = 11, CELL = 36, W = COLS * CELL, H = ROWS * CELL + 44, TOP = 44;
const DIFFICULTY = {
  beginner:     { name: "Beginner",     gold: 260, hp: 0.8, lives: 25 },
  intermediate: { name: "Intermediate", gold: 200, hp: 1.0, lives: 20 },
  advanced:     { name: "Advanced",     gold: 160, hp: 1.3, lives: 15 },
};
const TOWERS = {
  arrow:  { name: "Arrow",  cost: 50,  range: 95,  rate: 22, dmg: 9,  color: "#4CD964", desc: "Quick, cheap, reliable." },
  cannon: { name: "Cannon", cost: 90,  range: 85,  rate: 70, dmg: 30, splash: 34, color: "#FFB454", desc: "Slow shells that splash." },
  frost:  { name: "Frost",  cost: 70,  range: 80,  rate: 40, dmg: 4,  slow: 0.45, color: "#8ED3FF", desc: "Chills everything it hits to half speed." },
  tesla:  { name: "Tesla",  cost: 120, range: 75,  rate: 50, dmg: 16, chain: 4, color: "#B57BFF", desc: "Lightning that jumps between up to 4 enemies." },
  sniper: { name: "Sniper", cost: 140, range: 170, rate: 110, dmg: 90, color: "#FF5CA8", desc: "Hits anything on the map, hard, slowly." },
};
const TOWER_IDS = Object.keys(TOWERS);
const ENEMIES = {
  runner: { hp: 28, speed: 1.9, reward: 6, color: "#FFCF4A", r: 7 },
  grunt:  { hp: 60, speed: 1.1, reward: 9, color: "#FF5CA8", r: 9 },
  tank:   { hp: 220, speed: 0.6, reward: 24, color: "#9AA3B2", r: 12, armor: 6 },
  flyer:  { hp: 45, speed: 1.4, reward: 12, color: "#2CE6D6", r: 8, fly: true },
  boss:   { hp: 900, speed: 0.5, reward: 120, color: "#B57BFF", r: 16, armor: 10 },
};
// maps as path waypoints in tile coords (from entry to exit)
const MAPS = [
  [[-1, 2], [3, 2], [3, 7], [8, 7], [8, 3], [13, 3], [13, 9], [16, 9]],
  [[-1, 5], [5, 5], [5, 1], [10, 1], [10, 9], [2, 9], [2, 7], [14, 7], [14, 4], [16, 4]],
  [[7, -1], [7, 3], [2, 3], [2, 8], [12, 8], [12, 1], [15, 1], [15, 5], [9, 5], [9, 11]],
];

export default function createTower({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0;
  const g = { id: "tower", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, onPointer, onHover, hud };
  let map, path, pathCells, towers, enemies, shots, bolts, particles, popups, gold, lives, wave, waveT, spawning, spawnQ, spawnT, selected, building, hover, msg, msgTtl, shake, flash, decor, between;

  function init(sh) { g.score = 0; g.level = 1; gold = diff.gold; lives = diff.lives; wave = 0; towers = []; particles = []; popups = []; shots = []; bolts = []; shake = 0; flash = 0; selected = null; building = null; setMap(0, sh); enemies = []; spawnQ = []; spawning = false; between = 0; waveT = 420; say("Build towers, then Space to send the first wave", 200); }
  function setMap(i, sh) {
    map = i % MAPS.length; const wp = MAPS[map]; path = [];
    for (let k = 0; k < wp.length - 1; k++) { const [x0, y0] = wp[k], [x1, y1] = wp[k + 1]; const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let s = 0; s < n; s++) path.push([x0 + Math.sign(x1 - x0) * s, y0 + Math.sign(y1 - y0) * s]); }
    path.push(wp[wp.length - 1]); pathCells = new Set(path.map(([x, y]) => y * COLS + x));
    decor = Array.from({ length: 40 }, () => ({ x: sh.rng.int(COLS), y: sh.rng.int(ROWS), k: sh.rng.int(3), p: sh.rng.next() * 6.28 })).filter(d => !pathCells.has(d.y * COLS + d.x));
  }
  const cx = (tx) => tx * CELL + CELL / 2, cy = (ty) => TOP + ty * CELL + CELL / 2;
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x, y, text, color, ttl: 55 }); }

  // ---------- waves ----------
  function startWave(sh) {
    wave++; g.level = wave; spawning = true; spawnT = 0; spawnQ = []; g._paid = false;
    if (wave > 1 && (wave - 1) % 5 === 0) { setMap(map + 1, sh); towers = []; shots = []; bolts = []; gold += 120; say(`New map · towers refunded +120`, 150); }
    const n = 6 + wave * 2;
    for (let i = 0; i < n; i++) { const r = sh.rng.next(); let k = "grunt"; if (wave >= 2 && r < 0.3) k = "runner"; else if (wave >= 3 && r < 0.45) k = "tank"; else if (wave >= 4 && r < 0.6) k = "flyer"; spawnQ.push(k); }
    if (wave % 5 === 0) spawnQ.push("boss");
    if (msgTtl < 60) say(`Wave ${wave}${wave % 5 === 0 ? " · BOSS" : ""}`, 100);
  }
  function spawnEnemy(sh, kind) {
    const def = ENEMIES[kind], [x, y] = path[0];
    enemies.push({ kind, x: cx(x), y: cy(y), hp: def.hp * diff.hp * (1 + wave * 0.12), max: def.hp * diff.hp * (1 + wave * 0.12), seg: 0, t: 0, slow: 0, hit: 0, wob: sh.rng.next() * 6.28, fly: def.fly, fx: cx(x), fy: cy(y) });
  }
  // ---------- input ----------
  function tileAt(px, py) { const x = Math.floor(px / CELL), y = Math.floor((py - TOP) / CELL); return x >= 0 && y >= 0 && x < COLS && y < ROWS ? { x, y } : null; }
  function towerAt(t) { return towers.find(w => w.x === t.x && w.y === t.y); }
  function onHover(px, py) { hover = tileAt(px, py); }
  function onInput(action, sh) {
    if (action.startsWith("slot")) { const id = TOWER_IDS[+action.slice(4) - 1]; if (id) { building = building === id ? null : id; selected = null; } }
    if (action === "action") callWave(sh);
    if (action === "pause" && (building || selected)) { building = null; selected = null; }
    if (action === "up" && selected) upgrade(selected, sh);
    if (action === "down" && selected) sell(selected, sh);
    if (action === "hint") say("1–5 pick a tower · click to build · click a tower then ↑ upgrade, ↓ sell · Space next wave", 220);
  }
  function callWave(sh) { if (spawning || enemies.length) return; const bonus = Math.floor(waveT / 60) * 2; if (bonus > 0) { gold += bonus; pop(W / 2, H / 2, `Early call +${bonus} gold`, T?.marquee); } waveT = 0; startWave(sh); }
  function onPointer(px, py, sh, button) {
    if (py < TOP) { const i = Math.floor((px - 6) / 82); if (i >= 0 && i < TOWER_IDS.length && px < 6 + TOWER_IDS.length * 82) { building = building === TOWER_IDS[i] ? null : TOWER_IDS[i]; selected = null; } else if (px > W - 110) callWave(sh); return; }
    const t = tileAt(px, py); if (!t) return;
    if (button === 2) { building = null; selected = null; return; }
    const w = towerAt(t);
    if (w) { if (selected === w) { upgrade(w, sh); } else { selected = w; building = null; } return; }
    if (building) { build(building, t, sh); return; }
    selected = null;
  }
  function build(id, t, sh) {
    const def = TOWERS[id];
    if (pathCells.has(t.y * COLS + t.x)) { say("Can't build on the path", 50); sh.audio.hit(); return false; }
    if (gold < def.cost) { say(`${def.name} costs ${def.cost} gold`, 60); sh.audio.hit(); return false; }
    gold -= def.cost; towers.push({ id, x: t.x, y: t.y, lvl: 1, cool: 0, ang: 0, target: null, kills: 0, spent: def.cost }); sh.record(1000 + t.y * COLS + t.x + TOWER_IDS.indexOf(id) * 1000);
    sh.audio.tone({ freq: 400, type: "triangle", dur: 0.1, slide: 200, vol: 0.08 }); burst(cx(t.x), cy(t.y), 10, def.color, sh); return true;
  }
  function upgrade(w, sh) { const cost = Math.round(TOWERS[w.id].cost * 0.8 * w.lvl); if (w.lvl >= 3) { say("Max level", 40); return; } if (gold < cost) { say(`Upgrade costs ${cost}`, 50); sh.audio.hit(); return; } gold -= cost; w.lvl++; w.spent += cost; sh.record(2000 + w.y * COLS + w.x); pop(cx(w.x), cy(w.y) - 20, `Lv ${w.lvl}`, T?.marquee); sh.audio.levelUp(); burst(cx(w.x), cy(w.y), 14, TOWERS[w.id].color, sh); }
  function sell(w, sh) { gold += Math.round(w.spent * 0.6); towers = towers.filter(t => t !== w); selected = null; sh.record(3000 + w.y * COLS + w.x); pop(cx(w.x), cy(w.y), `+${Math.round(w.spent * 0.6)} gold`, T?.textDim); sh.audio.blip(); }
  const stat = (w, k) => { const d = TOWERS[w.id]; const m = 1 + (w.lvl - 1) * 0.45; return k === "range" ? d.range * (1 + (w.lvl - 1) * 0.15) : k === "dmg" ? d.dmg * m : k === "rate" ? d.rate / (1 + (w.lvl - 1) * 0.25) : d[k]; };

  // ---------- simulation ----------
  function update(sh) {
    tick = sh.tick;
    if (msgTtl > 0) msgTtl--; if (shake > 0) shake--; if (flash > 0) flash--;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.05; }
    bolts = bolts.filter(b => (b.ttl -= 1) > 0); popups = popups.filter(p => (p.ttl -= 1) > 0);
    if (!spawning && !enemies.length) { if (!g._paid && wave > 0) { g._paid = true; const cr = 4 + wave * 2; sh.wallet?.earn(cr); g.score += 100 * wave + lives * 5; pop(W / 2, TOP + 60, `Wave ${wave} held · +${100 * wave + lives * 5} · ${cr} cr`, T?.cyan); sh.audio.levelUp(); waveT = 600; } if (--waveT <= 0) { startWave(sh); } }
    if (spawning) { if (--spawnT <= 0 && spawnQ.length) { spawnEnemy(sh, spawnQ.shift()); spawnT = Math.max(14, 40 - wave * 2); } if (!spawnQ.length) spawning = false; }
    // enemies move along the path (flyers cut straight to the exit)
    for (const e of enemies) {
      const def = ENEMIES[e.kind]; const sp = def.speed * (e.slow > 0 ? 0.55 : 1) * (1 + wave * 0.02); if (e.slow > 0) e.slow--; if (e.hit > 0) e.hit--;
      if (e.fly) { const [ex, ey] = path[path.length - 1]; const tx = cx(ex), ty = cy(ey); const d = Math.hypot(tx - e.x, ty - e.y); if (d < sp) { leak(e, sh); continue; } e.x += (tx - e.x) / d * sp; e.y += (ty - e.y) / d * sp; }
      else { let left = sp; while (left > 0) { const nxt = path[e.seg + 1]; if (!nxt) { leak(e, sh); break; } const tx = cx(nxt[0]), ty = cy(nxt[1]); const d = Math.hypot(tx - e.x, ty - e.y); if (d <= left) { e.x = tx; e.y = ty; e.seg++; left -= d; } else { e.x += (tx - e.x) / d * left; e.y += (ty - e.y) / d * left; left = 0; } } }
    }
    enemies = enemies.filter(e => !e.dead);
    // towers fire
    for (const w of towers) {
      if (w.cool > 0) w.cool--;
      const range = stat(w, "range"), wx = cx(w.x), wy = cy(w.y);
      let best = null; for (const e of enemies) { const d = Math.hypot(e.x - wx, e.y - wy); if (d <= range && (!best || (w.id === "sniper" ? e.max > best.max : e.seg + (e.fly ? 999 : 0) > best.seg + (best.fly ? 999 : 0)))) best = e; }
      w.target = best; if (best) { w.ang += ((Math.atan2(best.y - wy, best.x - wx) - w.ang + Math.PI * 3) % (Math.PI * 2) - Math.PI) * 0.3; }
      if (best && w.cool <= 0) { w.cool = stat(w, "rate"); fire(w, best, sh); }
    }
    for (const s of shots) {
      if (!s.target || s.target.dead) { if (s.splash) { explode(s.x, s.y, s, sh); } s.dead = true; continue; }
      const d = Math.hypot(s.target.x - s.x, s.target.y - s.y); if (d < s.spd) { if (s.splash) explode(s.target.x, s.target.y, s, sh); else damage(s.target, s.dmg, s, sh); s.dead = true; continue; }
      s.x += (s.target.x - s.x) / d * s.spd; s.y += (s.target.y - s.y) / d * s.spd; if (tick % 2 === 0) { s.trail.push([s.x, s.y]); if (s.trail.length > 6) s.trail.shift(); }
    }
    shots = shots.filter(s => !s.dead);
    if (lives <= 0) { if (!g._endAt) { g._endAt = sh.tick + 90; say("The base has fallen", 90); sh.audio.gameOver(); } if (sh.tick >= g._endAt) sh.end(); }
    if (g.autopilot && tick % 40 === 0) autoBuild(sh);
  }
  function fire(w, e, sh) {
    const def = TOWERS[w.id], wx = cx(w.x), wy = cy(w.y), dmg = stat(w, "dmg");
    if (w.id === "tesla") { let cur = e, hitSet = new Set(); let px = wx, py = wy; for (let i = 0; i < def.chain; i++) { if (!cur) break; hitSet.add(cur); bolts.push({ x0: px, y0: py, x1: cur.x, y1: cur.y, ttl: 10 }); damage(cur, dmg * Math.pow(0.75, i), { tower: w }, sh); px = cur.x; py = cur.y; cur = enemies.filter(o => !hitSet.has(o) && !o.dead && Math.hypot(o.x - px, o.y - py) < 60).sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py))[0]; } sh.audio.tone({ freq: 1200, type: "sawtooth", dur: 0.08, slide: -800, vol: 0.06 }); return; }
    if (w.id === "sniper") { bolts.push({ x0: wx, y0: wy, x1: e.x, y1: e.y, ttl: 6, thin: true }); damage(e, dmg, { tower: w }, sh); sh.audio.tone({ freq: 300, type: "square", dur: 0.08, slide: -200, vol: 0.08 }); return; }
    shots.push({ x: wx, y: wy, target: e, dmg, spd: w.id === "cannon" ? 4.5 : 8, splash: def.splash, slow: def.slow, color: def.color, tower: w, trail: [], big: w.id === "cannon" });
    sh.audio.tone({ freq: w.id === "frost" ? 700 : 500, type: "triangle", dur: 0.04, slide: -200, vol: 0.04 });
  }
  function explode(x, y, s, sh) { burst(x, y, 22, s.color, sh); shake = 4; sh.audio.tone({ freq: 120, type: "sawtooth", dur: 0.2, slide: -60, vol: 0.08 }); for (const e of enemies) if (!e.dead && Math.hypot(e.x - x, e.y - y) < s.splash) damage(e, s.dmg, s, sh); }
  function damage(e, dmg, s, sh) {
    const def = ENEMIES[e.kind]; const real = Math.max(1, dmg - (def.armor || 0)); e.hp -= real; e.hit = 6; if (s.slow) e.slow = 90;
    if (e.hp <= 0 && !e.dead) { e.dead = true; const rw = def.reward; gold += rw; g.score += rw * 10; if (s.tower) s.tower.kills++; burst(e.x, e.y, 10, def.color, sh); pop(e.x, e.y - 12, `+${rw}`, T?.marquee); sh.audio.tone({ freq: 200 + def.r * 10, type: "square", dur: 0.06, vol: 0.05 }); }
  }
  function leak(e, sh) { e.dead = true; lives -= e.kind === "boss" ? 5 : 1; shake = 10; flash = 6; sh.audio.hit(); pop(e.x, e.y - 10, e.kind === "boss" ? "-5 lives" : "-1 life", T?.accent); }
  function burst(x, y, n, color, sh) { for (let i = 0; i < n; i++) { const a = sh.rng.next() * 6.28, sp = 0.5 + sh.rng.next() * 2.5; particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.5, ttl: 18 + sh.rng.int(22), color }); } }
  function autoBuild(sh) {
    if (!spawning && !enemies.length && waveT > 120 && towers.length >= 3) callWave(sh);
    const candidates = []; for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { if (pathCells.has(y * COLS + x) || towerAt({ x, y })) continue; let near = 0; for (const [px, py] of path) if (Math.abs(px - x) <= 1 && Math.abs(py - y) <= 1) near++; if (near >= 3) candidates.push({ x, y, near }); }
    candidates.sort((a, b) => b.near - a.near || sh.rng.next() - 0.5);
    const want = TOWER_IDS[Math.min(TOWER_IDS.length - 1, Math.floor(towers.length / 2) % TOWER_IDS.length)];
    if (candidates[0] && gold >= TOWERS[want].cost + 20) build(want, candidates[0], sh);
    else { const w = towers.filter(t => t.lvl < 3).sort((a, b) => b.kills - a.kills)[0]; if (w && gold >= TOWERS[w.id].cost * 0.8 * w.lvl + 40) upgrade(w, sh); }
  }
  function hud() { return `${diff.name} · wave ${wave} · ${gold} gold · ${lives} lives · ${towers.length} towers${!spawning && !enemies.length ? ` · next wave in ${Math.ceil(waveT / 60)}s` : ""}`; }

  // ---------- render ----------
  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    c.save(); if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.6, (Math.random() - 0.5) * shake * 0.6);
    // ground
    const base = map === 0 ? "#2F6B3C" : map === 1 ? "#6B5A3C" : "#3C5A6B";
    c.fillStyle = shade(base, -0.2); c.fillRect(-10, -10, W + 20, H + 20);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { c.fillStyle = (x + y) % 2 ? shade(base, -0.05) : base; c.fillRect(x * CELL, TOP + y * CELL, CELL, CELL); }
    for (const d of decor) { const x = cx(d.x), y = cy(d.y) + 8; c.fillStyle = shade(base, 0.25); if (d.k === 0) { for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(x - 6 + i * 6, y); c.lineTo(x - 4 + i * 6 + Math.sin(tick / 20 + d.p) * 1.5, y - 8); c.lineTo(x - 2 + i * 6, y); c.fill(); } } else if (d.k === 1) { c.fillStyle = shade(base, -0.35); c.beginPath(); c.ellipse(x, y, 7, 4, 0, 0, 7); c.fill(); } else { c.fillStyle = map === 2 ? "#F4F7FB" : shade(base, 0.4); c.beginPath(); c.arc(x, y - 2, 2, 0, 7); c.arc(x + 5, y, 1.5, 0, 7); c.fill(); } }
    // path with gravel + direction chevrons
    for (const [x, y] of path) { if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue; c.fillStyle = shade(base, 0.35); c.fillRect(x * CELL, TOP + y * CELL, CELL, CELL); c.fillStyle = shade(base, 0.5); for (let i = 0; i < 4; i++) c.fillRect(x * CELL + ((x * 13 + i * 9 + y * 5) % 30) + 2, TOP + y * CELL + ((y * 7 + i * 11 + x * 3) % 30) + 2, 3, 2); }
    c.strokeStyle = "#ffffff33"; c.lineWidth = 2; for (let i = 1; i < path.length - 1; i += 2) { const [x, y] = path[i], [nx, ny] = path[i + 1]; const px = cx(x), py = cy(y), dx = Math.sign(nx - x), dy = Math.sign(ny - y), k = ((tick / 4 + i * 3) % 36) / 36; const ox = px + dx * (k * CELL - CELL / 2), oy = py + dy * (k * CELL - CELL / 2); c.globalAlpha = 0.5 * Math.sin(k * Math.PI); c.beginPath(); c.moveTo(ox - dy * 6 - dx * 5, oy - dx * 6 - dy * 5); c.lineTo(ox, oy); c.lineTo(ox + dy * 6 - dx * 5, oy + dx * 6 - dy * 5); c.stroke(); } c.globalAlpha = 1;
    // base (exit) and entry
    const [ex, ey] = path[path.length - 1], [sx, sy] = path[0];
    c.fillStyle = T.cyan; c.shadowColor = T.cyan; c.shadowBlur = 18 + 6 * Math.sin(tick / 8); c.beginPath(); c.arc(Math.max(0, Math.min(W, cx(ex))), Math.max(TOP, Math.min(H, cy(ey))), 14, 0, 7); c.fill(); c.shadowBlur = 0;
    c.fillStyle = T.accent; c.globalAlpha = 0.6 + 0.3 * Math.sin(tick / 6); c.beginPath(); c.arc(Math.max(0, Math.min(W, cx(sx))), Math.max(TOP, Math.min(H, cy(sy))), 10, 0, 7); c.fill(); c.globalAlpha = 1;
    // build ghost / selection range
    if (building && hover && !g.autopilot) { const def = TOWERS[building], ok = !pathCells.has(hover.y * COLS + hover.x) && !towerAt(hover) && gold >= def.cost; c.globalAlpha = 0.18; c.fillStyle = ok ? def.color : T.accent; c.beginPath(); c.arc(cx(hover.x), cy(hover.y), def.range, 0, 7); c.fill(); c.globalAlpha = 0.6; drawTower(c, { id: building, x: hover.x, y: hover.y, lvl: 1, ang: 0 }); c.globalAlpha = 1; }
    if (selected) { c.globalAlpha = 0.15; c.fillStyle = TOWERS[selected.id].color; c.beginPath(); c.arc(cx(selected.x), cy(selected.y), stat(selected, "range"), 0, 7); c.fill(); c.globalAlpha = 1; c.strokeStyle = "#fff"; c.lineWidth = 2; c.strokeRect(selected.x * CELL + 2, TOP + selected.y * CELL + 2, CELL - 4, CELL - 4); }
    for (const w of towers) drawTower(c, w);
    for (const e of enemies) drawEnemy(c, e);
    for (const s of shots) { c.strokeStyle = s.color; c.lineWidth = s.big ? 3 : 1.5; c.globalAlpha = 0.5; c.beginPath(); for (const [x, y] of s.trail) c.lineTo(x, y); c.lineTo(s.x, s.y); c.stroke(); c.globalAlpha = 1; c.shadowColor = s.color; c.shadowBlur = 8; c.fillStyle = s.big ? "#333" : s.color; c.beginPath(); c.arc(s.x, s.y, s.big ? 4 : 2.5, 0, 7); c.fill(); c.shadowBlur = 0; }
    for (const b of bolts) { c.strokeStyle = b.thin ? T.accent : "#E6D2FF"; c.lineWidth = b.thin ? 1.5 : 2; c.globalAlpha = b.ttl / 10; c.shadowColor = c.strokeStyle; c.shadowBlur = 10; c.beginPath(); c.moveTo(b.x0, b.y0); if (b.thin) c.lineTo(b.x1, b.y1); else { const n = 5; for (let i = 1; i <= n; i++) { const k = i / n; c.lineTo(b.x0 + (b.x1 - b.x0) * k + (i < n ? (Math.random() - 0.5) * 10 : 0), b.y0 + (b.y1 - b.y0) * k + (i < n ? (Math.random() - 0.5) * 10 : 0)); } } c.stroke(); c.shadowBlur = 0; } c.globalAlpha = 1;
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color; c.fillRect(p.x, p.y, 2.5, 2.5); } c.globalAlpha = 1;
    for (const p of popups) { const k = 1 - p.ttl / 55; c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color || "#fff"; c.font = "800 12px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.shadowColor = "#000"; c.shadowBlur = 5; c.fillText(p.text, p.x, p.y - k * 18); c.shadowBlur = 0; } c.globalAlpha = 1;
    if (flash > 0) { c.fillStyle = `rgba(255,60,90,${flash / 30})`; c.fillRect(-10, -10, W + 20, H + 20); }
    // top bar: tower shop + status
    c.fillStyle = "rgba(0,0,0,0.5)"; c.fillRect(0, 0, W, TOP);
    TOWER_IDS.forEach((id, i) => { const d = TOWERS[id], x = 6 + i * 82, on = building === id, can = gold >= d.cost; c.fillStyle = on ? d.color : "rgba(255,255,255,0.08)"; rr(c, x, 6, 78, 32, 7); c.fill(); c.fillStyle = on ? "#000" : can ? "#fff" : "rgba(255,255,255,0.4)"; c.font = "700 11px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(`${i + 1} ${d.name}`, x + 8, 16); c.font = "10px system-ui,sans-serif"; c.fillText(`${d.cost} gold`, x + 8, 29); c.fillStyle = on ? "#000" : d.color; c.beginPath(); c.arc(x + 68, 22, 5, 0, 7); c.fill(); });
    c.fillStyle = T.marquee; c.font = "700 13px system-ui,sans-serif"; c.textAlign = "right"; c.fillText(`${gold} gold`, W - 116, 14); c.fillStyle = T.accent; c.fillText(`${lives} ♥`, W - 116, 30);
    const idle = !spawning && !enemies.length; c.fillStyle = idle ? T.marquee : "rgba(255,255,255,0.1)"; rr(c, W - 110, 6, 102, 32, 7); c.fill(); c.fillStyle = idle ? "#000" : "#fff"; c.textAlign = "center"; c.font = "700 11px system-ui,sans-serif"; c.fillText(idle ? `Wave ${wave + 1} in ${Math.ceil(waveT / 60)}s` : `Wave ${wave}`, W - 59, 16); c.font = "10px system-ui,sans-serif"; c.fillText(idle ? "Space: call now" : `${enemies.length + spawnQ.length} left`, W - 59, 29);
    if (selected) { const d = TOWERS[selected.id], up = selected.lvl < 3 ? Math.round(d.cost * 0.8 * selected.lvl) : null; c.fillStyle = "rgba(0,0,0,0.75)"; rr(c, 8, H - 34, 330, 26, 8); c.fill(); c.fillStyle = "#fff"; c.textAlign = "left"; c.font = "700 11px system-ui,sans-serif"; c.fillText(`${d.name} Lv${selected.lvl} · ${selected.kills} kills · dmg ${Math.round(stat(selected, "dmg"))} · range ${Math.round(stat(selected, "range"))} · ${up ? `↑ upgrade ${up}` : "max"} · ↓ sell ${Math.round(selected.spent * 0.6)}`, 18, H - 21); }
    if (msgTtl > 0 && msg) { c.font = `800 ${msg.length > 40 ? 13 : 22}px 'Chakra Petch',system-ui,sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = T.marquee; c.shadowColor = "#000"; c.shadowBlur = 10; c.globalAlpha = Math.min(1, msgTtl / 20); c.fillText(msg, W / 2, TOP + 30); c.shadowBlur = 0; c.globalAlpha = 1; }
    c.restore();
  }
  function drawTower(c, w) {
    const d = TOWERS[w.id], x = cx(w.x), y = cy(w.y), col = d.color;
    c.fillStyle = "#00000055"; c.beginPath(); c.ellipse(x + 2, y + 6, 13, 6, 0, 0, 7); c.fill();
    const bg = c.createLinearGradient(x - 12, y - 12, x + 12, y + 12); bg.addColorStop(0, "#7C8594"); bg.addColorStop(1, "#3B4350"); c.fillStyle = bg; rr(c, x - 12, y - 10, 24, 20, 5); c.fill();
    c.fillStyle = shade(col, -0.3); c.beginPath(); c.arc(x, y - 2, 8 + w.lvl, 0, 7); c.fill();
    c.save(); c.translate(x, y - 2); c.rotate(w.ang || 0);
    if (w.id === "arrow") { c.fillStyle = col; c.fillRect(0, -2, 14, 4); c.fillStyle = "#fff"; c.beginPath(); c.moveTo(14, -4); c.lineTo(19, 0); c.lineTo(14, 4); c.fill(); }
    else if (w.id === "cannon") { c.fillStyle = "#222"; rr(c, -2, -4, 18, 8, 3); c.fill(); c.fillStyle = col; c.beginPath(); c.arc(0, 0, 5, 0, 7); c.fill(); }
    else if (w.id === "frost") { c.strokeStyle = col; c.lineWidth = 2; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-8, 0); c.lineTo(8, 0); c.stroke(); c.rotate(Math.PI / 3); } c.fillStyle = "#fff"; c.beginPath(); c.arc(0, 0, 3, 0, 7); c.fill(); }
    else if (w.id === "tesla") { c.fillStyle = col; c.beginPath(); c.arc(0, 0, 4, 0, 7); c.fill(); c.strokeStyle = "#E6D2FF"; c.lineWidth = 1.5; c.globalAlpha = 0.5 + 0.5 * Math.sin(tick / 4); c.beginPath(); c.arc(0, 0, 8 + Math.sin(tick / 3), 0, 7); c.stroke(); c.globalAlpha = 1; }
    else { c.fillStyle = "#222"; c.fillRect(-2, -1.5, 22, 3); c.fillStyle = col; c.fillRect(6, -3, 4, 6); }
    c.restore();
    c.fillStyle = "#fff"; for (let i = 0; i < w.lvl; i++) c.fillRect(x - 8 + i * 6, y + 11, 4, 2);
  }
  function drawEnemy(c, e) {
    const def = ENEMIES[e.kind], r = def.r, bob = e.fly ? Math.sin(tick / 6 + e.wob) * 3 : 0, y = e.y + bob;
    if (e.fly) { c.fillStyle = "#00000044"; c.beginPath(); c.ellipse(e.x, e.y + 10, r, r * 0.4, 0, 0, 7); c.fill(); }
    const col = e.hit > 0 ? "#fff" : e.slow > 0 ? "#8ED3FF" : def.color;
    const grd = c.createRadialGradient(e.x - r * 0.3, y - r * 0.3, 1, e.x, y, r); grd.addColorStop(0, shade(col, 0.4)); grd.addColorStop(1, shade(col, -0.35));
    c.fillStyle = grd; c.shadowColor = def.color; c.shadowBlur = e.kind === "boss" ? 16 : 6;
    if (e.kind === "tank" || e.kind === "boss") { rr(c, e.x - r, y - r * 0.8, r * 2, r * 1.6, 4); c.fill(); c.fillStyle = "#222"; c.fillRect(e.x - r, y + r * 0.5, r * 2, 3); }
    else if (e.fly) { c.beginPath(); c.moveTo(e.x + r, y); c.lineTo(e.x - r, y - r * 0.8); c.lineTo(e.x - r * 0.4, y); c.lineTo(e.x - r, y + r * 0.8); c.closePath(); c.fill(); }
    else { c.beginPath(); c.arc(e.x, y, r, 0, 7); c.fill(); c.fillStyle = "#111"; c.beginPath(); c.arc(e.x + r * 0.3, y - r * 0.2, r * 0.25, 0, 7); c.fill(); }
    c.shadowBlur = 0;
    if (e.slow > 0) { c.fillStyle = "#8ED3FF"; c.globalAlpha = 0.7; for (let i = 0; i < 3; i++) c.fillRect(e.x - r + i * r, y - r - 6 - (tick + i * 7) % 8, 2, 2); c.globalAlpha = 1; }
    c.fillStyle = "#00000088"; c.fillRect(e.x - r, y - r - 7, r * 2, 3); c.fillStyle = e.hp / e.max > 0.5 ? "#4CD964" : e.hp / e.max > 0.25 ? T.marquee : T.accent; c.fillRect(e.x - r, y - r - 7, r * 2 * Math.max(0, e.hp / e.max), 3);
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
