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
  timer: [U, R, D, L], // Timer Block: passes straight through, but holds the fluid for 5–30 s first
  magic: [U, R, D, L], // Magic Block: accepts from any side, then routes itself toward a connected pipe at random
};

// Difficulty shapes the whole run: flow speed, countdown, how early bombs/rocks appear, target size,
// how often a Magic Block shows up in the queue.
const DIFFICULTY = {
  beginner:     { name: "Beginner",     speed: 0.55, countdown: 8,  levelTime: 120, bombsFrom: 4, rocks: 0.5, target: 6, magic: 0.14, timer: 0.08, queue: 5 },
  intermediate: { name: "Intermediate", speed: 1.0,  countdown: 0,  levelTime: 95,  bombsFrom: 2, rocks: 1.0, target: 8, magic: 0.08, timer: 0.06, queue: 5 },
  advanced:     { name: "Advanced",     speed: 1.6,  countdown: -4, levelTime: 75,  bombsFrom: 1, rocks: 1.6, target: 10, magic: 0.05, timer: 0.05, queue: 4 },
};
const QUEUE_POOL = ["h", "v", "ne", "nw", "se", "sw", "x", "h", "v", "ne", "nw", "se", "sw"];

const FLUIDS = {
  water: { key: "water", name: "Water", speed: 1.0, mult: 1, queue: 5, rule: "Standard flow." },
  oil:   { key: "oil",   name: "Oil",   speed: 0.7, mult: 1.5, queue: 3, rule: "Slow and heavy. Pays 1.5×, but you only see 3 pieces ahead." },
  gas:   { key: "gas",   name: "Gas",   speed: 1.3, mult: 2, queue: 5, rule: "Fast, and speeds up with every segment until it passes a valve. Pays 2×." },
};
const LEVEL_FLUID = ["water", "water", "oil", "water", "gas", "oil", "gas", "water", "gas", "oil"];

export default function createPipeDream({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null; // theme, refreshed each frame from shell.theme
  const fc = () => (T?.fluids?.[fluid.key]) || "#4DE1F0";
  const g = {
    id: "pipedream",
    tps: 60,
    size: { width: W, height: H },
    score: 0, level: 1,
    onPointer, onHover, onInput, init, update, render, hud,
    autopilot,
  };
  let board, queue, fluid, flow, countdown, levelTime, target, filledCount, hover, hintCell, hintOn, msg, msgTtl, shake, particles, popups, gasPressure, pendingNextLevel;

  function init(shell) {
    g.score = 0; g.level = 1;
    hintOn = autopilot; particles = []; popups = []; shake = 0;
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
    for (let i = 0; i < Math.min(8, Math.round((1 + Math.floor(lvl / 2)) * diff.rocks)); i++) placeRandom(shell, { kind: "rock" });
    // reservoirs
    for (let i = 0; i < (lvl >= 2 ? 1 + (lvl % 2) : 0); i++) placeRandom(shell, { kind: "pipe", shape: shell.rng.next() < 0.5 ? "res_h" : "res_v", fixed: true, fill: 0, fillA: 0, fillB: 0, slow: 3 });
    // valves (always some when gas, occasionally otherwise)
    const valves = fluid === FLUIDS.gas ? 3 : (lvl >= 4 ? 1 : 0);
    for (let i = 0; i < valves; i++) placeRandom(shell, { kind: "pipe", shape: shell.rng.next() < 0.5 ? "valve_h" : "valve_v", fixed: true, fill: 0, fillA: 0, fillB: 0, valve: true });
    // time bombs
    const bombs = lvl >= diff.bombsFrom ? Math.min(3, 1 + Math.floor((lvl - diff.bombsFrom) / 2)) : 0;
    for (let i = 0; i < bombs; i++) placeRandom(shell, { kind: "bomb", fuse: (40 + shell.rng.int(30) - Math.min(20, lvl * 2)) * 60, fill: 0, fillA: 0, fillB: 0 });

    queue = []; while (queue.length < 5) queue.push(drawPiece(shell));
    target = diff.target + lvl * 2;
    filledCount = 0;
    countdown = Math.max(5, 16 - lvl + diff.countdown) * 60;
    levelTime = diff.levelTime * 60;
    gasPressure = 0;
    flow = { x: sx, y: sy, dir: sd, progress: 0, active: false, cell: board[sy][sx], segTicks: segTicksFor() };
    hover = null; hintCell = null; pendingNextLevel = 0;
    say(`Level ${lvl} · ${fluid.name} · fill ${target} pipes`, 180);
  }

  const HOLDS = [5, 10, 15, 20, 30];
  // queue entries are shape strings; a timer piece is "timer:<seconds>"
  function drawPiece(shell) {
    const r = shell.rng.next();
    if (r < diff.magic) return "magic";
    if (r < diff.magic + diff.timer) return "timer:" + HOLDS[shell.rng.int(HOLDS.length)];
    return QUEUE_POOL[shell.rng.int(QUEUE_POOL.length)];
  }
  function tileFromPiece(piece) {
    if (piece.startsWith("timer:")) { const secs = +piece.slice(6); return { kind: "pipe", shape: "timer", hold: secs, holdLeft: secs * 60, fill: 0, fillA: 0, fillB: 0 }; }
    return { kind: "pipe", shape: piece, fill: 0, fillA: 0, fillB: 0 };
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
    let base = Math.max(14, 60 - g.level * 4) / fluid.speed / diff.speed;
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
    const piece = queue.shift();
    queue.push(drawPiece(shell));
    board[y][x] = tileFromPiece(piece);
    shell.audio.blip();
  }

  // ---------- simulation ----------
  function update(shell) {
    if (msgTtl > 0) msgTtl--;
    if (shake > 0) shake--;
    particles = particles.filter(p => (p.ttl -= 1) > 0);
    popups = popups.filter(p => (p.ttl -= 1) > 0);
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

    // Timer Block: fill to the center, then hold until the timer runs out
    const cell = flow.cell;
    if (cell.shape === "timer" && cell.holdLeft > 0 && flow.progress >= Math.floor(flow.segTicks / 2)) {
      cell.holdLeft--;
      if (cell.holdLeft === 0) { g.score += cell.hold * 10; say(`Timer released +${cell.hold * 10}`, 60); pop(flow.x, flow.y, "+" + cell.hold * 10, T?.marquee || "#FFD447"); shell.audio.levelUp(); }
      else if (cell.holdLeft % 60 === 0) shell.audio.tone({ freq: 700, type: "triangle", dur: 0.04, vol: 0.06 });
      flow.progress = Math.floor(flow.segTicks / 2); updateFill(); return;
    }
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
      if (!t.defused) { t.defused = true; g.score += 200 * g.level; say("Bomb defused +" + 200 * g.level, 90); pop(nx, ny, "+" + 200 * g.level, T?.marquee || "#FFD447"); burst(nx, ny, T?.marquee || "#FFD447", 24); shell.audio.levelUp(); }
    } else {
      const open = SHAPES[t.shape];
      if (!open.includes(entry)) return flowEnds(shell, "spilled");
      if (t.shape === "x") {
        const horiz = entry === L || entry === R;
        if ((horiz && t.fillA >= 1) || (!horiz && t.fillB >= 1)) return flowEnds(shell, "spilled");
        exit = OPP[entry];
        if ((horiz && t.fillB >= 1) || (!horiz && t.fillA >= 1)) { g.score += 100; say("Double cross +100", 45); pop(nx, ny, "+100", T?.marquee || "#FFD447"); }
        if (horiz) t.inA = entry; else t.inB = entry;
      } else if (t.shape === "timer") {
        if (t.fill >= 1) return flowEnds(shell, "spilled");
        exit = OPP[entry]; t.in = entry; t.out = exit;
        say(`Timer block: holding for ${t.hold}s`, 90);
      } else if (t.shape === "timer") {
      c.beginPath(); for (const d of open) { c.moveTo(cx, cy); c.lineTo(cx + DX[d] * half, cy + DY[d] * half); } c.stroke();
      if (t.fill && t.in != null) fillSeg(c, cx, cy, half, t.in, t.out, t.fill);
      // the clock: a dial that drains as it holds the fluid
      const r = size * 0.3, frac = t.holdLeft / (t.hold * 60);
      c.fillStyle = T.surface; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fill();
      c.strokeStyle = T.pipeDark; c.lineWidth = 2; c.stroke();
      c.strokeStyle = t.holdLeft > 0 ? T.marquee : fc(); c.lineWidth = size * 0.07;
      c.beginPath(); c.arc(cx, cy, r - size * 0.06, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (t.holdLeft > 0 ? frac : 1)); c.stroke();
      const holding = t === flow.cell && t.holdLeft > 0 && t.fill >= 0.5;
      if (holding) { const pulse = 0.5 + 0.5 * Math.sin((shell?.tick || 0) / 4); c.globalAlpha = 0.35 * pulse; c.fillStyle = T.marquee; c.beginPath(); c.arc(cx, cy, r + 3, 0, 7); c.fill(); c.globalAlpha = 1; }
      c.fillStyle = T.text; c.font = `800 ${Math.round(size * 0.24)}px system-ui,sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(t.holdLeft > 0 ? String(Math.ceil(t.holdLeft / 60)) : "✓", cx, cy + 1);
    } else if (t.shape === "magic") {
        if (t.fill >= 1) return flowEnds(shell, "spilled");
        exit = magicRoute(nx, ny, entry, shell);
        t.in = entry; t.out = exit;
        g.score += 75; say("Magic block routes the flow +75", 60); pop(nx, ny, "+75", T?.marquee || "#FFD447"); burst(nx, ny, T?.marquee || "#FFD447", 18);
      } else {
        if (t.fill >= 1) return flowEnds(shell, "spilled");
        exit = open[0] === entry ? open[1] : open[0];
        t.in = entry; t.out = exit;
      }
      if (t.valve) { gasPressure = 0; if (fluid === FLUIDS.gas) say("Valve: pressure released", 60); }
    }
    flow.x = nx; flow.y = ny; flow.dir = exit; flow.cell = t; flow.entry = entry;
    if (fluid === FLUIDS.gas && !t.valve) gasPressure++;
    flow.segTicks = segTicksFor() * (t.slow || 1);
    shell.audio.tone({ freq: 300 + filledCount * 12, type: "sine", dur: 0.05, vol: 0.08 });
  }

  // Magic Block: pick, at random, one of the sides that leads into a pipe that can take the flow;
  // if nothing is connected yet, pick any side that isn't a wall or a rock.
  function magicRoute(x, y, entry, shell) {
    const connected = [], open = [];
    for (const d of [U, R, D, L]) {
      if (d === entry) continue;
      const nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const n = board[ny][nx];
      if (n?.kind === "rock" || n?.kind === "source") continue;
      open.push(d);
      if (!n) continue;
      if (n.kind === "bomb") { connected.push(d); continue; }
      const e = OPP[d];
      const ok = SHAPES[n.shape].includes(e) && (n.shape === "x" ? ((e === L || e === R) ? n.fillA < 1 : n.fillB < 1) : n.fill < 1);
      if (ok) connected.push(d);
    }
    const pool = connected.length ? connected : open.length ? open : [OPP[entry]];
    return pool[shell.rng.int(pool.length)];
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
    const pts = Math.round(50 * fluid.mult * g.level + (t.slow ? 150 : 0));
    g.score += pts; pop(flow.x, flow.y, "+" + pts, fc());
  }
  function pop(cx, cy, text, color) {
    popups.push({ x: QUEUE_W + cx * CELL + CELL / 2, y: TOP + cy * CELL + CELL / 2 - 6, text, color, ttl: 55 });
  }
  function flowEnds(shell, why) {
    flow.active = false;
    if (filledCount >= target) {
      const bonus = 500 + Math.floor(levelTime / 60) * 10;
      g.score += bonus;
      say(`Level clear! +${bonus}`, 150);
      burst(flow.x, flow.y, fc(), 40);
      pendingNextLevel = 150;
      shell.audio.levelUp();
    } else {
      say(`Spilled at ${filledCount}/${target}`, 120);
      burst(flow.x, flow.y, fc(), 30);
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
    burst(bx, by, T?.accent || "#FF5C8A", 50); shake = 25; shell.audio.hit();
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
        const nshape = next.startsWith("timer:") ? "timer" : next;
        if (!SHAPES[nshape].includes(entry)) return null;
        const open = SHAPES[nshape];
        const exit = (nshape === "x" || nshape === "timer") ? OPP[entry] : nshape === "magic" ? OPP[entry] : (open[0] === entry ? open[1] : open[0]);
        if (!exitOk(nx, ny, exit)) return null; // would spill straight away — better to dump this piece
        return { x: nx, y: ny, score: freeRun(nx, ny, exit) };
      }
      if (t.kind === "rock" || t.kind === "source") return null;
      if (t.kind === "bomb") { x = nx; y = ny; continue; }
      if (t.shape === "magic") { if (t.fill >= 1 && t.out != null) { dir = t.out; x = nx; y = ny; continue; } return null; }
      if (t.shape === "timer") { x = nx; y = ny; continue; }
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
    return `${diff.name} · ${fluid.name} · ${filledCount}/${target} pipes · ${t}s` + (fluid === FLUIDS.gas ? ` · pressure ${gasPressure}` : "") + (hintOn ? " · hint on" : "");
  }

  // ---------- render ----------
  let tickNow = 0;
  function render(c, shell) {
    T = shell.theme; tickNow = shell.tick || 0;
    hintCell = hintOn ? computeHint() : null;
    c.save();
    if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.6, (Math.random() - 0.5) * shake * 0.6);
    // backdrop with a soft glow behind the board
    c.fillStyle = T.bg; c.fillRect(-10, -10, W + 20, H + 20);
    const grad = c.createRadialGradient(QUEUE_W + COLS * CELL / 2, TOP + ROWS * CELL / 2, 40, QUEUE_W + COLS * CELL / 2, TOP + ROWS * CELL / 2, COLS * CELL * 0.8);
    grad.addColorStop(0, T.bgGlow1); grad.addColorStop(1, T.bg);
    c.fillStyle = grad; c.fillRect(0, 0, W, H);

    // top bar
    c.fillStyle = T.text; c.font = "700 15px system-ui,sans-serif"; c.textBaseline = "middle"; c.textAlign = "left";
    c.fillText(`Level ${g.level}`, QUEUE_W, TOP / 2);
    c.fillStyle = fc(); c.fillText(fluid.name, QUEUE_W + 70, TOP / 2);
    c.fillStyle = T.textDim; c.font = "13px system-ui,sans-serif";
    c.fillText(fluid.rule, QUEUE_W + 70 + c.measureText(fluid.name).width + 24, TOP / 2);
    // level timer bar
    const barW = COLS * CELL; c.fillStyle = T.surface2; c.fillRect(QUEUE_W, TOP - 6, barW, 3);
    c.fillStyle = levelTime < 15 * 60 ? T.accent : T.cyan; c.fillRect(QUEUE_W, TOP - 6, barW * levelTime / (diff.levelTime * 60), 3);

    // queue
    c.fillStyle = T.surface; rr(c, PAD, TOP, QUEUE_W - PAD * 2, ROWS * CELL, 8); c.fill();
    c.fillStyle = T.textDim; c.font = "12px system-ui,sans-serif"; c.textAlign = "center";
    c.fillText("next", QUEUE_W / 2, TOP + 12);
    const visible = Math.min(queue.length, fluid.queue, diff.queue);
    for (let i = 0; i < visible; i++) {
      const qx = QUEUE_W / 2 - CELL / 2 + 2, qy = TOP + 22 + i * (CELL + 2);
      if (i === 0) { c.fillStyle = T.surface3; rr(c, qx - 2, qy - 2, CELL, CELL, 6); c.fill(); }
      drawPipe(c, qx, qy, tileFromPiece(queue[i]), CELL - 4, shell);
    }

    // board
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const px = QUEUE_W + x * CELL, py = TOP + y * CELL;
      c.fillStyle = (x + y) % 2 ? T.board2 : T.board1; c.fillRect(px, py, CELL, CELL);
      c.fillStyle = "#ffffff07"; c.fillRect(px, py, CELL, 1); c.fillRect(px, py, 1, CELL);
      c.fillStyle = "#00000022"; c.fillRect(px, py + CELL - 1, CELL, 1); c.fillRect(px + CELL - 1, py, 1, CELL);
      const t = board[y][x];
      if (!t) continue;
      if (t.kind === "rock") {
        c.fillStyle = "#00000055"; rr(c, px + 7, py + 8, CELL - 10, CELL - 10, 10); c.fill();
        const rg = c.createRadialGradient(px + CELL * 0.35, py + CELL * 0.3, 4, px + CELL / 2, py + CELL / 2, CELL * 0.7);
        rg.addColorStop(0, shade(t.scorched ? "#3A2A32" : T.rock, 0.35)); rg.addColorStop(1, shade(t.scorched ? "#2A1E24" : T.rock, -0.35));
        c.fillStyle = rg; rr(c, px + 5, py + 5, CELL - 10, CELL - 10, 10); c.fill();
        if (t.scorched) { c.fillStyle = T.bg; c.beginPath(); c.arc(px + CELL / 2, py + CELL / 2, 8, 0, 7); c.fill(); }
        continue;
      }
      if (t.kind === "source") { drawSource(c, px, py, t); continue; }
      if (t.kind === "bomb") { drawBomb(c, px, py, t); continue; }
      drawPipe(c, px, py, t, CELL, shell);
    }
    // hover preview
    if (hover && queue[0]) {
      const t = board[hover.y][hover.x];
      const can = !t || (t.kind === "pipe" && !t.fixed && t.fill === 0 && !t.fillA && !t.fillB && t !== flow.cell);
      const px = QUEUE_W + hover.x * CELL, py = TOP + hover.y * CELL;
      c.globalAlpha = 0.45; if (can) drawPipe(c, px, py, tileFromPiece(queue[0]), CELL, shell); c.globalAlpha = 1;
      c.strokeStyle = can ? T.text : T.accent; c.lineWidth = 2; c.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2);
    }
    // hint
    if (hintCell) {
      const px = QUEUE_W + hintCell.x * CELL, py = TOP + hintCell.y * CELL;
      const pulse = 0.5 + 0.5 * Math.sin(shell.tick / 6);
      c.globalAlpha = 0.4 + pulse * 0.6; c.strokeStyle = T.hint; c.lineWidth = 3; rr(c, px + 3, py + 3, CELL - 6, CELL - 6, 6); c.stroke(); c.globalAlpha = 1;
    }
    // particles
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 20); c.fillStyle = p.color; c.shadowColor = p.color; c.shadowBlur = 6; c.beginPath(); c.arc(p.x, p.y, 2, 0, 7); c.fill(); }
    c.shadowBlur = 0; c.globalAlpha = 1;
    // floating score popups
    for (const p of popups) {
      const k = 1 - p.ttl / 55;
      c.globalAlpha = Math.min(1, p.ttl / 15); c.fillStyle = p.color; c.font = `800 ${Math.round(15 + k * 6)}px system-ui,sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.shadowColor = "#000"; c.shadowBlur = 6; c.fillText(p.text, p.x, p.y - k * 28); c.shadowBlur = 0;
    }
    c.globalAlpha = 1;
    // vignette over the board for depth
    const vg = c.createRadialGradient(QUEUE_W + COLS * CELL / 2, TOP + ROWS * CELL / 2, COLS * CELL * 0.25, QUEUE_W + COLS * CELL / 2, TOP + ROWS * CELL / 2, COLS * CELL * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.35)");
    c.fillStyle = vg; c.fillRect(QUEUE_W, TOP, COLS * CELL, ROWS * CELL);

    // countdown
    if (!flow.active && countdown > 0 && pendingNextLevel === 0) {
      const s = Math.ceil(countdown / 60);
      c.fillStyle = "rgba(0,0,0,0.45)"; c.fillRect(QUEUE_W, TOP, COLS * CELL, ROWS * CELL);
      c.textAlign = "center"; c.fillStyle = T.marquee; c.font = "800 64px 'Avenir Next Condensed','Arial Narrow',sans-serif";
      c.fillText(s, QUEUE_W + COLS * CELL / 2, TOP + ROWS * CELL / 2 - 10);
      c.fillStyle = "#FFFFFF"; c.font = "14px system-ui,sans-serif";
      c.fillText("Place pipes now. Space starts the flow early for a bonus.", QUEUE_W + COLS * CELL / 2, TOP + ROWS * CELL / 2 + 34);
    }
    // message
    if (msgTtl > 0 && msg) {
      c.textAlign = "center"; c.font = "700 16px system-ui,sans-serif";
      const tw = c.measureText(msg).width + 24;
      c.fillStyle = T.bg; rr(c, QUEUE_W + COLS * CELL / 2 - tw / 2, H - PAD - 30, tw, 26, 13); c.globalAlpha = 0.88; c.fill(); c.globalAlpha = 1;
      c.fillStyle = T.marquee; c.fillText(msg, QUEUE_W + COLS * CELL / 2, H - PAD - 17);
    }
    c.restore();
  }

  function drawSource(c, px, py, t) {
    const cx = px + CELL / 2, cy = py + CELL / 2;
    c.fillStyle = "#00000055"; rr(c, px + 6, py + 7, CELL - 8, CELL - 8, 8); c.fill();
    const tg = c.createLinearGradient(px, py, px + CELL, py + CELL); tg.addColorStop(0, shade(T.surface3, 0.25)); tg.addColorStop(1, shade(T.surface3, -0.3));
    c.fillStyle = tg; rr(c, px + 4, py + 4, CELL - 8, CELL - 8, 8); c.fill();
    tube(c, cx, cy, cx + DX[t.dir] * CELL / 2, cy + DY[t.dir] * CELL / 2, CELL * 0.32, T.pipe);
    liquid(c, cx, cy, cx + DX[t.dir] * CELL / 2, cy + DY[t.dir] * CELL / 2, CELL * 0.17, true);
    const pulse = 0.6 + 0.4 * Math.sin((tickNow || 0) / 8);
    c.shadowColor = fc(); c.shadowBlur = 14 * pulse;
    c.fillStyle = fc(); c.beginPath(); c.arc(cx, cy, 12, 0, 7); c.fill(); c.shadowBlur = 0;
    c.fillStyle = shade(fc(), 0.45); c.beginPath(); c.arc(cx - 3, cy - 3, 4, 0, 7); c.fill();
    c.fillStyle = T.bg; c.beginPath(); c.arc(cx, cy, 5, 0, 7); c.fill();
  }
  function drawBomb(c, px, py, t) {
    const cx = px + CELL / 2, cy = py + CELL / 2;
    tube(c, px, cy, px + CELL, cy, 16, T.pipe); tube(c, cx, py, cx, py + CELL, 16, T.pipe);
    if (t.defused) { liquid(c, px, cy, px + CELL, cy, 8, false); liquid(c, cx, py, cx, py + CELL, 8, false); }
    const blink = !t.defused && t.fuse < 600 && Math.floor(tickNow / 8) % 2 === 0;
    c.shadowColor = t.defused ? T.cyan : T.accent; c.shadowBlur = blink ? 22 : 10;
    const bg = c.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, 15); bg.addColorStop(0, shade(t.defused ? T.cyan : T.accent, 0.4)); bg.addColorStop(1, shade(t.defused ? T.cyan : T.accent, -0.25));
    c.fillStyle = bg; c.beginPath(); c.arc(cx, cy, 14, 0, 7); c.fill(); c.shadowBlur = 0;
    c.fillStyle = T.bg; c.font = "800 13px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(t.defused ? "✓" : String(Math.ceil(t.fuse / 60)), cx, cy + 1);
  }
  function drawPipe(c, px, py, t, size, shell) {
    const cx = px + size / 2, cy = py + size / 2, half = size / 2;
    const open = SHAPES[t.shape];
    const wall = t.valve ? T.textDim : t.slow ? T.pipeDark : T.pipe;
    const tw = size * 0.32;
    const arms = (dirs) => { for (const d of dirs) tube(c, cx, cy, cx + DX[d] * half, cy + DY[d] * half, tw, wall); };
    if (t.shape === "x") {
      arms([L, R]);
      if (t.fillA) fillSeg(c, cx, cy, half, t.inA ?? L, OPP[t.inA ?? L], t.fillA);
      // vertical pipe passes over the horizontal one
      c.fillStyle = "#00000066"; c.fillRect(cx - tw * 0.6, cy - tw * 0.6, tw * 1.2, tw * 1.2);
      arms([U, D]);
      if (t.fillB) fillSeg(c, cx, cy, half, t.inB ?? U, OPP[t.inB ?? U], t.fillB);
    } else if (t.shape === "timer") {
      arms(open);
      if (t.fill && t.in != null) fillSeg(c, cx, cy, half, t.in, t.out, t.fill);
      // the clock: a dial that drains as it holds the fluid
      const r = size * 0.3, frac = t.holdLeft / (t.hold * 60);
      c.fillStyle = T.surface; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fill();
      c.strokeStyle = T.pipeDark; c.lineWidth = 2; c.stroke();
      c.strokeStyle = t.holdLeft > 0 ? T.marquee : fc(); c.lineWidth = size * 0.07;
      c.beginPath(); c.arc(cx, cy, r - size * 0.06, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (t.holdLeft > 0 ? frac : 1)); c.stroke();
      const holding = t === flow.cell && t.holdLeft > 0 && t.fill >= 0.5;
      if (holding) { const pulse = 0.5 + 0.5 * Math.sin((shell?.tick || 0) / 4); c.globalAlpha = 0.35 * pulse; c.fillStyle = T.marquee; c.beginPath(); c.arc(cx, cy, r + 3, 0, 7); c.fill(); c.globalAlpha = 1; }
      c.fillStyle = T.text; c.font = `800 ${Math.round(size * 0.24)}px system-ui,sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(t.holdLeft > 0 ? String(Math.ceil(t.holdLeft / 60)) : "✓", cx, cy + 1);
    } else if (t.shape === "magic") {
      // four-way junction with a glowing core; once routed it shows only entry → exit
      arms(open);
      const pulse = 0.6 + 0.4 * Math.sin((shell?.tick || 0) / 5);
      c.fillStyle = T.marquee; c.globalAlpha = 0.35 * pulse; c.beginPath(); c.arc(cx, cy, size * 0.3, 0, 7); c.fill(); c.globalAlpha = 1;
      star(c, cx, cy, size * 0.2, size * 0.09); c.fillStyle = T.marquee; c.fill();
      if (t.fill && t.in != null) fillSeg(c, cx, cy, half, t.in, t.out, t.fill);
    } else {
      arms(open);
      // joint cap at the elbow
      if (open[0] !== OPP[open[1]]) { const jg = c.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, size * 0.18); jg.addColorStop(0, shade(wall, 0.35)); jg.addColorStop(1, shade(wall, -0.3)); c.fillStyle = jg; c.beginPath(); c.arc(cx, cy, size * 0.17, 0, 7); c.fill(); }
      if (t.slow) { c.fillStyle = T.surface; c.beginPath(); c.arc(cx, cy, size * 0.28, 0, 7); c.fill(); c.strokeStyle = wall; c.lineWidth = 3; c.stroke(); }
      if (t.valve) { c.fillStyle = T.marquee; c.beginPath(); c.arc(cx, cy, size * 0.14, 0, 7); c.fill(); }
      if (t.fill) fillSeg(c, cx, cy, half, t.in ?? open[0], t.out ?? open[1], t.fill);
    }
  }
  // draw liquid from the `from` side toward the `to` side, progress p in [0,1]
  function fillSeg(c, cx, cy, half, from, to, p) {
    if (!p) return;
    const w = half * 0.36, moving = p < 1;
    const fx = cx + DX[from] * half, fy = cy + DY[from] * half;
    if (p <= 0.5) {
      const k = p / 0.5;
      liquid(c, fx, fy, cx + DX[from] * half * (1 - k), cy + DY[from] * half * (1 - k), w, moving);
    } else {
      const k = (p - 0.5) / 0.5;
      liquid(c, fx, fy, cx, cy, w, moving);
      liquid(c, cx, cy, cx + DX[to] * half * k, cy + DY[to] * half * k, w, moving);
      c.fillStyle = fc(); c.beginPath(); c.arc(cx, cy, w / 2, 0, 7); c.fill();
    }
  }
  // ---- 3D-ish primitives ----
  // a cylindrical tube: shadow, body, highlight ridge and dark edge, all lit from top-left
  function tube(c, x1, y1, x2, y2, w, color) {
    c.lineCap = "butt";
    c.strokeStyle = "rgba(0,0,0,0.45)"; c.lineWidth = w; c.beginPath(); c.moveTo(x1 + 2, y1 + 3); c.lineTo(x2 + 2, y2 + 3); c.stroke();
    const horiz = y1 === y2, ox = horiz ? 0 : 1, oy = horiz ? 1 : 0; // perpendicular offset
    c.strokeStyle = color; c.lineWidth = w; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.strokeStyle = shade(color, -0.35); c.lineWidth = w * 0.3; c.beginPath(); c.moveTo(x1 + ox * w * 0.3, y1 + oy * w * 0.3); c.lineTo(x2 + ox * w * 0.3, y2 + oy * w * 0.3); c.stroke();
    c.strokeStyle = shade(color, 0.4); c.lineWidth = w * 0.22; c.beginPath(); c.moveTo(x1 - ox * w * 0.22, y1 - oy * w * 0.22); c.lineTo(x2 - ox * w * 0.22, y2 - oy * w * 0.22); c.stroke();
  }
  // glowing liquid with a specular line and, while moving, drifting flow stripes
  function liquid(c, x1, y1, x2, y2, w, moving) {
    if (x1 === x2 && y1 === y2) return;
    const col = fc();
    c.lineCap = "butt";
    c.shadowColor = col; c.shadowBlur = 10;
    c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.shadowBlur = 0;
    const horiz = y1 === y2, ox = horiz ? 0 : 1, oy = horiz ? 1 : 0;
    c.strokeStyle = shade(col, 0.5); c.lineWidth = w * 0.22; c.globalAlpha = 0.9; c.beginPath(); c.moveTo(x1 - ox * w * 0.25, y1 - oy * w * 0.25); c.lineTo(x2 - ox * w * 0.25, y2 - oy * w * 0.25); c.stroke(); c.globalAlpha = 1;
    if (moving) {
      c.save(); c.setLineDash([5, 9]); c.lineDashOffset = -(tickNow * 0.9) % 14; c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = w * 0.4;
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); c.restore();
    }
  }
  function shade(hex, amt) { // lighten (>0) or darken (<0) a #rrggbb
    if (!hex || hex[0] !== "#" || hex.length < 7) return hex;
    const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join("");
  }
  function star(c, cx, cy, r1, r2) {
    c.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? r2 : r1, a = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    c.closePath();
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  return g;
}
