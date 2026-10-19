// Maze Chase — eat every dot while four chasers hunt you. Arrows/WASD or swipe; your next turn is
// queued so you can press early. Power pellets turn the chasers blue and edible; fruit appears twice
// a level. Each chaser has its own AI: one chases, one ambushes ahead of you, one flanks, one wanders.
const MAP = [
  "###################",
  "#........#........#",
  "#o##.###.#.###.##o#",
  "#.................#",
  "#.##.#.#####.#.##.#",
  "#....#...#...#....#",
  "####.###.#.###.####",
  "   #.#.......#.#   ",
  "####.#.##=##.#.####",
  "    ...#   #...    ",
  "####.#.#####.#.####",
  "   #.#.......#.#   ",
  "####.#.#####.#.####",
  "#........#........#",
  "#.##.###.#.###.##.#",
  "#o.#...........#.o#",
  "##.#.#.#####.#.#.##",
  "#....#...#...#....#",
  "#.######.#.######.#",
  "#.................#",
  "###################",
];
const ROWS = MAP.length, COLS = MAP[0].length, CELL = 20, OX = 20, OY = 36, W = COLS * CELL + 40, H = ROWS * CELL + 56;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIFFICULTY = {
  beginner:     { name: "Beginner",     speed: 0.07, ghost: 0.055, fright: 480, lives: 4 },
  intermediate: { name: "Intermediate", speed: 0.085, ghost: 0.075, fright: 360, lives: 3 },
  advanced:     { name: "Advanced",     speed: 0.095, ghost: 0.092, fright: 240, lives: 2 },
};

export default function createMaze({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0;
  const g = { id: "maze", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, hud };
  let walls, dots, player, ghosts, lives, fright, fruit, fruitT, eatenGhosts, particles, popups, msg, msgTtl, shake, dotsLeft, pause, autoDir;
  const wall = (x, y) => x < 0 || x >= COLS || y < 0 || y >= ROWS ? (y === 9 ? false : true) : MAP[y][x] === "#";
  const key = (x, y) => y * COLS + x;

  function init(sh) { g.score = 0; g.level = 1; lives = diff.lives; particles = []; popups = []; shake = 0; newLevel(sh); }
  function newLevel(sh) {
    dots = new Map(); for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { if (MAP[y][x] === ".") dots.set(key(x, y), 1); if (MAP[y][x] === "o") dots.set(key(x, y), 2); }
    dotsLeft = dots.size; fruit = null; fruitT = 0; resetActors(); say(`Level ${g.level}`, 100); pause = 90;
  }
  function resetActors() {
    player = { x: 9, y: 15, px: 9, py: 15, dir: "left", want: "left", t: 0 };
    ghosts = [
      { x: 9, y: 7, px: 9, py: 7, dir: "up", color: "#FF5C8A", mode: "chase", home: [9, 7], out: 0 },
      { x: 8, y: 9, px: 8, py: 9, dir: "up", color: "#B57BFF", mode: "ambush", home: [8, 9], out: 240 },
      { x: 9, y: 9, px: 9, py: 9, dir: "up", color: "#2CE6D6", mode: "flank", home: [9, 9], out: 480 },
      { x: 10, y: 9, px: 10, py: 9, dir: "up", color: "#FFB454", mode: "wander", home: [10, 9], out: 720 },
    ];
    fright = 0; eatenGhosts = 0; autoDir = null;
  }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x: OX + x * CELL + CELL / 2, y: OY + y * CELL, text, color, ttl: 50 }); }
  function onInput(action) { if (action in DIRS) player.want = action; }
  function canGo(x, y, dir) { const [dx, dy] = DIRS[dir]; let nx = x + dx, ny = y + dy; if (ny === 9 && (nx < 0 || nx >= COLS)) return true; return !wall(nx, ny); }

  function update(sh) {
    tick = sh.tick;
    if (msgTtl > 0) msgTtl--; if (shake > 0) shake--;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; }
    popups = popups.filter(p => (p.ttl -= 1) > 0);
    if (pause > 0) { pause--; if (pause === 0 && lives <= 0) sh.end(); return; }
    if (fright > 0) fright--;
    if (g.autopilot && tick % 4 === 0) player.want = autoPick(sh);
    // player
    const playerCan = (x, y, d) => { const [dx, dy] = DIRS[d]; return canGo(x, y, d) && MAP[y + dy]?.[x + dx] !== "="; };
    stepActor(player, diff.speed * (1 + (g.level - 1) * 0.04), (a) => { if (playerCan(a.x, a.y, a.want)) a.dir = a.want; return playerCan(a.x, a.y, a.dir) ? a.dir : null; });
    const k = key(player.x, player.y);
    if (dots.has(k) && Math.abs(player.px - player.x) < 0.5 && Math.abs(player.py - player.y) < 0.5) {
      const v = dots.get(k); dots.delete(k); dotsLeft--; g.score += v === 2 ? 50 : 10;
      if (v === 2) { fright = diff.fright; eatenGhosts = 0; for (const gh of ghosts) if (gh.mode !== "eyes") gh.fr = true; sh.audio.levelUp(); } else if (tick % 2 === 0) sh.audio.tone({ freq: 440 + (dotsLeft % 2) * 60, type: "square", dur: 0.03, vol: 0.04 });
      if (!dotsLeft) { g.score += 1000 * g.level; sh.wallet?.earn(15 + g.level * 5); pop(9, 9, `Level ${g.level} clear! +${1000 * g.level}`, T?.marquee); g.level++; sh.audio.levelUp(); newLevel(sh); return; }
      if ((dotsLeft === 100 || dotsLeft === 40) && !fruit) { fruit = { x: 9, y: 11, t: 600, pts: 100 * g.level }; }
    }
    if (fruit) { fruit.t--; if (fruit.t <= 0) fruit = null; else if (player.x === fruit.x && player.y === fruit.y) { g.score += fruit.pts; sh.wallet?.earn(5); pop(fruit.x, fruit.y, "+" + fruit.pts, T?.marquee); fruit = null; sh.audio.eat(); } }
    // ghosts
    for (const gh of ghosts) {
      if (gh.out > 0) { gh.out--; continue; }
      if (fright <= 0) gh.fr = false;
      const sp = gh.mode === "eyes" ? diff.ghost * 2 : gh.fr ? diff.ghost * 0.55 : diff.ghost * (1 + (g.level - 1) * 0.05);
      stepActor(gh, sp, (a) => ghostDir(a, sh));
      if (gh.mode === "eyes" && gh.x === 9 && gh.y === 9) { gh.mode = gh.base || "chase"; gh.fr = false; }
      const d = Math.hypot(gh.px - player.px, gh.py - player.py);
      if (d < 0.7 && gh.mode !== "eyes") {
        if (gh.fr) { eatenGhosts++; const pts = 200 * Math.pow(2, eatenGhosts - 1); g.score += pts; sh.wallet?.earn(3); pop(gh.x, gh.y, "+" + pts, T?.cyan); gh.base = gh.mode; gh.mode = "eyes"; gh.fr = false; sh.audio.eat(); burst(gh.px, gh.py, 14, gh.color, sh); }
        else { lives--; shake = 16; sh.audio.hit(); burst(player.px, player.py, 30, T?.marquee, sh); say(lives > 0 ? `${lives} ${lives === 1 ? "life" : "lives"} left` : "Caught", 90); resetActors(); pause = 90; return; }
      }
    }
  }
  // moves an actor along the grid, choosing a new direction at each cell center
  function stepActor(a, speed, choose) {
    const atCenter = Math.abs(a.px - a.x) < speed && Math.abs(a.py - a.y) < speed;
    if (atCenter) {
      a.px = a.x; a.py = a.y;
      const dir = choose(a); if (!dir) return; a.dir = dir;
      const [dx, dy] = DIRS[dir]; a.x += dx; a.y += dy;
      if (a.y === 9 && a.x < 0) { a.x = COLS - 1; a.px = COLS; } if (a.y === 9 && a.x >= COLS) { a.x = 0; a.px = -1; }
    }
    a.px += Math.sign(a.x - a.px) * Math.min(speed, Math.abs(a.x - a.px)); a.py += Math.sign(a.y - a.py) * Math.min(speed, Math.abs(a.y - a.py));
  }
  function ghostDir(gh, sh) {
    const opts = Object.keys(DIRS).filter(d => canGo(gh.x, gh.y, d) && !(d === opp(gh.dir) && Object.keys(DIRS).filter(x => canGo(gh.x, gh.y, x)).length > 1));
    if (!opts.length) return opp(gh.dir);
    let target;
    const [pdx, pdy] = DIRS[player.dir];
    if (gh.mode === "eyes") target = [9, 9];
    else if (gh.fr) return opts[sh.rng.int(opts.length)];
    else if (gh.mode === "chase") target = [player.x, player.y];
    else if (gh.mode === "ambush") target = [player.x + pdx * 4, player.y + pdy * 4];
    else if (gh.mode === "flank") { const c = ghosts[0]; target = [player.x * 2 - c.x, player.y * 2 - c.y]; }
    else target = Math.hypot(gh.x - player.x, gh.y - player.y) > 7 ? [player.x, player.y] : [0, ROWS - 1];
    return opts.sort((a, b) => dist2(gh, a, target) - dist2(gh, b, target))[0];
  }
  function dist2(gh, d, t) { const [dx, dy] = DIRS[d]; return (gh.x + dx - t[0]) ** 2 + (gh.y + dy - t[1]) ** 2; }
  function opp(d) { return { up: "down", down: "up", left: "right", right: "left" }[d]; }
  // autopilot: BFS to the nearest dot, avoiding cells near non-frightened ghosts
  function autoPick(sh) {
    const danger = new Set(); for (const gh of ghosts) if (!gh.fr && gh.mode !== "eyes" && gh.out <= 0) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 2) danger.add(key(gh.x + dx, gh.y + dy));
    const q = [[player.x, player.y, null]], seen = new Set([key(player.x, player.y)]);
    while (q.length) {
      const [x, y, first] = q.shift();
      for (const d of Object.keys(DIRS)) {
        if (!canGo(x, y, d)) continue;
        let [dx, dy] = DIRS[d]; let nx = x + dx, ny = y + dy; if (MAP[ny]?.[nx] === "=") continue; if (ny === 9 && nx < 0) nx = COLS - 1; if (ny === 9 && nx >= COLS) nx = 0;
        const k = key(nx, ny); if (seen.has(k) || danger.has(k)) continue;
        seen.add(k); const f = first || d;
        if (dots.has(k) || (fruit && fruit.x === nx && fruit.y === ny)) return f;
        q.push([nx, ny, f]);
      }
    }
    const safe = Object.keys(DIRS).filter(d => canGo(player.x, player.y, d) && !danger.has(key(player.x + DIRS[d][0], player.y + DIRS[d][1])));
    return safe[0] || player.dir;
  }
  function burst(x, y, n, color, sh) { for (let i = 0; i < n; i++) { const a = sh.rng.next() * 6.28, sp = 0.5 + sh.rng.next() * 2.5; particles.push({ x: OX + x * CELL + CELL / 2, y: OY + y * CELL + CELL / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ttl: 20 + sh.rng.int(25), color }); } }
  function hud() { return `${diff.name} · level ${g.level} · ${lives} lives · ${dotsLeft} dots${fright ? " · power!" : ""}`; }

  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    c.save(); if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.6, (Math.random() - 0.5) * shake * 0.6);
    c.fillStyle = T.bg; c.fillRect(-10, -10, W + 20, H + 20);
    c.fillStyle = "rgba(255,255,255,0.06)"; c.fillRect(0, 0, W, 30);
    c.fillStyle = "#fff"; c.font = "700 14px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(`Level ${g.level}`, 14, 15);
    c.fillStyle = T.marquee; for (let i = 0; i < lives; i++) { c.beginPath(); c.arc(W - 16 - i * 16, 15, 5, 0.6, 5.7); c.lineTo(W - 16 - i * 16, 15); c.fill(); }
    // walls: glowing rounded blocks
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const ch = MAP[y][x], px = OX + x * CELL, py = OY + y * CELL;
      if (ch === "#") { c.fillStyle = shade(T.surface2, -0.1); rr(c, px + 1, py + 1, CELL - 2, CELL - 2, 5); c.fill(); c.strokeStyle = T.cyan; c.globalAlpha = 0.35; c.lineWidth = 1; rr(c, px + 2.5, py + 2.5, CELL - 5, CELL - 5, 4); c.stroke(); c.globalAlpha = 1; }
      if (ch === "=") { c.fillStyle = T.accent; c.globalAlpha = 0.6; c.fillRect(px + 2, py + CELL / 2 - 2, CELL - 4, 4); c.globalAlpha = 1; }
    }
    for (const [k, v] of dots) { const x = k % COLS, y = Math.floor(k / COLS), px = OX + x * CELL + CELL / 2, py = OY + y * CELL + CELL / 2; if (v === 2) { c.shadowColor = T.marquee; c.shadowBlur = 10; c.fillStyle = T.marquee; c.globalAlpha = 0.6 + 0.4 * Math.sin(tick / 6); c.beginPath(); c.arc(px, py, 5, 0, 7); c.fill(); c.shadowBlur = 0; c.globalAlpha = 1; } else { c.fillStyle = shade(T.text, -0.2); c.beginPath(); c.arc(px, py, 2, 0, 7); c.fill(); } }
    if (fruit) { const px = OX + fruit.x * CELL + CELL / 2, py = OY + fruit.y * CELL + CELL / 2; c.shadowColor = T.accent; c.shadowBlur = 12; c.fillStyle = T.accent; c.beginPath(); c.arc(px - 3, py + 2, 5, 0, 7); c.arc(px + 3, py + 2, 5, 0, 7); c.fill(); c.shadowBlur = 0; c.strokeStyle = "#4CD964"; c.lineWidth = 2; c.beginPath(); c.moveTo(px, py - 2); c.lineTo(px + 3, py - 8); c.stroke(); }
    for (const gh of ghosts) drawGhost(c, gh);
    // player
    const px = OX + player.px * CELL + CELL / 2, py = OY + player.py * CELL + CELL / 2, ang = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[player.dir], mouth = 0.25 + 0.2 * Math.abs(Math.sin(tick / 4));
    c.shadowColor = T.marquee; c.shadowBlur = 14; const pg = c.createRadialGradient(px - 3, py - 3, 1, px, py, 10); pg.addColorStop(0, shade(T.marquee, 0.5)); pg.addColorStop(1, shade(T.marquee, -0.2));
    c.fillStyle = pg; c.beginPath(); c.moveTo(px, py); c.arc(px, py, 9, ang + mouth, ang - mouth + Math.PI * 2); c.closePath(); c.fill(); c.shadowBlur = 0;
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color; c.fillRect(p.x, p.y, 2.5, 2.5); } c.globalAlpha = 1;
    for (const p of popups) { const k = 1 - p.ttl / 50; c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color || "#fff"; c.font = "800 13px system-ui,sans-serif"; c.textAlign = "center"; c.shadowColor = "#000"; c.shadowBlur = 5; c.fillText(p.text, p.x, p.y - k * 18); c.shadowBlur = 0; } c.globalAlpha = 1;
    if (msgTtl > 0 && msg) { c.font = "800 22px 'Chakra Petch',system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = T.marquee; c.shadowColor = "#000"; c.shadowBlur = 10; c.globalAlpha = Math.min(1, msgTtl / 20); c.fillText(msg, W / 2, OY + 11 * CELL + 10); c.shadowBlur = 0; c.globalAlpha = 1; }
    c.restore();
  }
  function drawGhost(c, gh) {
    const px = OX + gh.px * CELL + CELL / 2, py = OY + gh.py * CELL + CELL / 2, r = 9;
    const col = gh.mode === "eyes" ? null : gh.fr ? (fright < 90 && Math.floor(tick / 8) % 2 ? "#fff" : "#4DA3FF") : gh.color;
    if (col) {
      c.shadowColor = col; c.shadowBlur = 10; const grd = c.createLinearGradient(px, py - r, px, py + r); grd.addColorStop(0, shade(col, 0.35)); grd.addColorStop(1, shade(col, -0.3)); c.fillStyle = grd;
      c.beginPath(); c.arc(px, py - 1, r, Math.PI, 0); c.lineTo(px + r, py + r - 2); for (let i = 0; i < 4; i++) c.lineTo(px + r - (i + 0.5) * r / 2, py + r - 2 - ((i + (tick >> 3)) % 2 ? 3 : 0)); c.lineTo(px - r, py + r - 2); c.closePath(); c.fill(); c.shadowBlur = 0;
    }
    const [dx, dy] = DIRS[gh.dir];
    c.fillStyle = "#fff"; c.beginPath(); c.arc(px - 3.5, py - 2, 3, 0, 7); c.arc(px + 3.5, py - 2, 3, 0, 7); c.fill();
    c.fillStyle = gh.fr && col ? "#1B1F2A" : "#1B1F2A"; c.beginPath(); c.arc(px - 3.5 + dx * 1.5, py - 2 + dy * 1.5, 1.5, 0, 7); c.arc(px + 3.5 + dx * 1.5, py - 2 + dy * 1.5, 1.5, 0, 7); c.fill();
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
