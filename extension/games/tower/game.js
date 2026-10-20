// Tower Defence — enemies march the path; build towers beside it. 1–5 picks a tower, click a free tile
// to build, click a tower to select it (U upgrades, S sells), Space calls the next wave early for bonus
// gold. Five towers (arrow, cannon, frost, tesla, sniper), five enemies (runner, grunt, tank, flyer,
// boss), three maps that rotate every five waves. 20 lives. Credits paid per wave cleared.
import { loadPack, draw as spr } from "../../shell/sprites.js";
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
  let coverage = [], coverDirty = true, baseHit = 0;
  let map, path, pathCells, towers, enemies, shots, bolts, particles, popups, gold, lives, wave, waveT, spawning, spawnQ, spawnT, selected, building, hover, msg, msgTtl, shake, flash, decor, between;

  function init(sh) { g.score = 0; g.level = 1; gold = diff.gold; lives = diff.lives; wave = 0; towers = []; particles = []; popups = []; shots = []; bolts = []; shake = 0; flash = 0; selected = null; building = null; setMap(0, sh); enemies = []; spawnQ = []; spawning = false; between = 0; waveT = 420; say("Build towers, then Space to send the first wave", 200); }
  function rebuildCoverage() { coverage = path.map(([x, y]) => towers.some(w => Math.hypot(cx(w.x) - cx(x), cy(w.y) - cy(y)) <= stat(w, "range") + 12)); coverDirty = false; }
  function rushFactor(e) { // enemies sprint where no tower covers the road ahead of them
    if (!towers.length) return 2.2;
    if (e.fly) { return towers.some(w => Math.hypot(cx(w.x) - e.x, cy(w.y) - e.y) <= stat(w, "range") + 40) ? 1 : 1.6; }
    for (let i = e.seg; i <= Math.min(path.length - 1, e.seg + 3); i++) if (coverage[i]) return 1;
    return 1.7;
  }
  function setMap(i, sh) {
    map = i % MAPS.length; const wp = MAPS[map]; path = []; coverDirty = true;
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
    gold -= def.cost; towers.push({ id, x: t.x, y: t.y, lvl: 1, cool: 0, ang: 0, target: null, kills: 0, spent: def.cost }); coverDirty = true; sh.record(1000 + t.y * COLS + t.x + TOWER_IDS.indexOf(id) * 1000);
    sh.audio.tone({ freq: 400, type: "triangle", dur: 0.1, slide: 200, vol: 0.08 }); burst(cx(t.x), cy(t.y), 10, def.color, sh); return true;
  }
  function upgrade(w, sh) { const cost = Math.round(TOWERS[w.id].cost * 0.8 * w.lvl); if (w.lvl >= 3) { say("Max level", 40); return; } if (gold < cost) { say(`Upgrade costs ${cost}`, 50); sh.audio.hit(); return; } gold -= cost; w.lvl++; w.spent += cost; coverDirty = true; sh.record(2000 + w.y * COLS + w.x); pop(cx(w.x), cy(w.y) - 20, `Lv ${w.lvl}`, T?.marquee); sh.audio.levelUp(); burst(cx(w.x), cy(w.y), 14, TOWERS[w.id].color, sh); }
  function sell(w, sh) { gold += Math.round(w.spent * 0.6); towers = towers.filter(t => t !== w); selected = null; coverDirty = true; sh.record(3000 + w.y * COLS + w.x); pop(cx(w.x), cy(w.y), `+${Math.round(w.spent * 0.6)} gold`, T?.textDim); sh.audio.blip(); }
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
    if (coverDirty) rebuildCoverage();
    if (baseHit > 0) baseHit--;
    for (const e of enemies) {
      const def = ENEMIES[e.kind]; e.rush = rushFactor(e); const sp = def.speed * (e.slow > 0 ? 0.55 : 1) * (1 + wave * 0.02) * e.rush; if (e.slow > 0) e.slow--; if (e.hit > 0) e.hit--;
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
  function leak(e, sh) { e.dead = true; lives -= e.kind === "boss" ? 5 : 1; shake = 10; flash = 6; baseHit = 30; sh.audio.hit(); pop(e.x, e.y - 10, e.kind === "boss" ? "-5 lives" : "-1 life", T?.accent); }
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
  // terrain is painted once per map into an offscreen layer (Chrome); falls back to direct drawing
  let terrain = null, terrainMap = -1, pack = null; loadPack("tower").then(p => { pack = p; terrain = null; terrainMap = -1; });
  function paintTerrain(c) {
    const pal = [{ g1: "#4E9A4A", g2: "#3C7F3A", road: "#C9B58A", edge: "#8F7A52", rock: "#8A9A8A" }, { g1: "#C49A62", g2: "#A77D4A", road: "#E7D3A6", edge: "#8A6B3F", rock: "#9C8A74" }, { g1: "#DCE9F2", g2: "#C3D4E2", road: "#9DB0C2", edge: "#6F8395", rock: "#8B9AAB" }][map];
    if (pack?.sprites?.tile_grass) { for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) spr(c, pack, "tile_grass", cx(x), cy(y)); }
    else { const gg = c.createLinearGradient(0, TOP, 0, H); gg.addColorStop(0, pal.g1); gg.addColorStop(1, pal.g2); c.fillStyle = gg; c.fillRect(0, TOP, W, H - TOP); }
    if (pack?.sprites?.tile_road) {
      const pts2 = path.map(([x, y]) => [cx(x), cy(y)]); c.lineCap = "square"; c.lineJoin = "miter"; c.strokeStyle = "rgba(0,0,0,0.28)"; c.lineWidth = CELL + 4; c.beginPath(); pts2.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke();
      for (let i = 0; i < path.length; i++) { const [x, y] = path[i]; if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue; const prev = path[i - 1] || path[i], next = path[i + 1] || path[i]; const dx = Math.sign(next[0] - prev[0]), dy = Math.sign(next[1] - prev[1]); const turn = prev[0] !== next[0] && prev[1] !== next[1] && pack.sprites.tile_road_turn; spr(c, pack, turn ? "tile_road_turn" : "tile_road", cx(x), cy(y), { rot: turn ? turnRot(prev, [x, y], next) : (dx ? 0 : Math.PI / 2) }); }
      for (const d of decor) { const k = ["tree", "rock", "flowers"][d.k] + ((d.x + d.y) % 2 && d.k < 2 ? "2" : ""); spr(c, pack, k, cx(d.x), cy(d.y)) || spr(c, pack, k.replace("2", ""), cx(d.x), cy(d.y)) || drawDecor(c, d, pal); }
      const vg2 = c.createRadialGradient(W / 2, (TOP + H) / 2, H * 0.35, W / 2, (TOP + H) / 2, H * 0.85); vg2.addColorStop(0, "rgba(0,0,0,0)"); vg2.addColorStop(1, "rgba(0,0,0,0.3)"); c.fillStyle = vg2; c.fillRect(0, TOP, W, H - TOP);
      return;
    }
    // soft mottling
    for (let i = 0; i < 160; i++) { const x = (i * 97) % W, y = TOP + (i * 61) % (H - TOP), r = 14 + (i % 5) * 6; const m = c.createRadialGradient(x, y, 0, x, y, r); m.addColorStop(0, i % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"); m.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = m; c.fillRect(x - r, y - r, r * 2, r * 2); }
    // road: wide rounded polyline with edge, body, and a worn centre
    const pts = path.map(([x, y]) => [cx(x), cy(y)]);
    c.lineCap = "round"; c.lineJoin = "round";
    const stroke = (w, col) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke(); };
    stroke(CELL * 0.98, "rgba(0,0,0,0.22)"); stroke(CELL * 0.9, pal.edge); stroke(CELL * 0.78, pal.road); stroke(CELL * 0.4, shade(pal.road, 0.12));
    // gravel + tyre marks
    for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; for (let k = 0; k < 8; k++) { const t = k / 8, px = x0 + (x1 - x0) * t + (((i * 7 + k * 13) % 11) - 5) * 1.6, py = y0 + (y1 - y0) * t + (((i * 5 + k * 17) % 11) - 5) * 1.6; c.fillStyle = (k % 3) ? shade(pal.road, -0.2) : shade(pal.road, 0.25); c.fillRect(px, py, 2, 2); } }
    // grass tufts along the edges of the road
    c.fillStyle = shade(pal.g1, 0.25);
    for (let i = 1; i < pts.length - 1; i += 1) { const [x, y] = pts[i]; for (const [ox, oy] of [[-CELL * 0.5, -CELL * 0.5], [CELL * 0.5, CELL * 0.5], [CELL * 0.5, -CELL * 0.5], [-CELL * 0.5, CELL * 0.5]]) { const tx = x + ox, ty = y + oy; if (pathCells.has(Math.floor(ty > TOP ? (ty - TOP) / CELL : 0) * COLS + Math.floor(tx / CELL))) continue; for (let b = 0; b < 3; b++) { c.beginPath(); c.moveTo(tx - 3 + b * 3, ty + 4); c.lineTo(tx - 2 + b * 3, ty - 3); c.lineTo(tx - 1 + b * 3, ty + 4); c.fill(); } } }
    for (const d of decor) drawDecor(c, d, pal);
    // vignette
    const vg = c.createRadialGradient(W / 2, (TOP + H) / 2, H * 0.35, W / 2, (TOP + H) / 2, H * 0.85); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.35)"); c.fillStyle = vg; c.fillRect(0, TOP, W, H - TOP);
  }
  function turnRot(prev, cur, next) { const inD = [cur[0] - prev[0], cur[1] - prev[1]], outD = [next[0] - cur[0], next[1] - cur[1]]; const k = `${inD}|${outD}`; return { "1,0|0,1": 0, "0,-1|-1,0": 0, "0,1|-1,0": Math.PI / 2, "1,0|0,-1": Math.PI / 2, "-1,0|0,-1": Math.PI, "0,1|1,0": Math.PI, "0,-1|1,0": -Math.PI / 2, "-1,0|0,1": -Math.PI / 2 }[k] || 0; }
  function drawDecor(c, d, pal) {
    { const x = cx(d.x), y = cy(d.y);
      if (d.k === 0) { c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.ellipse(x + 6, y + 12, 12, 5, 0, 0, 7); c.fill(); c.fillStyle = "#5A3A1E"; c.fillRect(x - 2, y + 2, 4, 9); const cg = c.createRadialGradient(x - 4, y - 6, 2, x, y - 2, 13); cg.addColorStop(0, map === 2 ? "#4E8A5A" : shade(pal.g1, 0.45)); cg.addColorStop(1, map === 2 ? "#1E4A33" : shade(pal.g2, -0.45)); c.fillStyle = cg; c.beginPath(); c.arc(x, y - 2, 12, 0, 7); c.arc(x - 7, y + 2, 8, 0, 7); c.arc(x + 7, y + 2, 8, 0, 7); c.fill(); if (map === 2) { c.fillStyle = "#F4F7FB"; c.beginPath(); c.arc(x - 2, y - 9, 5, 0, 7); c.arc(x + 6, y - 4, 3.5, 0, 7); c.fill(); } }
      else if (d.k === 1) { c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.ellipse(x + 3, y + 5, 9, 4, 0, 0, 7); c.fill(); const rg = c.createRadialGradient(x - 3, y - 3, 1, x, y, 9); rg.addColorStop(0, shade(pal.rock, 0.5)); rg.addColorStop(1, shade(pal.rock, -0.5)); c.fillStyle = rg; c.beginPath(); c.moveTo(x - 9, y + 4); c.lineTo(x - 6, y - 5); c.lineTo(x + 2, y - 7); c.lineTo(x + 9, y - 1); c.lineTo(x + 7, y + 5); c.closePath(); c.fill(); }
      else { for (let i = 0; i < 3; i++) { const fx = x - 6 + i * 6, fy = y + (i % 2) * 4; c.fillStyle = ["#FF7AA6", "#FFD66B", "#9FD8FF"][(i + d.x) % 3]; c.beginPath(); c.arc(fx, fy, 2.2, 0, 7); c.fill(); c.fillStyle = "#fff"; c.beginPath(); c.arc(fx, fy, 0.8, 0, 7); c.fill(); } }
    }
  }
  function drawTerrain(c) {
    if (terrainMap !== map) { terrain = null; terrainMap = map; try { if (typeof OffscreenCanvas !== "undefined") { terrain = new OffscreenCanvas(W, H); paintTerrain(terrain.getContext("2d")); } } catch { terrain = null; } }
    if (terrain) c.drawImage(terrain, 0, 0); else paintTerrain(c);
  }
  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    c.save(); if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.6, (Math.random() - 0.5) * shake * 0.6);
    c.fillStyle = "#0b1410"; c.fillRect(-10, -10, W + 20, H + 20);
    drawTerrain(c);
    // moving chevrons on the road
    c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 2; c.lineCap = "round";
    for (let i = 1; i < path.length - 1; i += 2) { const [x, y] = path[i], [nx, ny] = path[i + 1]; const px = cx(x), py = cy(y), dx = Math.sign(nx - x), dy = Math.sign(ny - y), k = ((tick / 4 + i * 3) % 36) / 36; const ox = px + dx * (k * CELL - CELL / 2), oy = py + dy * (k * CELL - CELL / 2); c.globalAlpha = 0.6 * Math.sin(k * Math.PI); c.beginPath(); c.moveTo(ox - dy * 6 - dx * 5, oy - dx * 6 - dy * 5); c.lineTo(ox, oy); c.lineTo(ox + dy * 6 - dx * 5, oy + dx * 6 - dy * 5); c.stroke(); } c.globalAlpha = 1;
    // base (crystal) and spawn (portal)
    const [ex, ey] = path[path.length - 1], [sx, sy] = path[0];
    const bx = Math.max(28, Math.min(W - 28, cx(ex))), by = Math.max(TOP + 32, Math.min(H - 44, cy(ey)));
    drawBase(c, bx, by);
    if (false) {
    c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.ellipse(bx, by + 12, 16, 6, 0, 0, 7); c.fill();
    c.shadowColor = T.cyan; c.shadowBlur = 24 + 8 * Math.sin(tick / 8); const cg = c.createLinearGradient(bx - 10, by - 20, bx + 10, by + 10); cg.addColorStop(0, "#fff"); cg.addColorStop(0.4, T.cyan); cg.addColorStop(1, shade(T.cyan, -0.5)); c.fillStyle = cg; c.beginPath(); c.moveTo(bx, by - 22); c.lineTo(bx + 11, by - 4); c.lineTo(bx, by + 12); c.lineTo(bx - 11, by - 4); c.closePath(); c.fill(); c.shadowBlur = 0; }
    const px0 = Math.max(10, Math.min(W - 10, cx(sx))), py0 = Math.max(TOP + 10, Math.min(H - 10, cy(sy)));
    if (!spr(c, pack, "spawn_portal", px0, py0, { rot: tick / 30 })) {
    const pg = c.createRadialGradient(px0, py0, 2, px0, py0, 16); pg.addColorStop(0, "#fff"); pg.addColorStop(0.3, T.accent); pg.addColorStop(1, "rgba(255,92,168,0)"); c.fillStyle = pg; c.globalAlpha = 0.7 + 0.3 * Math.sin(tick / 6); c.beginPath(); c.arc(px0, py0, 16, 0, 7); c.fill(); c.globalAlpha = 1; c.strokeStyle = T.accent; c.lineWidth = 2; c.beginPath(); c.arc(px0, py0, 12 + 3 * Math.sin(tick / 5), 0, 7); c.stroke(); }
    // build ghost / selection
    if (building && hover && !g.autopilot) { const def = TOWERS[building], ok = !pathCells.has(hover.y * COLS + hover.x) && !towerAt(hover) && gold >= def.cost; c.globalAlpha = 0.16; c.fillStyle = ok ? def.color : T.accent; c.beginPath(); c.arc(cx(hover.x), cy(hover.y), def.range, 0, 7); c.fill(); c.globalAlpha = 0.5; c.strokeStyle = ok ? def.color : T.accent; c.lineWidth = 1.5; c.setLineDash([4, 4]); c.beginPath(); c.arc(cx(hover.x), cy(hover.y), def.range, 0, 7); c.stroke(); c.setLineDash([]); c.globalAlpha = 0.65; drawTower(c, { id: building, x: hover.x, y: hover.y, lvl: 1, ang: 0 }); c.globalAlpha = 1; }
    if (selected) { c.globalAlpha = 0.13; c.fillStyle = TOWERS[selected.id].color; c.beginPath(); c.arc(cx(selected.x), cy(selected.y), stat(selected, "range"), 0, 7); c.fill(); c.globalAlpha = 0.8; c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.setLineDash([4, 4]); c.beginPath(); c.arc(cx(selected.x), cy(selected.y), stat(selected, "range"), 0, 7); c.stroke(); c.setLineDash([]); c.globalAlpha = 1; }
    const draws = [...towers.map(w => ({ y: cy(w.y), f: () => drawTower(c, w) })), ...enemies.map(e => ({ y: e.y + (e.fly ? 60 : 0), f: () => drawEnemy(c, e) }))].sort((a, b) => a.y - b.y);
    for (const d of draws) d.f();
    for (const s of shots) {
      const key = s.big ? "shot_shell" : s.slow ? "shot_ice" : "shot_arrow";
      if (pack?.sprites?.[key]) { spr(c, pack, key, s.x, s.y, { rot: Math.atan2(s.target.y - s.y, s.target.x - s.x) }); continue; }
      if (s.big) { c.fillStyle = "rgba(60,60,60,0.35)"; s.trail.forEach(([x, y], i) => { c.globalAlpha = (i + 1) / s.trail.length * 0.4; c.beginPath(); c.arc(x, y, 3 + (s.trail.length - i), 0, 7); c.fill(); }); c.globalAlpha = 1; const sg = c.createRadialGradient(s.x - 1, s.y - 1, 1, s.x, s.y, 5); sg.addColorStop(0, "#888"); sg.addColorStop(1, "#111"); c.fillStyle = sg; c.beginPath(); c.arc(s.x, s.y, 5, 0, 7); c.fill(); }
      else if (s.slow) { c.save(); c.translate(s.x, s.y); c.rotate(tick / 4); c.fillStyle = "#DFF4FF"; c.shadowColor = "#8ED3FF"; c.shadowBlur = 10; c.beginPath(); for (let i = 0; i < 6; i++) { c.lineTo(Math.cos(i * 1.047) * 5, Math.sin(i * 1.047) * 5); c.lineTo(Math.cos(i * 1.047 + 0.52) * 2, Math.sin(i * 1.047 + 0.52) * 2); } c.closePath(); c.fill(); c.restore(); c.shadowBlur = 0; }
      else { const ang = Math.atan2(s.target.y - s.y, s.target.x - s.x); c.save(); c.translate(s.x, s.y); c.rotate(ang); c.strokeStyle = "#E9DCC1"; c.lineWidth = 2; c.beginPath(); c.moveTo(-9, 0); c.lineTo(5, 0); c.stroke(); c.fillStyle = "#fff"; c.beginPath(); c.moveTo(5, -2.5); c.lineTo(10, 0); c.lineTo(5, 2.5); c.closePath(); c.fill(); c.fillStyle = s.color; c.beginPath(); c.moveTo(-9, -2.5); c.lineTo(-6, 0); c.lineTo(-9, 2.5); c.closePath(); c.fill(); c.restore(); }
    }
    for (const b of bolts) { c.strokeStyle = b.thin ? "#FFB0CF" : "#E6D2FF"; c.lineWidth = b.thin ? 1.5 : 2.5; c.globalAlpha = b.ttl / 10; c.shadowColor = b.thin ? T.accent : "#B57BFF"; c.shadowBlur = 12; c.beginPath(); c.moveTo(b.x0, b.y0); if (b.thin) c.lineTo(b.x1, b.y1); else { const n = 6; for (let i = 1; i <= n; i++) { const k = i / n; c.lineTo(b.x0 + (b.x1 - b.x0) * k + (i < n ? (Math.random() - 0.5) * 12 : 0), b.y0 + (b.y1 - b.y0) * k + (i < n ? (Math.random() - 0.5) * 12 : 0)); } } c.stroke(); c.shadowBlur = 0; } c.globalAlpha = 1;
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, 1.8, 0, 7); c.fill(); } c.globalAlpha = 1;
    for (const p of popups) { const k = 1 - p.ttl / 55; c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color || "#fff"; c.font = "800 12px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.shadowColor = "#000"; c.shadowBlur = 5; c.fillText(p.text, p.x, p.y - k * 18); c.shadowBlur = 0; } c.globalAlpha = 1;
    if (flash > 0) { c.fillStyle = `rgba(255,60,90,${flash / 30})`; c.fillRect(-10, -10, W + 20, H + 20); }
    drawHud(c);
    if (msgTtl > 0 && msg) { c.font = `800 ${msg.length > 40 ? 13 : 22}px 'Chakra Petch',system-ui,sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = T.marquee; c.shadowColor = "#000"; c.shadowBlur = 10; c.globalAlpha = Math.min(1, msgTtl / 20); c.fillText(msg, W / 2, TOP + 38); c.shadowBlur = 0; c.globalAlpha = 1; }
    c.restore();
  }
  function drawBase(c, bx, by) {
    const hp = Math.max(0, lives) / diff.lives, hit = baseHit / 30;
    c.save(); if (hit > 0) c.translate((Math.random() - 0.5) * hit * 4, (Math.random() - 0.5) * hit * 4);
    // shield dome whose strength is the base health
    c.globalAlpha = 0.12 + 0.25 * hp; c.fillStyle = hp > 0.5 ? T.cyan : hp > 0.25 ? T.marquee : T.accent; c.beginPath(); c.arc(bx, by, 30, 0, 7); c.fill();
    c.globalAlpha = 0.9; c.strokeStyle = c.fillStyle; c.lineWidth = 3; c.beginPath(); c.arc(bx, by, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hp); c.stroke(); c.globalAlpha = 1;
    if (!spr(c, pack, "base_crystal", bx, by)) { c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.ellipse(bx, by + 12, 16, 6, 0, 0, 7); c.fill(); c.shadowColor = T.cyan; c.shadowBlur = 24; const cg = c.createLinearGradient(bx - 10, by - 20, bx + 10, by + 10); cg.addColorStop(0, "#fff"); cg.addColorStop(0.4, T.cyan); cg.addColorStop(1, shade(T.cyan, -0.5)); c.fillStyle = cg; c.beginPath(); c.moveTo(bx, by - 22); c.lineTo(bx + 11, by - 4); c.lineTo(bx, by + 12); c.lineTo(bx - 11, by - 4); c.closePath(); c.fill(); c.shadowBlur = 0; }
    // damage: cracks and smoke as health drops
    if (hp < 0.6) { c.strokeStyle = "rgba(0,0,0,0.6)"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(bx - 10, by - 6); c.lineTo(bx - 4, by + 2); c.lineTo(bx - 8, by + 10); if (hp < 0.35) { c.moveTo(bx + 8, by - 10); c.lineTo(bx + 3, by - 2); c.lineTo(bx + 9, by + 6); } c.stroke(); }
    if (hp < 0.5) { for (let i = 0; i < 3; i++) { const t = (tick / 2 + i * 20) % 60; c.globalAlpha = (1 - t / 60) * 0.5; c.fillStyle = hp < 0.25 ? "#FF7A3D" : "#999"; c.beginPath(); c.arc(bx + Math.sin(t / 8 + i) * 4, by - 10 - t * 0.6, 3 + t / 12, 0, 7); c.fill(); } c.globalAlpha = 1; }
    if (hit > 0) { c.fillStyle = `rgba(255,60,90,${hit * 0.5})`; c.beginPath(); c.arc(bx, by, 34, 0, 7); c.fill(); }
    // health bar + number
    c.fillStyle = "rgba(0,0,0,0.6)"; rr(c, bx - 22, by + 24, 44, 6, 3); c.fill(); c.fillStyle = hp > 0.5 ? "#4CD964" : hp > 0.25 ? T.marquee : T.accent; rr(c, bx - 22, by + 24, 44 * hp, 6, 3); c.fill();
    c.fillStyle = "#fff"; c.font = "800 10px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.shadowColor = "#000"; c.shadowBlur = 4; c.fillText(`${Math.max(0, lives)}/${diff.lives}`, bx, by + 38); c.shadowBlur = 0;
    c.restore();
  }
  function drawHud(c) {
    const hg = c.createLinearGradient(0, 0, 0, TOP); hg.addColorStop(0, "rgba(8,12,20,0.92)"); hg.addColorStop(1, "rgba(8,12,20,0.7)"); c.fillStyle = hg; c.fillRect(0, 0, W, TOP); c.fillStyle = "rgba(255,255,255,0.08)"; c.fillRect(0, TOP - 1, W, 1);
    TOWER_IDS.forEach((id, i) => {
      const d = TOWERS[id], x = 6 + i * 82, on = building === id, can = gold >= d.cost;
      const bg = c.createLinearGradient(x, 6, x, 38); bg.addColorStop(0, on ? shade(d.color, 0.1) : "rgba(255,255,255,0.12)"); bg.addColorStop(1, on ? shade(d.color, -0.3) : "rgba(255,255,255,0.04)"); c.fillStyle = bg; rr(c, x, 6, 78, 32, 8); c.fill();
      c.strokeStyle = on ? "#fff" : can ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)"; c.lineWidth = 1; rr(c, x + 0.5, 6.5, 77, 31, 8); c.stroke();
      c.save(); c.translate(x + 16, 22); c.scale(0.55, 0.55); drawTurret(c, id, 0, 1); c.restore();
      c.fillStyle = on ? "#000" : can ? "#fff" : "rgba(255,255,255,0.4)"; c.font = "700 11px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(d.name, x + 30, 16); c.font = "10px system-ui,sans-serif"; c.fillStyle = on ? "#000" : can ? T.marquee : "rgba(255,255,255,0.4)"; c.fillText(`${d.cost}`, x + 30, 29); c.fillStyle = on ? "#00000088" : "rgba(255,255,255,0.35)"; c.font = "700 9px system-ui,sans-serif"; c.textAlign = "right"; c.fillText(String(i + 1), x + 73, 29); c.textAlign = "left";
    });
    c.fillStyle = T.marquee; c.font = "700 13px system-ui,sans-serif"; c.textAlign = "right"; c.textBaseline = "middle"; c.fillText(`${gold} ◆`, W - 116, 14); c.fillStyle = T.accent; c.fillText(`${lives} ♥`, W - 116, 30);
    const rushing = enemies.some(e => e.rush > 1); if (rushing && tick % 60 < 40) { c.fillStyle = T.accent; c.font = "800 11px system-ui,sans-serif"; c.textAlign = "center"; c.fillText(towers.length ? "GAP IN THE DEFENCE — ENEMIES RUSHING" : "UNDEFENDED — ENEMIES RUSHING", W / 2, TOP + 12); }
    const idle = !spawning && !enemies.length; const wg = c.createLinearGradient(W - 110, 6, W - 110, 38); wg.addColorStop(0, idle ? shade(T.marquee, 0.1) : "rgba(255,255,255,0.12)"); wg.addColorStop(1, idle ? shade(T.marquee, -0.3) : "rgba(255,255,255,0.04)"); c.fillStyle = wg; rr(c, W - 110, 6, 102, 32, 8); c.fill(); c.fillStyle = idle ? "#000" : "#fff"; c.textAlign = "center"; c.font = "700 11px system-ui,sans-serif"; c.fillText(idle ? `Wave ${wave + 1} in ${Math.ceil(waveT / 60)}s` : `Wave ${wave}`, W - 59, 16); c.font = "10px system-ui,sans-serif"; c.fillText(idle ? "Space: call now" : `${enemies.length + spawnQ.length} left`, W - 59, 29);
    if (selected) { const d = TOWERS[selected.id], up = selected.lvl < 3 ? Math.round(d.cost * 0.8 * selected.lvl) : null; c.fillStyle = "rgba(8,12,20,0.85)"; rr(c, 8, H - 34, 340, 26, 8); c.fill(); c.fillStyle = "#fff"; c.textAlign = "left"; c.font = "700 11px system-ui,sans-serif"; c.fillText(`${d.name} Lv${selected.lvl} · ${selected.kills} kills · dmg ${Math.round(stat(selected, "dmg"))} · range ${Math.round(stat(selected, "range"))} · ${up ? `↑ upgrade ${up}` : "max"} · ↓ sell ${Math.round(selected.spent * 0.6)}`, 18, H - 21); }
  }
  function drawTurret(c, id, ang, lvl, recoil = 0) {
    const col = TOWERS[id].color;
    c.save(); c.rotate(ang);
    if (id === "arrow") { c.fillStyle = "#3B2A1A"; rr(c, -6, -4, 14, 8, 2); c.fill(); c.strokeStyle = "#D9C9A8"; c.lineWidth = 2; c.beginPath(); c.moveTo(3, -9); c.quadraticCurveTo(14, 0, 3, 9); c.stroke(); c.strokeStyle = "#fff"; c.lineWidth = 1; c.beginPath(); c.moveTo(3, -9); c.lineTo(-2 + recoil, 0); c.lineTo(3, 9); c.stroke(); c.fillStyle = col; c.beginPath(); c.moveTo(-2 + recoil, -2); c.lineTo(10 + recoil, 0); c.lineTo(-2 + recoil, 2); c.fill(); }
    else if (id === "cannon") { const bg = c.createLinearGradient(0, -6, 0, 6); bg.addColorStop(0, "#777"); bg.addColorStop(0.5, "#2a2a2a"); bg.addColorStop(1, "#111"); c.fillStyle = bg; rr(c, -4 + recoil, -5, 22, 10, 3); c.fill(); c.fillStyle = "#111"; c.beginPath(); c.arc(18 + recoil, 0, 4, 0, 7); c.fill(); const dg = c.createRadialGradient(-2, -2, 1, 0, 0, 8); dg.addColorStop(0, shade(col, 0.4)); dg.addColorStop(1, shade(col, -0.4)); c.fillStyle = dg; c.beginPath(); c.arc(0, 0, 7, 0, 7); c.fill(); }
    else if (id === "frost") { c.fillStyle = "#DFF4FF"; c.shadowColor = col; c.shadowBlur = 10; c.beginPath(); for (let i = 0; i < 6; i++) { c.lineTo(Math.cos(i * 1.047) * 10, Math.sin(i * 1.047) * 10); c.lineTo(Math.cos(i * 1.047 + 0.52) * 4, Math.sin(i * 1.047 + 0.52) * 4); } c.closePath(); c.fill(); c.shadowBlur = 0; c.fillStyle = "#fff"; c.beginPath(); c.arc(0, 0, 3, 0, 7); c.fill(); }
    else if (id === "tesla") { c.fillStyle = "#3a2f55"; rr(c, -5, -5, 10, 10, 3); c.fill(); for (let i = 0; i < 3; i++) { c.strokeStyle = shade(col, 0.2); c.lineWidth = 1.5; c.beginPath(); c.arc(0, 0, 5 + i * 3, 0, 7); c.stroke(); } const og = c.createRadialGradient(0, 0, 1, 0, 0, 7); og.addColorStop(0, "#fff"); og.addColorStop(1, col); c.fillStyle = og; c.shadowColor = col; c.shadowBlur = 12 + 6 * Math.sin(tick / 4); c.beginPath(); c.arc(0, 0, 4, 0, 7); c.fill(); c.shadowBlur = 0; }
    else { const bg = c.createLinearGradient(0, -3, 0, 3); bg.addColorStop(0, "#666"); bg.addColorStop(1, "#111"); c.fillStyle = bg; rr(c, -6 + recoil, -2.5, 30, 5, 2); c.fill(); c.fillStyle = "#222"; rr(c, 2, -5, 8, 10, 2); c.fill(); c.fillStyle = col; c.beginPath(); c.arc(6, -6, 2.5, 0, 7); c.fill(); }
    c.restore();
  }
  function drawTower(c, w) {
    const x = cx(w.x), y = cy(w.y), col = TOWERS[w.id].color, lvl = w.lvl || 1;
    if (pack?.sprites?.["turret_" + w.id]) { spr(c, pack, "base_plinth", x, y); spr(c, pack, "turret_" + w.id, x, y - 2, { rot: w.ang || 0, scale: 1 + (lvl - 1) * 0.08 }); for (let i = 0; i < lvl; i++) { c.fillStyle = T.marquee; c.beginPath(); c.arc(x - 6 + i * 6, y + 14, 2, 0, 7); c.fill(); } return; }
    c.fillStyle = "rgba(0,0,0,0.35)"; c.beginPath(); c.ellipse(x + 3, y + 9, 15, 7, 0, 0, 7); c.fill();
    // stone plinth with rim; gold rim at max level
    const pg = c.createLinearGradient(x, y - 14, x, y + 10); pg.addColorStop(0, "#9AA3B2"); pg.addColorStop(0.5, "#5F6978"); pg.addColorStop(1, "#2E343E"); c.fillStyle = pg; rr(c, x - 14, y - 8, 28, 18, 6); c.fill();
    c.strokeStyle = lvl >= 3 ? T.marquee : "rgba(255,255,255,0.25)"; c.lineWidth = lvl >= 3 ? 2 : 1; rr(c, x - 13.5, y - 7.5, 27, 17, 6); c.stroke();
    const tg = c.createRadialGradient(x - 3, y - 7, 1, x, y - 4, 10 + lvl); tg.addColorStop(0, shade(col, 0.35)); tg.addColorStop(1, shade(col, -0.45)); c.fillStyle = tg; c.beginPath(); c.arc(x, y - 4, 9 + lvl, 0, 7); c.fill();
    c.fillStyle = "rgba(255,255,255,0.25)"; c.beginPath(); c.arc(x - 3, y - 8, 3 + lvl * 0.5, 0, 7); c.fill();
    c.save(); c.translate(x, y - 4); drawTurret(c, w.id, w.ang || 0, lvl, w.cool > stat(w, "rate") - 6 ? -3 : 0); c.restore();
    if (w.cool > stat(w, "rate") - 4 && w.id !== "tesla" && w.id !== "frost") { c.save(); c.translate(x, y - 4); c.rotate(w.ang || 0); c.fillStyle = "#FFF2A8"; c.shadowColor = "#FFF2A8"; c.shadowBlur = 12; c.beginPath(); c.arc(w.id === "sniper" ? 26 : 18, 0, 4, 0, 7); c.fill(); c.restore(); c.shadowBlur = 0; }
    for (let i = 0; i < lvl; i++) { c.fillStyle = i < lvl ? T.marquee : "#444"; c.beginPath(); c.arc(x - 6 + i * 6, y + 13, 2, 0, 7); c.fill(); }
  }
  function drawEnemy(c, e) {
    const def = ENEMIES[e.kind], r = def.r, bob = e.fly ? Math.sin(tick / 6 + e.wob) * 3 : 0, y = e.y + bob - (e.fly ? 14 : 0);
    if (e.rush > 1) { // speed streaks + dust behind a sprinting enemy
      const nxt = e.fly ? path[path.length - 1] : path[Math.min(path.length - 1, e.seg + 1)]; const a = Math.atan2(cy(nxt[1]) - e.y, cx(nxt[0]) - e.x);
      c.strokeStyle = "rgba(255,255,255,0.55)"; c.lineWidth = 1.5; for (let i = 0; i < 3; i++) { const o = (i - 1) * 5, bx = e.x - Math.cos(a) * (r + 4) - Math.sin(a) * o, by = y - Math.sin(a) * (r + 4) + Math.cos(a) * o; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx - Math.cos(a) * (8 + (tick + i * 3) % 6), by - Math.sin(a) * (8 + (tick + i * 3) % 6)); c.stroke(); }
      if (!e.fly) { c.fillStyle = "rgba(120,90,50,0.35)"; for (let i = 0; i < 2; i++) { c.beginPath(); c.arc(e.x - Math.cos(a) * (r + 6 + i * 6), e.y + 4 + Math.sin(tick / 3 + i), 3 + i, 0, 7); c.fill(); } }
    }
    if (pack?.sprites?.["enemy_" + e.kind]) {
      const nxt = e.fly ? path[path.length - 1] : path[Math.min(path.length - 1, e.seg + 1)]; const rot = Math.atan2(cy(nxt[1]) - e.y, cx(nxt[0]) - e.x);
      if (e.fly) { c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.ellipse(e.x + 2, e.y + r * 0.6, r, r * 0.45, 0, 0, 7); c.fill(); }
      spr(c, pack, "enemy_" + e.kind, e.x, y, { rot, frame: Math.floor(tick / 8), alpha: e.hit > 0 ? 0.6 : 1 });
      if (e.slow > 0) { c.fillStyle = "#DFF4FF"; c.globalAlpha = 0.8; for (let i = 0; i < 3; i++) c.fillRect(e.x - r + i * r, y - r - 6 - (tick + i * 7) % 8, 2, 2); c.globalAlpha = 1; }
      c.fillStyle = "rgba(0,0,0,0.6)"; rr(c, e.x - r - 1, y - r - 8, r * 2 + 2, 4, 2); c.fill(); c.fillStyle = e.hp / e.max > 0.5 ? "#4CD964" : e.hp / e.max > 0.25 ? T.marquee : T.accent; rr(c, e.x - r, y - r - 7.5, r * 2 * Math.max(0, e.hp / e.max), 3, 1.5); c.fill(); return;
    }
    const col = e.hit > 0 ? "#fff" : e.slow > 0 ? "#8ED3FF" : def.color;
    c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.ellipse(e.x + 2, e.y + r * 0.6, r, r * 0.45, 0, 0, 7); c.fill();
    const grd = c.createRadialGradient(e.x - r * 0.35, y - r * 0.35, 1, e.x, y, r); grd.addColorStop(0, shade(col, 0.45)); grd.addColorStop(1, shade(col, -0.4));
    c.shadowColor = def.color; c.shadowBlur = e.kind === "boss" ? 18 : 5;
    if (e.kind === "tank" || e.kind === "boss") {
      c.fillStyle = "#222"; rr(c, e.x - r, y - r * 0.2, r * 2, r * 0.9, 3); c.fill(); c.fillStyle = "#444"; for (let i = 0; i < 4; i++) c.fillRect(e.x - r + 2 + i * (r / 2), y + r * 0.35, r / 3, 3);
      c.fillStyle = grd; rr(c, e.x - r * 0.9, y - r * 0.8, r * 1.8, r * 1.1, 4); c.fill(); c.fillStyle = shade(col, 0.2); c.beginPath(); c.arc(e.x, y - r * 0.3, r * 0.45, 0, 7); c.fill(); c.fillStyle = "#222"; c.fillRect(e.x, y - r * 0.4, r * 0.9, 3);
      if (e.kind === "boss") { c.fillStyle = T.marquee; c.beginPath(); for (let i = 0; i < 5; i++) { c.lineTo(e.x - r * 0.6 + i * r * 0.3, y - r * 1.1 - (i % 2 ? 0 : 5)); } c.lineTo(e.x + r * 0.6, y - r * 0.8); c.lineTo(e.x - r * 0.6, y - r * 0.8); c.fill(); }
    } else if (e.fly) {
      c.fillStyle = grd; c.beginPath(); c.ellipse(e.x, y, r * 1.1, r * 0.6, 0, 0, 7); c.fill(); c.fillStyle = "#222"; c.fillRect(e.x - r * 1.3, y - 1.5, r * 2.6, 3);
      c.strokeStyle = "rgba(255,255,255,0.5)"; c.lineWidth = 1.5; c.save(); c.translate(e.x, y - 3); c.rotate(tick * 0.6); c.beginPath(); c.moveTo(-r * 1.2, 0); c.lineTo(r * 1.2, 0); c.moveTo(0, -r * 1.2); c.lineTo(0, r * 1.2); c.stroke(); c.restore();
      c.fillStyle = T.accent; c.globalAlpha = 0.6 + 0.4 * Math.sin(tick / 3); c.beginPath(); c.arc(e.x, y + 2, 2, 0, 7); c.fill(); c.globalAlpha = 1;
    } else {
      c.fillStyle = grd; c.beginPath(); c.arc(e.x, y, r, 0, 7); c.fill();
      if (e.kind === "runner") { c.strokeStyle = shade(col, 0.3); c.lineWidth = 1.5; c.globalAlpha = 0.6; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(e.x - r - 4 - i * 4, y - 3 + i * 3); c.lineTo(e.x - r - 1 - i * 4, y - 3 + i * 3); c.stroke(); } c.globalAlpha = 1; }
      c.fillStyle = "#fff"; c.beginPath(); c.arc(e.x + r * 0.3, y - r * 0.25, r * 0.32, 0, 7); c.arc(e.x - r * 0.2, y - r * 0.25, r * 0.28, 0, 7); c.fill(); c.fillStyle = "#111"; c.beginPath(); c.arc(e.x + r * 0.38, y - r * 0.22, r * 0.16, 0, 7); c.arc(e.x - r * 0.14, y - r * 0.22, r * 0.14, 0, 7); c.fill();
      c.strokeStyle = "#111"; c.lineWidth = 1.2; c.beginPath(); c.arc(e.x + r * 0.1, y + r * 0.25, r * 0.3, 0.2, Math.PI - 0.2); c.stroke();
    }
    c.shadowBlur = 0;
    if (e.slow > 0) { c.fillStyle = "#DFF4FF"; c.globalAlpha = 0.8; for (let i = 0; i < 3; i++) { const sx = e.x - r + i * r, sy = y - r - 6 - (tick + i * 7) % 8; c.fillRect(sx, sy, 2, 2); } c.globalAlpha = 1; }
    c.fillStyle = "rgba(0,0,0,0.6)"; rr(c, e.x - r - 1, y - r - 8, r * 2 + 2, 4, 2); c.fill(); c.fillStyle = e.hp / e.max > 0.5 ? "#4CD964" : e.hp / e.max > 0.25 ? T.marquee : T.accent; rr(c, e.x - r, y - r - 7.5, r * 2 * Math.max(0, e.hp / e.max), 3, 1.5); c.fill();
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
