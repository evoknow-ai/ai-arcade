// Mine Field — classic mine sweeping with a solver-backed AI hint.
// Left click / tap reveals, right click flags (or tap the Flag toggle in the top bar, or press Space).
// First click is always safe. Score: safe cells revealed × 10, plus a time bonus on a clean sweep.
// H highlights a cell the solver can prove safe (green) or a mine (red); using it costs 50.
const W = 560, H = 440, TOP = 44;
const DIFFICULTY = {
  beginner:     { name: "Beginner",     cols: 10, rows: 8,  mines: 10, bonus: 1000 },
  intermediate: { name: "Intermediate", cols: 16, rows: 12, mines: 32, bonus: 2500 },
  advanced:     { name: "Advanced",     cols: 24, rows: 16, mines: 80, bonus: 6000 },
};

export default function createMineField({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  const COLS = diff.cols, ROWS = diff.rows;
  const CELL = Math.floor(Math.min((W - 20) / COLS, (H - TOP - 12) / ROWS));
  const OX = Math.floor((W - COLS * CELL) / 2), OY = TOP + Math.floor((H - TOP - ROWS * CELL) / 2);
  let T = null;
  const g = { id: "minefield", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, onPointer, onHover, hud };
  let grid, placed, flagMode, revealedCount, flags, startTick, elapsed, hover, hint, hintTtl, particles, popups, anim, boom, won;

  function init(sh) { g.score = 0; g.level = 1; newField(); }
  function newField() {
    grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ mine: false, n: 0, open: false, flag: false, t: 0 })));
    placed = false; flagMode = false; revealedCount = 0; flags = 0; startTick = null; elapsed = 0; hover = null; hint = null; hintTtl = 0;
    particles = []; popups = []; anim = []; boom = null; won = false;
  }
  function placeMines(sh, sx, sy) {
    let n = 0;
    while (n < diff.mines) {
      const x = sh.rng.int(COLS), y = sh.rng.int(ROWS);
      if (grid[y][x].mine || (Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1)) continue;
      grid[y][x].mine = true; n++;
    }
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) grid[y][x].n = neighbors(x, y).filter(([a, b]) => grid[b][a].mine).length;
    placed = true;
  }
  function neighbors(x, y) {
    const out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const a = x + dx, b = y + dy; if (a >= 0 && b >= 0 && a < COLS && b < ROWS) out.push([a, b]); }
    return out;
  }

  // ---------- input ----------
  function cellAt(px, py) { const x = Math.floor((px - OX) / CELL), y = Math.floor((py - OY) / CELL); return x >= 0 && y >= 0 && x < COLS && y < ROWS ? { x, y } : null; }
  function onHover(px, py) { hover = cellAt(px, py); }
  function onInput(action, sh) {
    if (action === "action") { flagMode = !flagMode; sh.audio.blip(); }
    if (action === "hint") useHint(sh);
  }
  function onPointer(px, py, sh, button) {
    if (py < TOP && px > W - 120) { flagMode = !flagMode; sh.audio.blip(); return; } // Flag toggle in the top bar
    const c = cellAt(px, py); if (!c) return;
    const flagging = button === 2 || flagMode;
    sh.record(1000 + (flagging ? 100000 : 0) + c.y * COLS + c.x);
    if (flagging) toggleFlag(c.x, c.y, sh); else reveal(c.x, c.y, sh);
  }
  function toggleFlag(x, y, sh) {
    const t = grid[y][x]; if (t.open) return;
    t.flag = !t.flag; flags += t.flag ? 1 : -1; sh.audio.blip();
  }
  function reveal(x, y, sh) {
    const t = grid[y][x];
    if (t.open) { chord(x, y, sh); return; }
    if (t.flag) return;
    if (!placed) { placeMines(sh, x, y); startTick = sh.tick; }
    if (t.mine) return detonate(x, y, sh);
    flood(x, y, sh);
    sh.audio.eat();
    checkWin(sh);
  }
  // click an open number whose flags match: reveal the rest of its neighbours
  function chord(x, y, sh) {
    const t = grid[y][x]; const ns = neighbors(x, y);
    if (!t.n || ns.filter(([a, b]) => grid[b][a].flag).length !== t.n) return;
    for (const [a, b] of ns) { const n = grid[b][a]; if (!n.open && !n.flag) { if (n.mine) return detonate(a, b, sh); flood(a, b, sh); } }
    sh.audio.eat(); checkWin(sh);
  }
  function flood(x, y, sh) {
    const stack = [[x, y, 0]];
    while (stack.length) {
      const [a, b, d] = stack.pop(); const t = grid[b][a];
      if (t.open || t.flag || t.mine) continue;
      t.open = true; t.t = d; revealedCount++; g.score += 10; anim.push({ x: a, y: b, ttl: 14 + d * 2 });
      if (t.n === 0) for (const [nx, ny] of neighbors(a, b)) stack.push([nx, ny, d + 1]);
    }
  }
  function detonate(x, y, sh) {
    boom = { x, y, t: 0 };
    for (let i = 0; i < 80; i++) { const a = sh.rng.next() * 6.28, sp = 1 + sh.rng.next() * 5; particles.push({ x: OX + x * CELL + CELL / 2, y: OY + y * CELL + CELL / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, ttl: 30 + sh.rng.int(40), color: i % 2 ? T?.accent : T?.marquee }); }
    for (const row of grid) for (const t of row) if (t.mine) t.open = true;
    sh.audio.hit();
    g._endAt = sh.tick + 80;
  }
  function checkWin(sh) {
    if (revealedCount === COLS * ROWS - diff.mines) {
      won = true;
      const secs = Math.floor(elapsed / 60);
      const bonus = Math.max(200, diff.bonus - secs * 10);
      g.score += bonus; popups.push({ x: W / 2, y: H / 2, text: `Clean sweep! +${bonus}`, color: T?.marquee, ttl: 120 });
      for (let i = 0; i < 120; i++) { const a = sh.rng.next() * 6.28, sp = 1 + sh.rng.next() * 4; particles.push({ x: W / 2, y: H / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, ttl: 40 + sh.rng.int(60), color: [T?.cyan, T?.marquee, T?.accent][i % 3] }); }
      sh.audio.levelUp();
      g._endAt = sh.tick + 150;
    }
  }

  // ---------- solver hint ----------
  // Single-cell rules: if a number's hidden neighbours all must be mines, mark them; if its flags
  // satisfy it, the rest are safe. Then subset rule between pairs of numbers. Good enough for a hint.
  function solve() {
    if (!placed) return null;
    const hidden = (x, y) => neighbors(x, y).filter(([a, b]) => !grid[b][a].open && !grid[b][a].flag);
    const flagged = (x, y) => neighbors(x, y).filter(([a, b]) => grid[b][a].flag).length;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = grid[y][x]; if (!t.open || !t.n) continue;
      const h = hidden(x, y); if (!h.length) continue;
      if (t.n - flagged(x, y) === 0) return { x: h[0][0], y: h[0][1], safe: true };
      if (t.n - flagged(x, y) === h.length) return { x: h[0][0], y: h[0][1], safe: false };
    }
    // subset rule
    const nums = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { const t = grid[y][x]; if (t.open && t.n) { const h = hidden(x, y); if (h.length) nums.push({ h, need: t.n - flagged(x, y) }); } }
    const key = ([a, b]) => a + "," + b;
    for (const A of nums) for (const B of nums) {
      if (A === B || A.h.length >= B.h.length) continue;
      const setA = new Set(A.h.map(key));
      if (!A.h.every(c => B.h.some(d => key(d) === key(c)))) continue;
      const rest = B.h.filter(c => !setA.has(key(c)));
      if (!rest.length) continue;
      if (B.need - A.need === 0) return { x: rest[0][0], y: rest[0][1], safe: true };
      if (B.need - A.need === rest.length) return { x: rest[0][0], y: rest[0][1], safe: false };
    }
    return null;
  }
  function useHint(sh) {
    if (!placed || boom || won) return;
    const h = solve();
    if (!h) { popups.push({ x: W / 2, y: TOP + 20, text: "No certain move — take a guess", color: T?.textDim, ttl: 80 }); return; }
    hint = h; hintTtl = 240; g.score = Math.max(0, g.score - 50); sh.audio.blip();
  }

  // ---------- loop ----------
  function update(sh) {
    if (startTick !== null && !boom && !won) elapsed = sh.tick - startTick;
    if (hintTtl > 0 && --hintTtl === 0) hint = null;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.15; }
    popups = popups.filter(p => (p.ttl -= 1) > 0);
    anim = anim.filter(a => (a.ttl -= 1) > 0);
    if (boom) boom.t++;
    if (g._endAt && sh.tick >= g._endAt) { g._endAt = null; if (won) { g.level++; newField(); popups.push({ x: W / 2, y: TOP + 20, text: `Field ${g.level}`, color: T?.cyan, ttl: 90 }); } else sh.end(); }
    if (g.autopilot && sh.tick % 25 === 0 && !boom && !won) {
      if (!placed) reveal(Math.floor(COLS / 2), Math.floor(ROWS / 2), sh);
      else { const h = solve(); if (h) { if (h.safe) reveal(h.x, h.y, sh); else toggleFlag(h.x, h.y, sh); } else { for (let i = 0; i < 50; i++) { const x = sh.rng.int(COLS), y = sh.rng.int(ROWS); if (!grid[y][x].open && !grid[y][x].flag) { reveal(x, y, sh); break; } } } }
    }
  }
  function hud() { return `${diff.name} · ${diff.mines - flags} mines left · ${Math.floor(elapsed / 60)}s · ${flagMode ? "FLAG mode" : "reveal mode"} (Space) · H hint`; }

  // ---------- render ----------
  const NUM_COLORS = ["", "#4DA3FF", "#4CD964", "#FF5C8A", "#B57BFF", "#FFB454", "#2CE6D6", "#F2F7FF", "#9DB4CC"];
  function render(c, sh) {
    T = sh.theme;
    const bg = c.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.7); bg.addColorStop(0, T.bgGlow1); bg.addColorStop(1, T.bg);
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    // top bar
    c.textBaseline = "middle"; c.font = "700 15px system-ui,sans-serif"; c.textAlign = "left"; c.fillStyle = T.text;
    c.fillText(`${diff.mines - flags}`, 20, TOP / 2); drawMine(c, 58, TOP / 2, 7, T.textDim);
    c.fillStyle = T.textDim; c.font = "13px system-ui,sans-serif"; c.fillText(`${Math.floor(elapsed / 60)}s`, 80, TOP / 2);
    c.fillText(`Field ${g.level}`, 130, TOP / 2);
    // flag toggle
    c.fillStyle = flagMode ? T.accent : T.surface2; rr(c, W - 114, 8, 104, TOP - 16, 14); c.fill();
    c.fillStyle = flagMode ? T.bg : T.text; c.textAlign = "center"; c.font = "700 13px system-ui,sans-serif"; c.fillText(flagMode ? "⚑ Flagging" : "⚑ Flag mode", W - 62, TOP / 2);
    // board frame
    c.fillStyle = "#00000055"; rr(c, OX - 6, OY - 6, COLS * CELL + 12, ROWS * CELL + 12, 10); c.fill();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = grid[y][x], px = OX + x * CELL, py = OY + y * CELL;
      const a = anim.find(z => z.x === x && z.y === y);
      if (!t.open) drawRaised(c, px, py, t, x, y);
      else drawOpen(c, px, py, t, a ? 1 - a.ttl / 14 : 1);
    }
    if (hint && hintTtl > 0) { const px = OX + hint.x * CELL, py = OY + hint.y * CELL; c.globalAlpha = 0.5 + 0.5 * Math.sin(sh.tick / 5); c.strokeStyle = hint.safe ? "#4CD964" : T.accent; c.lineWidth = 3; rr(c, px + 2, py + 2, CELL - 4, CELL - 4, 5); c.stroke(); c.globalAlpha = 1; }
    if (hover && !boom && !won) { const t = grid[hover.y][hover.x]; if (!t.open) { c.strokeStyle = T.text; c.lineWidth = 2; c.globalAlpha = 0.6; rr(c, OX + hover.x * CELL + 1, OY + hover.y * CELL + 1, CELL - 2, CELL - 2, 4); c.stroke(); c.globalAlpha = 1; } }
    if (boom) { c.fillStyle = T.accent; c.globalAlpha = Math.max(0, 0.5 - boom.t / 30); c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 20); c.fillStyle = p.color || T.marquee; c.shadowColor = p.color || T.marquee; c.shadowBlur = 6; c.beginPath(); c.arc(p.x, p.y, 2.2, 0, 7); c.fill(); }
    c.shadowBlur = 0; c.globalAlpha = 1;
    for (const p of popups) { const k = 1 - p.ttl / 120; c.globalAlpha = Math.min(1, p.ttl / 20); c.fillStyle = p.color || T.text; c.font = "800 20px system-ui,sans-serif"; c.textAlign = "center"; c.shadowColor = "#000"; c.shadowBlur = 8; c.fillText(p.text, p.x, p.y - k * 20); c.shadowBlur = 0; }
    c.globalAlpha = 1;
  }
  function drawRaised(c, px, py, t, x, y) {
    const r = Math.max(3, CELL * 0.14);
    c.fillStyle = "#00000066"; rr(c, px + 2, py + 3, CELL - 3, CELL - 3, r); c.fill();
    const gr = c.createLinearGradient(px, py, px + CELL, py + CELL); gr.addColorStop(0, shade(T.surface3, 0.25)); gr.addColorStop(1, shade(T.surface2, -0.25));
    c.fillStyle = gr; rr(c, px + 1, py + 1, CELL - 3, CELL - 3, r); c.fill();
    c.strokeStyle = "#ffffff22"; c.lineWidth = 1; rr(c, px + 1.5, py + 1.5, CELL - 4, CELL - 4, r); c.stroke();
    if (t.flag) {
      const cx = px + CELL / 2, cy = py + CELL / 2, s = CELL * 0.32;
      c.strokeStyle = T.text; c.lineWidth = 2; c.beginPath(); c.moveTo(cx - s * 0.3, cy + s); c.lineTo(cx - s * 0.3, cy - s); c.stroke();
      c.fillStyle = T.accent; c.shadowColor = T.accent; c.shadowBlur = 8; c.beginPath(); c.moveTo(cx - s * 0.3, cy - s); c.lineTo(cx + s * 0.8, cy - s * 0.5); c.lineTo(cx - s * 0.3, cy); c.closePath(); c.fill(); c.shadowBlur = 0;
    }
  }
  function drawOpen(c, px, py, t, k) {
    const r = Math.max(3, CELL * 0.14);
    c.fillStyle = shade(T.board1, -0.2); rr(c, px + 1, py + 1, CELL - 3, CELL - 3, r); c.fill();
    c.fillStyle = "#00000033"; c.fillRect(px + 1, py + 1, CELL - 3, 2);
    if (k < 1) { c.fillStyle = T.cyan; c.globalAlpha = (1 - k) * 0.5; rr(c, px + 1, py + 1, CELL - 3, CELL - 3, r); c.fill(); c.globalAlpha = 1; }
    const cx = px + CELL / 2, cy = py + CELL / 2;
    if (t.mine) { drawMine(c, cx, cy, CELL * 0.26, boom && boom.x >= 0 ? T.accent : T.textDim); if (boom && t === grid[boom.y][boom.x]) { c.fillStyle = T.marquee; c.beginPath(); c.arc(cx, cy, CELL * 0.14, 0, 7); c.fill(); } return; }
    if (t.n) { c.fillStyle = NUM_COLORS[t.n]; c.shadowColor = NUM_COLORS[t.n]; c.shadowBlur = 6; c.font = `800 ${Math.round(CELL * 0.55)}px system-ui,sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.globalAlpha = Math.min(1, k * 1.5); c.fillText(t.n, cx, cy + 1); c.shadowBlur = 0; c.globalAlpha = 1; }
  }
  function drawMine(c, cx, cy, r, color) {
    c.strokeStyle = color; c.lineWidth = Math.max(1.5, r * 0.25); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 4; c.beginPath(); c.moveTo(cx - Math.cos(a) * r * 1.4, cy - Math.sin(a) * r * 1.4); c.lineTo(cx + Math.cos(a) * r * 1.4, cy + Math.sin(a) * r * 1.4); c.stroke(); }
    const gr = c.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r); gr.addColorStop(0, shade(color, 0.5)); gr.addColorStop(1, shade(color, -0.4));
    c.fillStyle = gr; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fill();
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
