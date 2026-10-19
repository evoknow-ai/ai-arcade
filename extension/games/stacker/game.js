// Stacker — falling tetrominoes. ←/→ move, ↑ rotate, ↓ soft drop, Space hard drop. Ghost piece,
// next-piece preview, line clears with combo bonus, speed rises with the level. H shows the AI's
// preferred placement; the same evaluator plays the attract mode.
const COLS = 10, ROWS = 20, CELL = 20, OX = 150, OY = 10, W = 460, H = 420;
const SHAPES = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]], O: [[1, 0], [2, 0], [1, 1], [2, 1]], T: [[0, 1], [1, 1], [2, 1], [1, 0]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]], Z: [[0, 0], [1, 0], [1, 1], [2, 1]], J: [[0, 0], [0, 1], [1, 1], [2, 1]], L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};
const KEYS = Object.keys(SHAPES);
const DIFFICULTY = {
  beginner:     { name: "Beginner",     start: 48, min: 12 },
  intermediate: { name: "Intermediate", start: 34, min: 6 },
  advanced:     { name: "Advanced",     start: 22, min: 3 },
};

export default function createStacker({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0;
  const g = { id: "stacker", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, hud };
  let grid, cur, next, bag, fall, fallEvery, lines, clearing, particles, popups, hint, hintTtl, msg, msgTtl, shake, das, plan, combo;

  function init(sh) {
    g.score = 0; g.level = 1; lines = 0; fallEvery = diff.start; fall = 0; clearing = null; particles = []; popups = []; bag = []; hint = null; hintTtl = 0; shake = 0; das = 0; plan = null; combo = 0;
    grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    next = draw(sh); spawn(sh);
  }
  function draw(sh) { if (!bag.length) { bag = [...KEYS]; for (let i = bag.length - 1; i > 0; i--) { const j = sh.rng.int(i + 1); [bag[i], bag[j]] = [bag[j], bag[i]]; } } return bag.pop(); }
  function spawn(sh) { cur = { k: next, cells: SHAPES[next].map(c => [...c]), x: 3, y: 0 }; next = draw(sh); plan = null; if (collides(cur.cells, cur.x, cur.y)) { say("Stacked out", 60); sh.end(); } }
  function collides(cells, x, y) { return cells.some(([cx, cy]) => { const gx = x + cx, gy = y + cy; return gx < 0 || gx >= COLS || gy >= ROWS || (gy >= 0 && grid[gy][gx]); }); }
  function rotated(cells, k) { if (k === "O") return cells; const size = k === "I" ? 4 : 3; return cells.map(([x, y]) => [size - 1 - y, x]); }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x, y, text, color, ttl: 60 }); }

  function onInput(action, sh) {
    if (clearing) return;
    if (action === "left" || action === "right") move(action === "left" ? -1 : 1, sh);
    if (action === "up") rotate(sh);
    if (action === "down") { if (!collides(cur.cells, cur.x, cur.y + 1)) { cur.y++; g.score += 1; } }
    if (action === "action") hardDrop(sh);
    if (action === "hint") { hint = bestPlacement(cur.k); hintTtl = 240; g.score = Math.max(0, g.score - 10); }
  }
  function move(d, sh) { if (!collides(cur.cells, cur.x + d, cur.y)) { cur.x += d; sh.audio.tone({ freq: 240, type: "square", dur: 0.02, vol: 0.05 }); } }
  function rotate(sh) { const r = rotated(cur.cells, cur.k); for (const kick of [0, -1, 1, -2, 2]) if (!collides(r, cur.x + kick, cur.y)) { cur.cells = r; cur.x += kick; sh.audio.blip(); return; } }
  function hardDrop(sh) { let n = 0; while (!collides(cur.cells, cur.x, cur.y + 1)) { cur.y++; n++; } g.score += n * 2; lock(sh); shake = 6; }
  function ghostY() { let y = cur.y; while (!collides(cur.cells, cur.x, y + 1)) y++; return y; }
  function lock(sh) {
    for (const [cx, cy] of cur.cells) if (cur.y + cy >= 0) grid[cur.y + cy][cur.x + cx] = cur.k;
    sh.audio.tone({ freq: 140, type: "triangle", dur: 0.08, vol: 0.1 });
    const full = []; for (let y = 0; y < ROWS; y++) if (grid[y].every(Boolean)) full.push(y);
    if (full.length) { clearing = { rows: full, t: 0 }; for (const y of full) for (let x = 0; x < COLS; x++) { const px = OX + x * CELL + CELL / 2, py = OY + y * CELL + CELL / 2; for (let i = 0; i < 3; i++) particles.push({ x: px, y: py, vx: (sh.rng.next() - 0.5) * 5, vy: -sh.rng.next() * 4, ttl: 25 + sh.rng.int(20), color: colorOf(grid[y][x]) }); } }
    else { combo = 0; spawn(sh); }
  }
  function finishClear(sh) {
    const n = clearing.rows.length;
    for (const y of clearing.rows) { grid.splice(y, 1); grid.unshift(Array(COLS).fill(null)); }
    combo++;
    const pts = [0, 100, 300, 500, 800][n] * g.level * (1 + (combo - 1) * 0.25) | 0;
    g.score += pts; lines += n; pop(OX + COLS * CELL / 2, OY + clearing.rows[0] * CELL, (n === 4 ? "STACKER! " : "") + "+" + pts, n === 4 ? T?.marquee : T?.cyan);
    sh.audio[n === 4 ? "levelUp" : "eat"]();
    const lvl = 1 + Math.floor(lines / 10);
    if (lvl !== g.level) { g.level = lvl; fallEvery = Math.max(diff.min, diff.start - (lvl - 1) * 4); say(`Level ${lvl}`, 80); sh.wallet?.earn(8 + lvl * 2); }
    clearing = null; spawn(sh);
  }
  // AI: try every rotation/column, score the resulting board
  function bestPlacement(k) {
    let cells = SHAPES[k].map(c => [...c]), best = null;
    for (let r = 0; r < 4; r++) {
      const minX = Math.min(...cells.map(c => c[0])), maxX = Math.max(...cells.map(c => c[0]));
      for (let x = -minX; x < COLS - maxX; x++) {
        if (collides(cells, x, 0)) continue;
        let y = 0; while (!collides(cells, x, y + 1)) y++;
        const sim = grid.map(row => [...row]); for (const [cx, cy] of cells) if (y + cy >= 0) sim[y + cy][x + cx] = k;
        let cleared = 0; for (let yy = 0; yy < ROWS; yy++) if (sim[yy].every(Boolean)) cleared++;
        let holes = 0, agg = 0, bump = 0, prev = -1, maxH = 0;
        for (let xx = 0; xx < COLS; xx++) { let h = 0, seen = false; for (let yy = 0; yy < ROWS; yy++) { if (sim[yy][xx]) { if (!seen) { h = ROWS - yy; seen = true; } } else if (seen) holes++; } agg += h; maxH = Math.max(maxH, h); if (prev >= 0) bump += Math.abs(h - prev); prev = h; }
        const score = cleared * 3.5 - holes * 7 - agg * 0.5 - bump * 0.35 - (maxH > 14 ? (maxH - 14) * 3 : 0);
        if (!best || score > best.score) best = { score, x, y, cells: cells.map(c => [...c]), r };
      }
      cells = rotated(cells, k);
    }
    return best;
  }
  function update(sh) {
    tick = sh.tick;
    if (msgTtl > 0) msgTtl--; if (shake > 0) shake--; if (hintTtl > 0 && --hintTtl === 0) hint = null;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.15; }
    popups = popups.filter(p => (p.ttl -= 1) > 0);
    if (clearing) { if (++clearing.t > 18) finishClear(sh); return; }
    // held keys: delayed auto shift
    const l = sh.input?.isDown?.("left"), r = sh.input?.isDown?.("right");
    if (l || r) { das++; if (das > 12 && das % 4 === 0) move(l ? -1 : 1, sh); } else das = 0;
    if (sh.input?.isDown?.("down") && tick % 3 === 0 && !collides(cur.cells, cur.x, cur.y + 1)) { cur.y++; g.score += 1; }
    if (g.autopilot) {
      if (!plan) plan = bestPlacement(cur.k);
      if (plan && tick % 6 === 0) {
        const rotNeeded = JSON.stringify(cur.cells) !== JSON.stringify(plan.cells);
        if (rotNeeded) rotate(sh); else if (cur.x < plan.x) move(1, sh); else if (cur.x > plan.x) move(-1, sh); else hardDrop(sh);
      }
    }
    if (++fall >= fallEvery) { fall = 0; if (!collides(cur.cells, cur.x, cur.y + 1)) cur.y++; else lock(sh); }
  }
  function hud() { return `${diff.name} · level ${g.level} · ${lines} lines · next ${next}`; }
  function colorOf(k) { return { I: T?.cyan, O: T?.marquee, T: "#B57BFF", S: "#4CD964", Z: T?.accent, J: "#4DA3FF", L: "#FFB454" }[k] || "#fff"; }

  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    c.save(); if (shake > 0) c.translate(0, (Math.random() - 0.5) * shake * 0.5);
    const bg = c.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.75); bg.addColorStop(0, T.bgGlow1); bg.addColorStop(1, T.bg);
    c.fillStyle = bg; c.fillRect(-10, -10, W + 20, H + 20);
    // well
    c.fillStyle = "#00000055"; rr(c, OX - 6, OY - 6, COLS * CELL + 12, ROWS * CELL + 12, 10); c.fill();
    c.fillStyle = T.board1; c.fillRect(OX, OY, COLS * CELL, ROWS * CELL);
    c.strokeStyle = "#ffffff08"; c.lineWidth = 1; for (let x = 1; x < COLS; x++) { c.beginPath(); c.moveTo(OX + x * CELL, OY); c.lineTo(OX + x * CELL, OY + ROWS * CELL); c.stroke(); } for (let y = 1; y < ROWS; y++) { c.beginPath(); c.moveTo(OX, OY + y * CELL); c.lineTo(OX + COLS * CELL, OY + y * CELL); c.stroke(); }
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (grid[y][x]) { const flash = clearing && clearing.rows.includes(y); cell(c, OX + x * CELL, OY + y * CELL, flash ? (clearing.t % 6 < 3 ? "#ffffff" : colorOf(grid[y][x])) : colorOf(grid[y][x]), 1); }
    if (!clearing) {
      const gy = ghostY(); for (const [cx, cy] of cur.cells) cell(c, OX + (cur.x + cx) * CELL, OY + (gy + cy) * CELL, colorOf(cur.k), 0.18);
      if (hint && hintTtl > 0) { c.globalAlpha = 0.35 + 0.3 * Math.sin(tick / 5); for (const [cx, cy] of hint.cells) { c.strokeStyle = T.marquee; c.lineWidth = 2; c.strokeRect(OX + (hint.x + cx) * CELL + 2, OY + (hint.y + cy) * CELL + 2, CELL - 4, CELL - 4); } c.globalAlpha = 1; }
      for (const [cx, cy] of cur.cells) if (cur.y + cy >= 0) cell(c, OX + (cur.x + cx) * CELL, OY + (cur.y + cy) * CELL, colorOf(cur.k), 1);
    }
    // side panels
    c.fillStyle = T.textDim; c.font = "12px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle";
    c.fillText("NEXT", 24, 24); for (const [cx, cy] of SHAPES[next]) cell(c, 24 + cx * 18, 40 + cy * 18, colorOf(next), 1, 18);
    c.fillText("LEVEL", 24, 130); c.fillStyle = "#fff"; c.font = "800 26px 'Chakra Petch',system-ui,sans-serif"; c.fillText(g.level, 24, 152);
    c.fillStyle = T.textDim; c.font = "12px system-ui,sans-serif"; c.fillText("LINES", 24, 190); c.fillStyle = "#fff"; c.font = "800 26px 'Chakra Petch',system-ui,sans-serif"; c.fillText(lines, 24, 212);
    c.fillStyle = T.textDim; c.font = "11px system-ui,sans-serif"; const rx = OX + COLS * CELL + 20; ["← → move", "↑ rotate", "↓ soft drop", "Space hard drop", "H hint"].forEach((t, i) => c.fillText(t, rx, 30 + i * 18));
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 15); c.fillStyle = p.color; c.fillRect(p.x, p.y, 3, 3); } c.globalAlpha = 1;
    for (const p of popups) { const k = 1 - p.ttl / 60; c.globalAlpha = Math.min(1, p.ttl / 15); c.fillStyle = p.color || "#fff"; c.font = "800 16px system-ui,sans-serif"; c.textAlign = "center"; c.shadowColor = "#000"; c.shadowBlur = 6; c.fillText(p.text, p.x, p.y - k * 24); c.shadowBlur = 0; } c.globalAlpha = 1;
    if (msgTtl > 0 && msg) { c.font = "800 24px 'Chakra Petch',system-ui,sans-serif"; c.textAlign = "center"; c.fillStyle = T.marquee; c.shadowColor = "#000"; c.shadowBlur = 10; c.globalAlpha = Math.min(1, msgTtl / 20); c.fillText(msg, OX + COLS * CELL / 2, OY + ROWS * CELL / 2); c.shadowBlur = 0; c.globalAlpha = 1; }
    c.restore();
  }
  function cell(c, x, y, color, alpha, size = CELL) {
    c.globalAlpha = alpha;
    const grd = c.createLinearGradient(x, y, x + size, y + size); grd.addColorStop(0, shade(color, 0.4)); grd.addColorStop(1, shade(color, -0.35));
    c.fillStyle = grd; rr(c, x + 1, y + 1, size - 2, size - 2, 4); c.fill();
    c.fillStyle = "#ffffff44"; rr(c, x + 3, y + 3, size - 6, 3, 2); c.fill();
    c.globalAlpha = 1;
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
