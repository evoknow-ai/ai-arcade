// Snake — classic rules plus: speed ramps per level, golden fruit, an AI autopilot
// (used for attract mode and for the "AI hint" button). Deterministic: all randomness
// comes from shell.rng so the server can replay the input log.
const COLS = 24, ROWS = 24, CELL = 20;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP = { up: "down", down: "up", left: "right", right: "left" };

export default function createSnake({ autopilot = false } = {}) {
  const g = {
    id: "snake",
    tps: 60,
    size: { width: COLS * CELL, height: ROWS * CELL },
    score: 0, level: 1,
    init(shell) {
      g.snake = [[12, 12], [11, 12], [10, 12]];
      g.dir = "right"; g.nextDir = "right";
      g.score = 0; g.level = 1; g.eaten = 0;
      g.moveEvery = 9; g.acc = 0;
      g.golden = null; g.goldenTtl = 0;
      g.flash = 0;
      g.fruit = spawn(shell);
      g.autopilot = autopilot;
    },
    onInput(action, shell) {
      if (action in DIRS && action !== OPP[g.dir]) g.nextDir = action;
      if (action === "action") g.autopilot = !g.autopilot; // toggle AI hint/autopilot
      shell.audio.blip();
    },
    hud() { return g.autopilot ? "AI autopilot on (Space to toggle)" : "Space: AI autopilot"; },
    update(shell) {
      g.acc++;
      if (g.flash > 0) g.flash--;
      if (g.acc < g.moveEvery) return;
      g.acc = 0;
      if (g.autopilot) g.nextDir = aiPick(g) || g.nextDir;
      g.dir = g.nextDir;
      const [dx, dy] = DIRS[g.dir];
      const head = [g.snake[0][0] + dx, g.snake[0][1] + dy];
      if (head[0] < 0 || head[1] < 0 || head[0] >= COLS || head[1] >= ROWS || g.snake.some(([x, y]) => x === head[0] && y === head[1])) {
        shell.audio.hit();
        return shell.end();
      }
      g.snake.unshift(head);
      if (g.golden && head[0] === g.golden[0] && head[1] === g.golden[1]) {
        g.score += 50 * g.level; g.golden = null; g.flash = 12; shell.audio.levelUp();
      } else if (head[0] === g.fruit[0] && head[1] === g.fruit[1]) {
        g.score += 10 * g.level; g.eaten++; shell.audio.eat();
        g.fruit = spawn(shell);
        if (g.eaten % 5 === 0) { g.level++; g.moveEvery = Math.max(3, g.moveEvery - 1); shell.audio.levelUp(); }
        if (!g.golden && shell.rng.next() < 0.2) { g.golden = spawn(shell); g.goldenTtl = 60; }
      } else {
        g.snake.pop();
      }
      if (g.golden && --g.goldenTtl <= 0) g.golden = null;
    },
    render(c, shell) {
      const { w, h } = shell;
      c.fillStyle = g.flash > 0 ? "#2A2260" : "#1B1540"; c.fillRect(0, 0, w, h);
      c.strokeStyle = "rgba(255,255,255,0.05)"; c.lineWidth = 1;
      for (let x = 0; x <= COLS; x++) { c.beginPath(); c.moveTo(x * CELL, 0); c.lineTo(x * CELL, h); c.stroke(); }
      for (let y = 0; y <= ROWS; y++) { c.beginPath(); c.moveTo(0, y * CELL); c.lineTo(w, y * CELL); c.stroke(); }
      drawCell(c, g.fruit, "#FF5C8A", 5);
      if (g.golden) { drawCell(c, g.golden, "#FFD447", 6); }
      g.snake.forEach(([x, y], i) => {
        const t = i / g.snake.length;
        c.fillStyle = i === 0 ? "#4DE1F0" : `hsl(${186 - t * 40} 80% ${62 - t * 25}%)`;
        rr(c, x * CELL + 1.5, y * CELL + 1.5, CELL - 3, CELL - 3, i === 0 ? 6 : 4); c.fill();
      });
      const [hx, hy] = g.snake[0]; const [dx, dy] = DIRS[g.dir];
      c.fillStyle = "#1B1540";
      c.beginPath(); c.arc(hx * CELL + 10 + dx * 4 + dy * 4, hy * CELL + 10 + dy * 4 - dx * 4, 2, 0, 7); c.fill();
      c.beginPath(); c.arc(hx * CELL + 10 + dx * 4 - dy * 4, hy * CELL + 10 + dy * 4 + dx * 4, 2, 0, 7); c.fill();
    },
  };
  return g;
}

function spawn(shell) {
  // deterministic: keep trying free cells using shell.rng
  for (;;) {
    const p = [shell.rng.int(COLS), shell.rng.int(ROWS)];
    const g = shell.game;
    if (!g.snake?.some(([x, y]) => x === p[0] && y === p[1])) return p;
  }
}
function drawCell(c, [x, y], color, r) {
  c.fillStyle = color; rr(c, x * CELL + 3, y * CELL + 3, CELL - 6, CELL - 6, r); c.fill();
}
function rr(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

// Simple AI: BFS to the (golden or normal) fruit; if no safe path, chase the tail to survive.
function aiPick(g) {
  const target = g.golden || g.fruit;
  const body = new Set(g.snake.map(([x, y]) => x + "," + y));
  const path = bfs(g.snake[0], target, body);
  if (path) return path;
  const tail = g.snake[g.snake.length - 1];
  body.delete(tail.join(","));
  const toTail = bfs(g.snake[0], tail, body);
  if (toTail) return toTail;
  for (const d of ["up", "down", "left", "right"]) { // any free neighbor
    if (d === OPP[g.dir]) continue;
    const [dx, dy] = DIRS[d]; const nx = g.snake[0][0] + dx, ny = g.snake[0][1] + dy;
    if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && !body.has(nx + "," + ny)) return d;
  }
  return null;
}
function bfs(start, goal, blocked) {
  const q = [[start[0], start[1], null]]; const seen = new Set([start.join(",")]);
  while (q.length) {
    const [x, y, first] = q.shift();
    for (const [d, [dx, dy]] of Object.entries(DIRS)) {
      const nx = x + dx, ny = y + dy, k = nx + "," + ny;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || blocked.has(k) || seen.has(k)) continue;
      if (nx === goal[0] && ny === goal[1]) return first || d;
      seen.add(k); q.push([nx, ny, first || d]);
    }
  }
  return null;
}
