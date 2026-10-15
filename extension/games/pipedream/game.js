// PipeDream — lay pipe ahead of the flow.
// Features: level timer, start-now bonus, time bombs (defuse by routing flow into them before the fuse
// ends; otherwise they blow out nearby unfilled pipe), three fluids with different rules
// (water: baseline · oil: slow, heavy, pays 1.5x, shorter queue · gas: fast, accelerates until it
// passes a valve, pays 2x), reservoirs, rocks, cross pipes that can be used twice, and an AI hint.
// All randomness comes from shell.rng so runs are replayable.

const COLS = 9, ROWS = 7, CELL = 52, QUEUE_W = 76, TOP = 44, PAD = 10;
const W = QUEUE_W + COLS * CELL + PAD, H = TOP + ROWS * CELL + PAD;
const U = 0, R = 1, D = 2, L = 3;
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const OPP = [D, L, U, R];

// pipe shapes: which sides are open
const SHAPES = {
  h: [L, R], v: [U, D], ne: [U, R], nw: [U, L], se: [D, R], sw: [D, L], x: [U, R, D, L],
  valve_h: [L, R], valve_v: [U, D], res_h: [L, R], res_v: [U, D],
};
const QUEUE_POOL = ["h", "v", "ne", "nw", "se", "sw", "x", "h", "v", "ne", "nw", "se", "sw"];

const FLUIDS = {
  water: { name: "Water", color: "#4DE1F0", dark: "#1C8FA1", speed: 1.0, mult: 1, queue: 5, rule: "Standard flow." },
  oil:   { name: "Oil",   color: "#FFB454", dark: "#8A5A10", speed: 0.7, mult: 1.5, queue: 3, rule: "Slow and heavy. Pays 1.5×, but you only see 3 pieces ahead." },
  gas:   { name: "Gas",   color: "#B6FF5C", dark: "#4E8A12", speed: 1.3, mult: 2, queue: 5, rule: "Fast, and speeds up with every segment until it passes a valve. Pays 2×." },
};
const LEVEL_FLUID = ["water", "water", "oil", "water", "gas", "oil", "gas", "water", "gas", "oil"];

export default function createPipeDream({ autopilot = false } = {}) {
  const g = {
    id: "pipedream",
    tps: 60,
    size: { width: W, height: H },
    score: 0, level: 1,
    onPointer, onHover, onInput, init, update, render, hud,
    autopilot,
  };
  let board, queue, fluid, flow, countdown, levelTime, target, filledCount, hover, hintCell, hintOn, msg, msgTtl, shake, particles, gasPressure, pendingNextLevel;

  function init(shell) {
    g.score = 0; g.level = 1;
    hintOn = autopilot; particles = []; shake = 0;
    startLevel(shell);
  }

  function startLevel(shell) {
    const lvl = g.level;
    fluid = FLUIDS[LEVEL_FLUID[(lvl - 1) % LEVEL_FLUID.length]];
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    // source
    const sx = 1 + shell.rng.int(COLS - 2), sy = 1 + shell.rng.int(ROWS - 2);
    const sd = shell.rng.int(4);
    board[sy][sx] = { kind: "source", dir: sd, fill: 1 };
    // rocks
    for (let i = 0; i < Math.min(6, 1 + Math.floor(lvl / 2)); i++) placeRandom(shell, { kind: "rock" });
    // reservoirs
    for (let i = 0; i < (lvl >= 2 ? 1 + (lvl % 2) : 0); i++) placeRandom(shell, { kind: "pipe", shape: shell.rng.next() < 0.5 ? "res_h" : "res_v", fixed: true, fill: 0, fillA: 0, fillB: 0, slow: 3 });
    // valves (always some when gas, occasionally otherwise)
    const valves = fluid === FLUIDS.gas ? 3 : (lvl >= 4 ? 1 : 0);
    for (let i = 0; i < valves; i++) placeRandom(shell, { kind: "pipe", shape: shell.rng.next() < 0.5 ? "valve_h" : "valve_v", fixed: true, fill: 0, fillA: 0, fillB: 0, valve: true });
    // time bombs
    const bombs = lvl >= 2 ? Math.min(3, Math.floor(lvl / 2)) : 0;
    for (let i = 0; i < bombs; i++) placeRandom(shell, { kind: "bomb", fuse: (40 + shell.rng.int(30) - Math.min(20, lvl * 2)) * 60, fill: 0, fillA: 0, fillB: 0 });

    queue = []; while (queue.length < 5) queue.push(QUEUE_POOL[shell.rng.int(QUEUE_POOL.length)]);
    target = 8 + lvl * 2;
    filledCount = 0;
    countdown = Math.max(6, 16 - lvl) * 60;
    levelTime = 95 * 60;
    gasPressure = 0;
    flow = { x: sx, y: sy, dir: sd, progress: 0, active: false, cell: board[sy][sx], segTicks: segTicksFor() };
    hover = null; hintCell = null; pendingNextLevel = 0;
    say(`Level ${lvl} · ${fluid.name} · fill ${target} pipes`, 180);
  }

  function placeRandom(shell, tile) {
    for (let tries = 0; tries < 200; tries++) {
      const x = shell.rng.int(COLS), y = shell.rng.int(ROWS);
      if (board[y][x]) continue;
      // keep the cell in front of the source free
      const src = findSource(); if (src && x === src.x + DX[src.dir] && y === src.y + DY[src.dir]) continue;
      board[y][x] = tile; return;
    }
  }
  function findSource() { for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (board[y][x]?.kind === "source") return { x, y, dir: board[y][x].dir }; return null; }
  function segTicksFor() {
    let base = Math.max(14, 60 - g.level * 4) / fluid.speed;
    if (fluid === FLUIDS.gas) base /= (1 + gasPressure * 0.12);
    if (levelTime <= 0) base /= 3;
    return Math.max(5, Math.round(base));
  }
  function say(t, ttl) { msg = t; msgTtl = ttl; }

  // ---------- input ----------
  function onInput(action, shell) {
    if (action === "action") {
      if (!flow.active && countdown > 0) { g.score += Math.floor(countdown / 60) * 10; countdown = 0; say("Early start bonus", 60); }
    }
    if (action === "hint") { hintOn = !hintOn; say(hintOn ? "AI hint on" : "AI hint off", 60); }
  }
  function cellAt(px, py) {
    const x = Math.floor((px - QUEUE_W) / CELL), y = Math.floor((py - TOP) / CELL);
    return x >= 0 && y >= 0 && x < COLS && y < ROWS ? { x, y } : null;
  }
  function onHover(px, py) { hover = cellAt(px, py); }
  function onPointer(px, py, shell) {
    const c = cellAt(px, py);
    if (!c) return;
    shell.record(1000 + c.y * COLS + c.x);
    placeAt(c.x, c.y, shell);
  }
  function placeAt(x, y, shell) {
    const t = board[y][x];
    if (t && (t.kind !== "pipe" || t.fixed || t.fill > 0 || (t.fillA || 0) > 0 || (t.fillB || 0) > 0)) { shell.audio.hit(); return; }
    if (t === flow.cell) { shell.audio.hit(); return; }
    if (t) { g.score = Math.max(0, g.score - 50); say("Replaced a pipe −50", 45); }
    const shape = queue.shift();
    queue.push(QUEUE_POOL[shell.rng.int(QUEUE_POOL.length)]);
    board[y][x] = { kind: "pipe", shape, fill: 0, fillA: 0, fillB: 0 };
    shell.audio.blip();
  }

  // ---------- simulation ----------
  function update(shell) {
    if (msgTtl > 0) msgTtl--;
    if (shake > 0) shake--;
    particles = particles.filter(p => (p.ttl -= 1) > 0);
    for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.15; }

    if (pendingNextLevel > 0) { if (--pendingNextLevel === 0) { g.level++; shell.audio.levelUp(); startLevel(shell); } return; }

    if (g.autopilot && shell.tick % 3 === 0) autoPlace(shell);

    // bombs tick whenever the level is live
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = board[y][x];
      if (t?.kind === "bomb" && !t.defused && t.fuse > 0) { t.fuse--; if (t.fuse === 0) explode(x, y, shell); }
    }

    if (!flow.active) {
      if (countdown > 0) { countdown--; return; }
      flow.active = true; say("Flow started", 60);
    }
    if (levelTime > 0) { levelTime--; if (levelTime === 0) { say("Time's up — pressure rising", 120); flow.segTicks = segTicksFor(); } }

    flow.progress++;
    if (flow.progress < flow.segTicks) { updateFill(); return; }

    // segment finished → advance to next cell
    flow.progress = 0;
    if (flow.cell.kind === "pipe" || flow.cell.kind === "bomb") finishFill(flow.cell, flow.dir);
    const nx = flow.x + DX[flow.dir], ny = flow.y + DY[flow.dir];
    const t = nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS ? board[ny][nx] : null;
    const entry = OPP[flow.dir];
    if (!t || t.kind === "rock" || t.kind === "source" || (t.kind === "bomb" && t.exploded)) return flowEnds(shell, "spilled");
    let exit;
    if (t.kind === "bomb") {
      exit = flow.dir; // bombs pass straight through
      if (!t.defused) { t.defused = true; g.score += 200 * g.level; say("Bomb defused +" + 200 * g.level, 90); burst(nx, ny, "#FFD447", 24); shell.audio.levelUp(); }
    } else {
      const open = SHAPES[t.shape];
      if (!open.includes(entry)) return flowEnds(shell, "spilled");
      if (t.shape === "x") {
        const horiz = entry === L || entry === R;
        if ((horiz && t.fillA >= 1) || (!horiz && t.fillB >= 1)) return flowEnds(shell, "spilled");
        exit = OPP[entry];
        if ((horiz && t.fillB >= 1) || (!horiz && t.fillA >= 1)) { g.score += 100; say("Double cross +100", 45); }
      } else {
        if (t.fill >= 1) return flowEnds(shell, "spilled");
        exit = open[0] === entry ? open[1] : open[0];
      }
      if (t.valve) { gasPressure = 0; if (fluid === FLUIDS.gas) say("Valve: pressure released", 60); }
    }
    flow.x = nx; flow.y = ny; flow.dir = exit; flow.cell = t; flow.entry = entry;
    if (fluid === FLUIDS.gas && !t.valve) gasPressure++;
    flow.segTicks = segTicksFor() * (t.slow || 1);
    shell.audio.tone({ freq: 300 + filledCount * 12, type: "sine", dur: 0.05, vol: 0.08 });
  }

  function updateFill() {
    const t = flow.cell; if (t.kind === "source") return;
    const p = flow.progress / flow.segTicks;
    if (t.shape === "x") { if (flow.entry === L || flow.entry === R) t.fillA = p; else t.fillB = p; }
    else t.fill = p;
  }
  function finishFill(t) {
    if (t.shape === "x") { if (flow.entry === L || flow.entry === R) t.fillA = 1; else t.fillB = 1; } else t.fill = 1;
    filledCount++;
    g.score += Math.round(50 * fluid.mult * g.level + (t.slow ? 150 : 0));
  }
  function flowEnds(shell, why) {
    flow.active = false;
    if (filledCount >= target) {
      const bonus = 500 + Math.floor(levelTime / 60) * 10;
      g.score += bonus;
      say(`Level clear! +${bonus}`, 150);
      burst(flow.x, flow.y, fluid.color, 40);
      pendingNextLevel = 150;
      shell.audio.levelUp();
    } else {
      say(`Spilled at ${filledCount}/${target}`, 120);
      burst(flow.x, flow.y, fluid.color, 30);
      shake = 20;
      shell.end();
    }
  }
  function explode(bx, by, shell) {
    const b = board[by][bx]; b.exploded = true;
    for (let y = by - 1; y <= by + 1; y++) for (let x = bx - 1; x <= bx + 1; x++) {
      if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
      const t = board[y][x];
      if (t?.kind === "pipe" && !t.fixed && t.fill === 0 && !t.fillA && !t.fillB && t !== flow.cell) board[y][x] = null;
    }
    board[by][bx] = { kind: "rock", scorched: true };
    burst(bx, by, "#FF5C8A", 50); shake = 25; shell.audio.hit();
    say("Bomb went off", 90);
  }
  function burst(cx, cy, color, n) {
    const px = QUEUE_W + cx * CELL + CELL / 2, py = TOP + cy * CELL + CELL / 2;
    for (let i = 0; i < n; i++) particles.push({ x: px, y: py, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.8) * 6, ttl: 30 + Math.random() * 30, color });
  }

  // ---------- AI hint / autopilot ----------
  // Where will the flow exit next? Suggest the cell that keeps it alive longest for the next piece.
  function computeHint() {
    const next = queue[0]; if (!next) return null;
    let x = flow.x, y = flow.y, dir = flow.dir;
    // walk along already-valid pipe to the first gap
    for (let guard = 0; guard < COLS * ROWS; guard++) {
      const nx = x + DX[dir], ny = y + DY[dir];
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return null;
      const t = board[ny][nx], entry = OPP[dir];
      const replaceable = t?.kind === "pipe" && !t.fixed && t.fill === 0 && !t.fillA && !t.fillB;
      const deadThrough = replaceable && SHAPES[t.shape].includes(entry) && !exitOk(nx, ny, t.shape === "x" ? OPP[entry] : (SHAPES[t.shape][0] === entry ? SHAPES[t.shape][1] : SHAPES[t.shape][0]));
      if (!t || (replaceable && (!SHAPES[t.shape].includes(entry) || deadThrough))) {
        // candidate cell: does the next piece accept the entry?
        if (!SHAPES[next].includes(entry)) return null;
        const open = SHAPES[next];
        const exit = next === "x" ? OPP[entry] : (open[0] === entry ? open[1] : open[0]);
        if (!exitOk(nx, ny, exit)) return null; // would spill straight away — better to dump this piece
        return { x: nx, y: ny, score: freeRun(nx, ny, exit) };
      }
      if (t.kind === "rock" || t.kind === "source") return null;
      if (t.kind === "bomb") { x = nx; y = ny; continue; }
      const open = SHAPES[t.shape];
      if (!open.includes(entry)) return null;
      dir = t.shape === "x" ? OPP[entry] : (open[0] === entry ? open[1] : open[0]);
      x = nx; y = ny;
    }
    return null;
  }
  function exitOk(x, y, dir) {
    const nx = x + DX[dir], ny = y + DY[dir];
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return false;
    const t = board[ny][nx];
    if (!t || t.kind === "bomb") return true;
    if (t.kind === "rock" || t.kind === "source") return false;
    const accepts = SHAPES[t.shape].includes(OPP[dir]) && (t.shape === "x" ? ((OPP[dir] === L || OPP[dir] === R) ? t.fillA < 1 : t.fillB < 1) : t.fill < 1);
    if (accepts) return true;
    return !t.fixed && t.fill === 0 && !t.fillA && !t.fillB; // replaceable
  }
  function freeRun(x, y, dir) { let n = 0; for (;;) { x += DX[dir]; y += DY[dir]; if (x < 0 || y < 0 || x >= COLS || y >= ROWS || board[y][x]?.kind === "rock") return n; n++; } }
  function autoPlace(shell) {
    const h = computeHint();
    if (h) { placeAt(h.x, h.y, shell); return; }
    // piece doesn't fit: cycle it out by dumping it somewhere harmless (far from the flow head).
    // Cycle slowly while the countdown runs, fast once the flow is live.
    if (shell.tick % (flow.active ? 18 : 120) !== 0) return;
    let best = null;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = board[y][x];
      if (t && !(t.kind === "pipe" && !t.fixed && t.fill === 0 && !t.fillA && !t.fillB && t !== flow.cell)) continue;
      const d = Math.abs(x - flow.x) + Math.abs(y - flow.y) + (x === flow.x || y === flow.y ? -2 : 0) + (t ? -100 : 0);
      if (!best || d > best.d) best = { x, y, d };
    }
    if (best) placeAt(best.x, best.y, shell);
  }

  function hud() {
    const t = Math.ceil(levelTime / 60);
    return `${fluid.name} · ${filledCount}/${target} pipes · ${t}s` + (fluid === FLUIDS.gas ? ` · pressure ${gasPressure}` : "") + (hintOn ? " · hint on" : " · H for hint");
  }

  // ---------- render ----------
  function render(c, shell) {
    hintCell = hintOn ? computeHint() : null;
    c.save();
    if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.6, (Math.random() - 0.5) * shake * 0.6);
    c.fillStyle = "#1B1540"; c.fillRect(-10, -10, W + 20, H + 20);

    // top bar
    c.fillStyle = "#F4EFE6"; c.font = "700 15px system-ui,sans-serif"; c.textBaseline = "middle"; c.textAlign = "left";
    c.fillText(`Level ${g.level}`, QUEUE_W, TOP / 2);
    c.fillStyle = fluid.color; c.fillText(fluid.name, QUEUE_W + 70, TOP / 2);
    c.fillStyle = "#B9B3C9"; c.font = "13px system-ui,sans-serif";
    c.fillText(fluid.rule, QUEUE_W + 70 + c.measureText(fluid.name).width + 24, TOP / 2);
    // level timer bar
    const barW = COLS * CELL; c.fillStyle = "#2A2260"; c.fillRect(QUEUE_W, TOP - 6, barW, 3);
    c.fillStyle = levelTime < 15 * 60 ? "#FF5C8A" : "#4DE1F0"; c.fillRect(QUEUE_W, TOP - 6, barW * levelTime / (95 * 60), 3);

    // queue
    c.fillStyle = "#2A2260"; rr(c, PAD, TOP, QUEUE_W - PAD * 2, ROWS * CELL, 8); c.fill();
    c.fillStyle = "#B9B3C9"; c.font = "12px system-ui,sans-serif"; c.textAlign = "center";
    c.fillText("next", QUEUE_W / 2, TOP + 12);
    const visible = Math.min(queue.length, fluid.queue);
    for (let i = 0; i < visible; i++) {
      const qx = QUEUE_W / 2 - CELL / 2 + 2, qy = TOP + 22 + i * (CELL + 2);
      if (i === 0) { c.fillStyle = "#3A3078"; rr(c, qx - 2, qy - 2, CELL, CELL, 6); c.fill(); }
      drawPipe(c, qx, qy, { kind: "pipe", shape: queue[i], fill: 0, fillA: 0, fillB: 0 }, CELL - 4, 1);
    }

    // board
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const px = QUEUE_W + x * CELL, py = TOP + y * CELL;
      c.fillStyle = (x + y) % 2 ? "#221B52" : "#1F184B"; c.fillRect(px, py, CELL, CELL);
      const t = board[y][x];
      if (!t) continue;
      if (t.kind === "rock") { c.fillStyle = t.scorched ? "#3B2A33" : "#3A3078"; rr(c, px + 5, py + 5, CELL - 10, CELL - 10, 10); c.fill(); if (t.scorched) { c.fillStyle = "#1B1540"; c.beginPath(); c.arc(px + CELL / 2, py + CELL / 2, 8, 0, 7); c.fill(); } continue; }
      if (t.kind === "source") { drawSource(c, px, py, t); continue; }
      if (t.kind === "bomb") { drawBomb(c, px, py, t); continue; }
      drawPipe(c, px, py, t, CELL, 1);
    }
    // hover preview
    if (hover && queue[0]) {
      const t = board[hover.y][hover.x];
      const can = !t || (t.kind === "pipe" && !t.fixed && t.fill === 0 && !t.fillA && !t.fillB && t !== flow.cell);
      const px = QUEUE_W + hover.x * CELL, py = TOP + hover.y * CELL;
      c.globalAlpha = 0.45; if (can) drawPipe(c, px, py, { kind: "pipe", shape: queue[0], fill: 0, fillA: 0, fillB: 0 }, CELL, 1); c.globalAlpha = 1;
      c.strokeStyle = can ? "#F4EFE6" : "#FF5C8A"; c.lineWidth = 2; c.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2);
    }
    // hint
    if (hintCell) {
      const px = QUEUE_W + hintCell.x * CELL, py = TOP + hintCell.y * CELL;
      const pulse = 0.5 + 0.5 * Math.sin(shell.tick / 6);
      c.strokeStyle = `rgba(255,212,71,${0.4 + pulse * 0.6})`; c.lineWidth = 3; rr(c, px + 3, py + 3, CELL - 6, CELL - 6, 6); c.stroke();
    }
    // particles
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 20); c.fillStyle = p.color; c.fillRect(p.x, p.y, 3, 3); }
    c.globalAlpha = 1;

    // countdown
    if (!flow.active && countdown > 0 && pendingNextLevel === 0) {
      const s = Math.ceil(countdown / 60);
      c.fillStyle = "rgba(27,21,64,0.55)"; c.fillRect(QUEUE_W, TOP, COLS * CELL, ROWS * CELL);
      c.textAlign = "center"; c.fillStyle = "#FFD447"; c.font = "800 64px 'Avenir Next Condensed','Arial Narrow',sans-serif";
      c.fillText(s, QUEUE_W + COLS * CELL / 2, TOP + ROWS * CELL / 2 - 10);
      c.fillStyle = "#F4EFE6"; c.font = "14px system-ui,sans-serif";
      c.fillText("Flow starts soon. Space to start now for a bonus.", QUEUE_W + COLS * CELL / 2, TOP + ROWS * CELL / 2 + 34);
    }
    // message
    if (msgTtl > 0 && msg) {
      c.textAlign = "center"; c.font = "700 16px system-ui,sans-serif";
      c.fillStyle = "#1B1540"; const tw = c.measureText(msg).width + 24;
      rr(c, QUEUE_W + COLS * CELL / 2 - tw / 2, H - PAD - 30, tw, 26, 13); c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
      c.fillStyle = "#FFD447"; c.fillText(msg, QUEUE_W + COLS * CELL / 2, H - PAD - 17);
    }
    c.restore();
  }

  function drawSource(c, px, py, t) {
    c.fillStyle = "#3A3078"; rr(c, px + 4, py + 4, CELL - 8, CELL - 8, 8); c.fill();
    const cx = px + CELL / 2, cy = py + CELL / 2;
    c.strokeStyle = fluid.color; c.lineWidth = 14; c.lineCap = "butt";
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + DX[t.dir] * CELL / 2, cy + DY[t.dir] * CELL / 2); c.stroke();
    c.fillStyle = fluid.color; c.beginPath(); c.arc(cx, cy, 11, 0, 7); c.fill();
    c.fillStyle = "#1B1540"; c.beginPath(); c.arc(cx, cy, 5, 0, 7); c.fill();
  }
  function drawBomb(c, px, py, t) {
    const cx = px + CELL / 2, cy = py + CELL / 2;
    // passes straight through in any axis: draw a cross frame
    c.strokeStyle = "#5A4F9A"; c.lineWidth = 16; c.beginPath(); c.moveTo(px, cy); c.lineTo(px + CELL, cy); c.moveTo(cx, py); c.lineTo(cx, py + CELL); c.stroke();
    if (t.defused) { c.strokeStyle = fluid.color; c.lineWidth = 8; c.beginPath(); c.moveTo(px, cy); c.lineTo(px + CELL, cy); c.moveTo(cx, py); c.lineTo(cx, py + CELL); c.stroke(); }
    c.fillStyle = t.defused ? "#4DE1F0" : "#FF5C8A"; c.beginPath(); c.arc(cx, cy, 14, 0, 7); c.fill();
    c.fillStyle = "#1B1540"; c.font = "800 13px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(t.defused ? "✓" : String(Math.ceil(t.fuse / 60)), cx, cy + 1);
  }
  function drawPipe(c, px, py, t, size, alpha) {
    const cx = px + size / 2, cy = py + size / 2, half = size / 2;
    const open = SHAPES[t.shape];
    const wall = t.valve ? "#B9B3C9" : t.slow ? "#7A68C8" : "#5A4F9A";
    c.lineCap = "butt"; c.strokeStyle = wall; c.lineWidth = size * 0.32;
    if (t.shape === "x") {
      c.beginPath(); c.moveTo(px, cy); c.lineTo(px + size, cy); c.moveTo(cx, py); c.lineTo(cx, py + size); c.stroke();
      c.strokeStyle = "#2A2260"; c.lineWidth = size * 0.2; c.beginPath(); c.moveTo(cx, py); c.lineTo(cx, py + size); c.stroke();
      c.strokeStyle = wall; c.lineWidth = size * 0.32; c.beginPath(); c.moveTo(cx, py); c.lineTo(cx, py + size); c.stroke();
      fillSeg(c, cx, cy, half, L, R, t.fillA, flow.entry === R && t === flow.cell ? R : L);
      fillSeg(c, cx, cy, half, U, D, t.fillB, flow.entry === D && t === flow.cell ? D : U);
    } else {
      c.beginPath();
      for (const d of open) { c.moveTo(cx, cy); c.lineTo(cx + DX[d] * half, cy + DY[d] * half); }
      c.stroke();
      c.lineJoin = "round"; c.beginPath(); c.arc(cx, cy, size * 0.16, 0, 7); c.fillStyle = wall; c.fill();
      if (t.slow) { c.fillStyle = "#2A2260"; c.beginPath(); c.arc(cx, cy, size * 0.28, 0, 7); c.fill(); c.strokeStyle = wall; c.lineWidth = 3; c.stroke(); }
      if (t.valve) { c.fillStyle = "#FFD447"; c.beginPath(); c.arc(cx, cy, size * 0.14, 0, 7); c.fill(); }
      const entry = t === flow.cell ? flow.entry : open[0];
      fillSeg(c, cx, cy, half, open[0], open[1], t.fill, entry);
    }
  }
  // draw liquid from `entry` side toward the other side, progress p
  function fillSeg(c, cx, cy, half, a, b, p, entry) {
    if (!p) return;
    const from = entry, to = entry === a ? b : a;
    c.strokeStyle = fluid.color; c.lineWidth = half * 0.36; c.lineCap = "butt";
    c.beginPath();
    if (p <= 0.5) {
      const k = p / 0.5;
      c.moveTo(cx + DX[from] * half, cy + DY[from] * half); c.lineTo(cx + DX[from] * half * (1 - k), cy + DY[from] * half * (1 - k));
    } else {
      const k = (p - 0.5) / 0.5;
      c.moveTo(cx + DX[from] * half, cy + DY[from] * half); c.lineTo(cx, cy);
      c.lineTo(cx + DX[to] * half * k, cy + DY[to] * half * k);
    }
    c.stroke();
    c.fillStyle = fluid.color; if (p > 0.5) { c.beginPath(); c.arc(cx, cy, half * 0.18, 0, 7); c.fill(); }
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  return g;
}
