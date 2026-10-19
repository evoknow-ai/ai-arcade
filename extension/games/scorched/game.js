// Scorched Ridge — turn-based artillery on destructible terrain against an AI gunner.
// Aim: hover + click, or ←/→ angle, ↑/↓ power, Space fires. 1–8 selects a weapon, Tab cycles,
// B opens the shop. Credits are earned by damage dealt and persist across games (shell.wallet).
// Weapons explode differently (deep digger, wide foundation breaker, cluster, guided, smart, drone).
// Each ridge gets a scene: morning / noon / evening / night (big or small moon) / storm, with birds
// or bats, distant explosions, lightning, rain and creaks.
const W = 640, H = 400, G = 0.11;

const DIFFICULTY = {
  beginner:     { name: "Beginner",     aiNoise: 14, hp: 150, windMax: 1.0, aiShop: 0.2 },
  intermediate: { name: "Intermediate", aiNoise: 8,  hp: 100, windMax: 1.8, aiShop: 0.45 },
  advanced:     { name: "Advanced",     aiNoise: 4,  hp: 80,  windMax: 2.6, aiShop: 0.7 },
};

const WEAPONS = {
  shell:   { name: "Shell",              cost: 0,   r: 22, dmg: 45, desc: "Standard round. Unlimited." },
  heavy:   { name: "Heavy Shell",        cost: 40,  r: 34, dmg: 70, desc: "Bigger bang, bigger crater." },
  cluster: { name: "Cluster Missile",    cost: 60,  r: 13, dmg: 28, cluster: true, desc: "Bursts into 6 bomblets at the top of its arc." },
  digger:  { name: "Digger",             cost: 50,  r: 9,  dmg: 35, dig: 70, desc: "Drills a deep narrow shaft. Great for burying a tank." },
  breaker: { name: "Foundation Breaker", cost: 70,  r: 46, dmg: 18, shallow: 12, desc: "Wide, shallow blast — pulls the ground out from under a tank." },
  guided:  { name: "Guided Missile",     cost: 80,  r: 24, dmg: 50, guided: true, desc: "Steers toward the enemy mid-flight." },
  smart:   { name: "Smart Bomb",         cost: 70,  r: 26, dmg: 55, smart: true, desc: "Drops straight down once it is over the target." },
  drone:   { name: "Drone Strike",       cost: 120, r: 18, dmg: 42, drone: true, desc: "Flies level above the wind, then dives on the target. No aim needed." },
};
const WEAPON_IDS = Object.keys(WEAPONS);
const UPGRADES = {
  shield: { name: "Shield",   cost: 80,  desc: "Absorbs 60 damage this ridge." },
  repair: { name: "Repair",   cost: 60,  desc: "+40 HP now." },
  armor:  { name: "Armor",    cost: 150, desc: "+25 max HP for this run." },
  barrel: { name: "Barrel",   cost: 120, desc: "+15% shot power for this run." },
};

const SCENES = [
  { id: "morning", top: "#F6C27A", mid: "#F08A5D", bot: "#6B4A7A", sun: { x: 90, y: 110, r: 26, color: "#FFE3A3" }, stars: 0, birds: "birds", tint: "#5C4A3A" },
  { id: "noon",    top: "#6FB7FF", mid: "#A8D8FF", bot: "#E7F3FF", sun: { x: 320, y: 60, r: 22, color: "#FFF6C8" }, stars: 0, birds: "birds", tint: "#3C6B3C" },
  { id: "evening", top: "#2E1B4E", mid: "#B4436C", bot: "#F9A03F", sun: { x: 540, y: 150, r: 30, color: "#FFC46B" }, stars: 0.3, birds: "birds", tint: "#4A2E3F" },
  { id: "night",   top: "#05070F", mid: "#0E1A33", bot: "#1C2B4A", moon: { x: 500, y: 80, r: 44, color: "#F4F1E6" }, stars: 1, birds: "bats", tint: "#1A2238" },
  { id: "night-sm", top: "#060811", mid: "#111A2E", bot: "#202C47", moon: { x: 150, y: 70, r: 16, color: "#E8E6DF" }, stars: 1, birds: "bats", tint: "#1C2434" },
  { id: "storm",   top: "#1C2127", mid: "#3B4650", bot: "#5A6670", rain: true, stars: 0, birds: null, tint: "#2C3A3A" },
];

export default function createScorched({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0;
  const g = { id: "scorched", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, onPointer, onHover, hud };
  let ground, tanks, turn, shells, wind, particles, popups, msg, msgTtl, shake, phase, phaseT, hoverAim, stars, scene, troops, flock, lightning, rain, farBooms, shop, ammo, weapon, aiAmmo, aiWeapon, lastMiss, tracers, bunkers, flags, reinforceT;

  function init(sh) {
    g.score = 0; g.level = 1; particles = []; popups = []; shake = 0; shells = []; tanks = null;
    ammo = { shell: Infinity }; weapon = "shell"; aiAmmo = {}; aiWeapon = "shell"; lastMiss = 0;
    stars = Array.from({ length: 80 }, () => [sh.rng.next() * W, sh.rng.next() * H * 0.55, sh.rng.next()]);
    g.run = { armor: 0, barrel: 1 };
    newRound(sh);
  }
  function newRound(sh) {
    scene = SCENES[sh.rng.int(SCENES.length)];
    const base = 220 + sh.rng.int(60), a1 = 30 + sh.rng.int(50), a2 = 10 + sh.rng.int(30), f1 = 0.004 + sh.rng.next() * 0.006, f2 = 0.02 + sh.rng.next() * 0.02, ph = sh.rng.next() * 9;
    ground = new Float32Array(W);
    for (let x = 0; x < W; x++) ground[x] = base + Math.sin(x * f1 + ph) * a1 + Math.sin(x * f2) * a2 + Math.sin(x * 0.11) * 3;
    const px = 40 + sh.rng.int(140), ex = W - 40 - sh.rng.int(140);
    const maxHp = diff.hp + (g.run?.armor || 0);
    const keepHp = tanks?.[0] ? Math.min(maxHp, tanks[0].hp + 30) : maxHp; // partial repair between ridges
    tanks = [
      { x: px, y: ground[px | 0], angle: 60, power: 60, hp: keepHp, maxHp, name: "You", ai: false, shield: 0 },
      { x: ex, y: ground[ex | 0], angle: 120, power: 60, hp: diff.hp + g.level * 8, maxHp: diff.hp + g.level * 8, name: "AI", ai: true, shield: 0 },
    ];
    flatten(px); flatten(ex);
    troops = []; tracers = []; bunkers = []; flags = []; reinforceT = 0;
    for (const [i, t] of tanks.entries()) for (let n = 0; n < 4; n++) troops.push(mkTroop(sh, i, t.x + (i ? -1 : 1) * (26 + n * 14), n === 1));
    turn = 0; shells = []; phase = "aim"; phaseT = 0; hoverAim = null; shop = null;
    wind = (sh.rng.next() * 2 - 1) * diff.windMax;
    flock = null; lightning = 0; rain = scene.rain ? Array.from({ length: 140 }, () => [sh.rng.next() * W, sh.rng.next() * H, 6 + sh.rng.next() * 6]) : null; farBooms = [];
    if (sh.rng.next() < diff.aiShop + g.level * 0.05) { const pool = ["heavy", "cluster", "digger", "breaker", "guided", "smart"]; aiWeapon = pool[sh.rng.int(pool.length)]; aiAmmo[aiWeapon] = 1 + sh.rng.int(2); }
    say(`Ridge ${g.level} · ${sceneName()} · your shot`, 140);
  }
  function sceneName() { return { morning: "morning", noon: "high noon", evening: "evening", night: "full moon", "night-sm": "starry night", storm: "storm" }[scene.id]; }
  function mkTroop(sh, side, x, mg) { return { side, x, dir: side ? -1 : 1, step: sh.rng.next() * 6, alive: true, rest: sh.rng.int(60), hp: 3, weapon: mg ? "mg" : "rifle", cool: 30 + sh.rng.int(60), state: "advance", digT: 0, calm: 0, burst: 0, flash: 0 }; }
  function groundAt(x) { return ground[Math.max(0, Math.min(W - 1, x | 0))]; }
  function isHilltop(x) { const y = groundAt(x); for (let d = 12; d <= 48; d += 12) if (groundAt(x - d) < y + 6 || groundAt(x + d) < y + 6) return false; return true; }
  function flatten(x) { const h = ground[x | 0]; for (let i = -10; i <= 10; i++) if (x + i >= 0 && x + i < W) ground[x + i | 0] = Math.max(ground[x + i | 0], h); }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x, y, text, color, ttl: 60 }); }
  function earn(sh, n, x, y) { if (n <= 0) return; sh.wallet?.earn(n); pop(x, y, `+${n} cr`, T?.cyan); }

  // ---------- input ----------
  function onInput(action, sh) {
    if (shop) { if (action === "shop") shop = null; return; }
    if (phase !== "aim" || turn !== 0 || g.autopilot) return;
    const t = tanks[0];
    if (action === "left") t.angle = Math.min(175, t.angle + 2);
    if (action === "right") t.angle = Math.max(5, t.angle - 2);
    if (action === "up") t.power = Math.min(100, t.power + 2);
    if (action === "down") t.power = Math.max(10, t.power - 2);
    if (action === "action") fire(0, sh);
    if (action === "shop") openShop();
    if (action === "next") cycleWeapon(1);
    if (action.startsWith("slot")) { const id = WEAPON_IDS[+action.slice(4) - 1]; if (id && (ammo[id] || 0) > 0) weapon = id; }
    sh.audio.blip();
  }
  function cycleWeapon(d) { const owned = WEAPON_IDS.filter(id => (ammo[id] || 0) > 0); const i = owned.indexOf(weapon); weapon = owned[(i + d + owned.length) % owned.length]; }
  function openShop() { shop = { items: [...WEAPON_IDS.filter(id => id !== "shell").map(id => ({ kind: "weapon", id })), ...Object.keys(UPGRADES).map(id => ({ kind: "upgrade", id }))] }; }
  function aimFromPoint(px, py) {
    const t = tanks[0];
    const dx = px - t.x, dy = (t.y - 10) - py;
    return { angle: Math.round(Math.max(5, Math.min(175, Math.atan2(dy, dx) * 180 / Math.PI))), power: Math.round(Math.max(10, Math.min(100, Math.hypot(dx, dy) / 3.2))) };
  }
  function onHover(px, py) { hoverAim = px < 0 || shop || py < 44 ? null : aimFromPoint(px, py); }
  function onPointer(px, py, sh) {
    if (shop) { shopClick(px, py, sh); return; }
    if (py < 44 && px > W - 70) { if (phase === "aim" && turn === 0) openShop(); return; }
    if (py < 44 && px < 8 + WEAPON_IDS.length * 56) {
      const i = Math.floor((px - 8) / 56); const id = WEAPON_IDS[i]; if (id && (ammo[id] || 0) > 0) { weapon = id; sh.record(1000 + 11 + i); sh.audio.blip(); } return;
    }
    if (py < 44) return;
    if (phase !== "aim" || turn !== 0 || g.autopilot) return;
    const a = aimFromPoint(px, py); tanks[0].angle = a.angle; tanks[0].power = a.power;
    sh.record(1000 + Math.round(px) * 1000 + Math.round(py));
    fire(0, sh);
  }
  function shopClick(px, py, sh) {
    const box = shopBox();
    if (px < box.x || px > box.x + box.w || py < box.y || py > box.y + box.h) { shop = null; return; }
    if (py > box.y + box.h - 34) { shop = null; return; }
    const row = Math.floor((py - box.y - 44) / 30);
    const item = shop.items[row]; if (!item) return;
    const def = item.kind === "weapon" ? WEAPONS[item.id] : UPGRADES[item.id];
    if (!sh.wallet?.spend(def.cost)) { say("Not enough credits", 50); sh.audio.hit(); return; }
    sh.record(2000 + row);
    if (item.kind === "weapon") { ammo[item.id] = (ammo[item.id] || 0) + 1; weapon = item.id; say(`Bought ${def.name}`, 50); }
    else {
      const me = tanks[0];
      if (item.id === "shield") me.shield = 60;
      if (item.id === "repair") me.hp = Math.min(me.maxHp, me.hp + 40);
      if (item.id === "armor") { g.run.armor += 25; me.maxHp += 25; me.hp += 25; }
      if (item.id === "barrel") g.run.barrel *= 1.15;
      say(`Bought ${def.name}`, 50);
    }
    sh.audio.eat();
  }
  function shopBox() { const w = 560, h = 44 + shop.items.length * 30 + 40; return { x: (W - w) / 2, y: (H - h) / 2, w, h }; }

  // ---------- simulation ----------
  function fire(i, sh) {
    const t = tanks[i];
    const wid = i === 0 ? weapon : aiWeapon;
    const def = WEAPONS[wid];
    if (i === 0) { if (ammo[wid] !== Infinity) { ammo[wid]--; if (ammo[wid] <= 0) { delete ammo[wid]; weapon = "shell"; } } }
    else if (aiAmmo[wid]) { aiAmmo[wid]--; if (aiAmmo[wid] <= 0) { delete aiAmmo[wid]; aiWeapon = "shell"; } }
    const rad = t.angle * Math.PI / 180, v = t.power * 0.12 * (i === 0 ? g.run.barrel : 1);
    const target = tanks[1 - i];
    if (def.drone) shells.push({ kind: wid, x: t.x, y: t.y - 30, vx: Math.sign(target.x - t.x) * 2.4, vy: -1.2, owner: i, trail: [], alt: 60 + sh.rng.int(40), stage: "climb", target });
    else shells.push({ kind: wid, x: t.x + Math.cos(rad) * 16, y: t.y - 10 - Math.sin(rad) * 16, vx: Math.cos(rad) * v, vy: -Math.sin(rad) * v, owner: i, trail: [], target, peak: false });
    phase = "flight"; sh.audio.tone({ freq: def.drone ? 420 : 180, type: "sawtooth", dur: 0.3, slide: def.drone ? 60 : -100, vol: 0.2 });
    say(`${t.name}: ${def.name}`, 60);
  }
  function update(sh) {
    tick = sh.tick;
    if (msgTtl > 0) msgTtl--; if (shake > 0) shake--;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.12; }
    popups = popups.filter(p => (p.ttl -= 1) > 0);
    ambience(sh);
    for (const t of tanks) { const gy = ground[Math.max(0, Math.min(W - 1, t.x | 0))]; if (t.y < gy - 0.5) { t.y = Math.min(gy, t.y + 2.5); if (t.y === gy) damage(t, 10, sh, "fall"); } else t.y = gy; }
    updateTroops(sh);
    if (shop) return;

    if (phase === "aim") {
      if (turn === 1 || g.autopilot) { phaseT++; if (phaseT > 50) { phaseT = 0; aiShot(sh, turn); fire(turn, sh); } }
      return;
    }
    if (phase === "flight") {
      for (const s of shells) for (let step = 0; step < 3 && !s.dead; step++) stepShell(s, sh);
      shells = shells.filter(s => !s.dead);
      if (!shells.length) { phase = "between"; phaseT = 0; afterShotCheck(sh); }
      return;
    }
    if (phase === "between") { if (++phaseT > 70) { phaseT = 0; afterShot(sh); } }
  }
  function stepShell(s, sh) {
    const def = WEAPONS[s.kind] || {};
    if (def.drone) {
      if (s.stage === "climb") { s.y += s.vy; s.x += s.vx; if (s.y < s.alt) s.stage = "cruise"; }
      else if (s.stage === "cruise") { s.x += s.vx; s.y += Math.sin(tick / 6) * 0.3; if (Math.abs(s.x - s.target.x) < 6) { s.stage = "dive"; s.vy = 1; s.vx = 0; sh.audio.tone({ freq: 600, type: "square", dur: 0.4, slide: -400, vol: 0.15 }); } }
      else { s.vy += 0.3; s.y += s.vy; }
    } else {
      s.vx += wind * 0.0025; s.vy += def.guided ? G * 0.25 : G; // a guided missile has its own thrust
      if (def.guided) { // cap speed, then bend the velocity toward the target each step
        const far = Math.abs(s.target.x - s.x); const aimY = s.target.y - 10 - (far > 60 ? Math.min(140, far * 0.5) : 0); // fly high, then dive
        const dx = s.target.x - s.x, dy = aimY - s.y, len = Math.hypot(dx, dy) || 1;
        const sp = Math.min(6, Math.hypot(s.vx, s.vy)) || 1; let nx = s.vx / sp, ny = s.vy / sp;
        nx += dx / len * 0.16; ny += dy / len * 0.16; const nl = Math.hypot(nx, ny) || 1; s.vx = nx / nl * sp; s.vy = ny / nl * sp;
      }
      if (def.smart && !s.dropped && s.y < s.target.y - 20 && Math.sign(s.target.x - s.x) !== Math.sign(s.target.x - (s.x + s.vx))) { // about to cross the target's x: drop
        s.dropped = true; s.x = s.target.x; s.vx = 0; s.vy = Math.max(s.vy, 1); sh.audio.tone({ freq: 900, type: "triangle", dur: 0.1 });
      }
      if (def.cluster && s.vy > 0 && !s.peak) { s.peak = true; for (let i = 0; i < 6; i++) shells.push({ kind: "bomblet", x: s.x, y: s.y, vx: s.vx * 0.6 + (i - 2.5) * 0.55, vy: s.vy - 1.2 + sh.rng.next(), owner: s.owner, trail: [], target: s.target }); s.dead = true; return; }
      s.x += s.vx; s.y += s.vy;
    }
    if (tick % 2 === 0) s.trail.push([s.x, s.y]); if (s.trail.length > 40) s.trail.shift();
    if (s.x < -60 || s.x > W + 60 || s.y > H + 60) { s.dead = true; noteMiss(s, null); return; }
    const gx = s.x | 0;
    if (gx >= 0 && gx < W && s.y >= ground[gx]) { impact(s, sh); return; }
    for (const t of tanks) if (Math.hypot(t.x - s.x, t.y - 8 - s.y) < 14) { impact(s, sh); return; }
  }
  function noteMiss(s, d) { if (s.owner === 1) lastMiss = d === null ? 999 : d; }
  function impact(s, sh) {
    s.dead = true;
    const def = s.kind === "bomblet" ? { r: 14, dmg: 28 } : WEAPONS[s.kind];
    const x = s.x, y = s.y;
    if (def.dig) { for (let gx = Math.max(0, x - def.r | 0); gx <= Math.min(W - 1, x + def.r | 0); gx++) { const k = 1 - Math.abs(gx - x) / def.r; ground[gx] = Math.max(ground[gx], y + def.dig * k); } }
    else if (def.shallow) { for (let gx = Math.max(0, x - def.r | 0); gx <= Math.min(W - 1, x + def.r | 0); gx++) { const k = Math.sqrt(Math.max(0, 1 - ((gx - x) / def.r) ** 2)); ground[gx] = Math.max(ground[gx], y + def.shallow * k + 4); } }
    else { for (let gx = Math.max(0, x - def.r | 0); gx <= Math.min(W - 1, x + def.r | 0); gx++) { const d = Math.sqrt(Math.max(0, def.r * def.r - (gx - x) * (gx - x))); const bottom = y + d; if (ground[gx] < bottom) ground[gx] = bottom; } }
    const n = def.r * 2.5;
    for (let i = 0; i < n; i++) { const a = sh.rng.next() * 6.28, sp = 1 + sh.rng.next() * (def.r / 7); particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, ttl: 30 + sh.rng.int(40), color: i % 3 ? T?.marquee : T?.accent }); }
    shake = Math.min(30, def.r); sh.audio.hit();
    let dealt = 0, miss = null;
    for (const [i, t] of tanks.entries()) {
      const d = Math.hypot(t.x - x, t.y - 8 - y);
      if (i !== s.owner) miss = (t.x - x) * (i === 1 ? 1 : -1);
      if (d < def.r + 12) {
        const dmg = Math.round(Math.max(0.15, 1 - d / (def.r + 12)) * def.dmg) + 4;
        const real = damage(t, dmg, sh, "hit");
        if (i !== s.owner) { dealt += real; if (s.owner === 0) { g.score += real * 10; pop(x, y - 20, "+" + real * 10, T?.marquee); } }
        else pop(t.x, t.y - 44, "own goal", T?.textDim);
      }
    }
    bunkers = bunkers.filter(b => Math.hypot(b.x - x, groundAt(b.x) - y) > def.r + 8); flags = flags.filter(f => Math.hypot(f.x - x, groundAt(f.x) - y) > def.r + 4);
    for (const tr of troops) { if (tr.alive && Math.hypot(tr.x - x, ground[Math.max(0, Math.min(W - 1, tr.x | 0))] - 6 - y) < def.r + 6) { tr.alive = false; if (tr.side !== s.owner && s.owner === 0) { g.score += 25; dealt += 2; } for (let k = 0; k < 6; k++) particles.push({ x: tr.x, y, vx: (sh.rng.next() - 0.5) * 3, vy: -sh.rng.next() * 3, ttl: 30, color: T?.accent }); } }
    if (s.owner === 0 && dealt > 0) earn(sh, Math.round(dealt * 1.2), x, y - 38);
    noteMiss(s, miss);
  }
  // ---------- infantry ----------
  // Morale follows the tanks: the side whose tank is healthier pushes forward, the other falls back.
  // Troops duck when shot at, fire rifles or machine guns at enemies in range, dig in when things are
  // quiet, plant flags on hilltops, and get reinforcements while their tank is winning.
  function updateTroops(sh) {
    tracers = tracers.filter(t => (t.ttl -= 1) > 0);
    const hpRatio = (i) => Math.max(0, tanks[i].hp) / tanks[i].maxHp;
    const morale = [hpRatio(0) - hpRatio(1), hpRatio(1) - hpRatio(0)];
    if (++reinforceT > 600) { reinforceT = 0; for (const i of [0, 1]) { const n = troops.filter(t => t.alive && t.side === i).length; if ((morale[i] > 0.15 && n < 6) || n < 3) { troops.push(mkTroop(sh, i, tanks[i].x + (i ? 1 : -1) * 20, sh.rng.next() < 0.3)); pop(tanks[i].x, tanks[i].y - 54, "reinforcements", T?.textDim); } } }
    for (const s of troops) {
      if (!s.alive) continue;
      if (s.flash > 0) s.flash--; if (s.cool > 0) s.cool--; s.calm++;
      const enemies = troops.filter(o => o.alive && o.side !== s.side);
      const nearest = enemies.sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x))[0];
      const dist = nearest ? Math.abs(nearest.x - s.x) : Infinity;
      const enemyTank = tanks[1 - s.side], tankDist = Math.abs(enemyTank.x - s.x);
      const own = tanks[s.side], m = morale[s.side];
      const inBunker = bunkers.find(b => b.side === s.side && Math.abs(b.x - s.x) < 10);
      const toward = Math.sign(enemyTank.x - s.x) || s.dir;
      // decide state
      if (s.underFire > 0) { s.underFire--; s.state = "duck"; }
      else if (dist < (s.weapon === "mg" ? 170 : 130) || tankDist < 110) s.state = "fire";
      else if (m < -0.2 && (s.x - own.x) * toward > 20) s.state = "retreat";
      else if (m > 0.2) s.state = "advance";
      else if (s.calm > 240 && !inBunker && !bunkers.some(b => Math.abs(b.x - s.x) < 40) && sh.rng.next() < 0.01) { s.state = "dig"; s.digT = 150; }
      else if (s.state !== "dig") s.state = Math.abs(s.x - own.x) > 110 && (s.x - own.x) * toward > 0 ? "retreat" : "hold";
      // act
      if (s.state === "advance") { s.dir = toward; s.step += 0.18; s.x += s.dir * 0.45; }
      else if (s.state === "retreat") { s.dir = toward; s.step += 0.22; s.x -= toward * 0.5; if (Math.abs(s.x - own.x) < 24) s.state = "hold"; }
      else if (s.state === "hold") { if (sh.rng.next() < 0.01) s.dir *= -1; s.step += 0.04; s.x += s.dir * 0.08; }
      else if (s.state === "dig") { s.step += 0.3; if (--s.digT <= 0) { bunkers.push({ side: s.side, x: s.x, hp: 3 }); s.state = "hold"; s.calm = 0; } }
      else if (s.state === "fire") {
        s.dir = nearest && dist < 170 ? Math.sign(nearest.x - s.x) : toward;
        if (s.cool <= 0) {
          const target = nearest && dist < 170 ? nearest : null;
          const shots = s.weapon === "mg" ? 4 : 1; s.burst = shots; s.cool = s.weapon === "mg" ? 90 + sh.rng.int(60) : 45 + sh.rng.int(50);
          s.flash = shots * 4;
          const gy = groundAt(s.x) - 8;
          for (let k = 0; k < shots; k++) {
            if (target) {
              const cover = bunkers.some(b => b.side === target.side && Math.abs(b.x - target.x) < 10) ? 0.5 : 1, duck = target.state === "duck" ? 0.6 : 1;
              const hit = sh.rng.next() < (s.weapon === "mg" ? 0.1 : 0.2) * cover * duck;
              const tx = target.x + (hit ? 0 : (sh.rng.next() - 0.5) * 24), ty = groundAt(target.x) - 8 + (hit ? 0 : (sh.rng.next() - 0.5) * 16);
              tracers.push({ x0: s.x + s.dir * 6, y0: gy, x1: tx, y1: ty, ttl: 8 + k * 3, side: s.side });
              target.underFire = 90; target.calm = 0;
              if (hit && --target.hp <= 0) { target.alive = false; burst(target.x, groundAt(target.x) - 6, 8, T?.accent, sh); if (s.side === 0) { g.score += 25; pop(target.x, groundAt(target.x) - 24, "+25", T?.marquee); } }
            } else {
              const ty = enemyTank.y - 8 + (sh.rng.next() - 0.5) * 10;
              tracers.push({ x0: s.x + s.dir * 6, y0: gy, x1: enemyTank.x + (sh.rng.next() - 0.5) * 14, y1: ty, ttl: 8 + k * 3, side: s.side });
              if (sh.rng.next() < 0.35) { enemyTank.hp -= 1; if (s.side === 0) g.score += 2; }
            }
          }
          sh.audio.tone({ freq: s.weapon === "mg" ? 420 : 260, type: "square", dur: s.weapon === "mg" ? 0.18 : 0.05, slide: -120, vol: 0.04 });
        }
      }
      else if (s.state === "duck") { s.step += 0.02; }
      s.x = Math.max(6, Math.min(W - 6, s.x));
      // flags on hilltops
      if ((s.state === "advance" || s.state === "hold") && isHilltop(s.x) && !flags.some(f => Math.abs(f.x - s.x) < 60)) { flags.push({ x: s.x, side: s.side, t: 0 }); if (s.side === 0) { g.score += 50; pop(s.x, groundAt(s.x) - 40, "Flag +50", T?.marquee); } else pop(s.x, groundAt(s.x) - 40, "enemy flag", T?.textDim); sh.audio.tone({ freq: 700, type: "triangle", dur: 0.12, vol: 0.06 }); }
      for (const f of flags) if (f.side !== s.side && Math.abs(f.x - s.x) < 8) { f.side = s.side; if (s.side === 0) { g.score += 75; pop(f.x, groundAt(f.x) - 40, "Captured +75", T?.marquee); } }
    }
    for (const f of flags) f.t++;
  }
  function damage(t, dmg, sh, why) {
    let real = dmg;
    if (t.shield > 0) { const absorbed = Math.min(t.shield, dmg); t.shield -= absorbed; real = dmg - absorbed; pop(t.x, t.y - 30, `shield -${absorbed}`, T?.cyan); if (t.shield === 0) say(`${t.name}'s shield is down`, 60); }
    if (real > 0) { t.hp -= real; pop(t.x, t.y - (why === "fall" ? 30 : 36), `-${real}${why === "fall" ? " fall" : ""}`, T?.accent); }
    return real;
  }
  function afterShotCheck(sh) {
    if (tanks[1].hp <= 0) { const bonus = 500 + Math.round(Math.max(0, tanks[0].hp) * 3); g.score += bonus; earn(sh, 100, tanks[1].x, tanks[1].y - 50); say(`Ridge ${g.level} cleared! +${bonus}`, 150); sh.audio.levelUp(); }
    else if (tanks[0].hp <= 0) say("Your tank is gone", 120);
  }
  function afterShot(sh) {
    if (tanks[0].hp <= 0) return sh.end();
    if (tanks[1].hp <= 0) { g.level++; newRound(sh); return; }
    turn = 1 - turn; phase = "aim";
    wind = Math.max(-diff.windMax, Math.min(diff.windMax, wind + (sh.rng.next() - 0.5) * 1.2));
    say(turn === 0 ? "Your shot · B for shop" : "AI is aiming…", 60);
  }
  function aiShot(sh, i) {
    const me = tanks[i], target = tanks[1 - i];
    let best = null;
    for (let angle = 20; angle <= 160; angle += 5) for (let power = 20; power <= 100; power += 5) {
      const d = simulate(me, angle, power, target);
      if (d !== null && (!best || d < best.d)) best = { angle, power, d };
    }
    if (!best) best = { angle: 60, power: 60 };
    const noise = Math.max(1, diff.aiNoise - g.level * 1.2) * (i === 0 ? 0.3 : 1);
    me.angle = Math.max(5, Math.min(175, best.angle + (sh.rng.next() - 0.5) * noise));
    me.power = Math.max(10, Math.min(100, best.power + (sh.rng.next() - 0.5) * noise));
    if (i === 1 && sh.rng.next() < 0.25 && !me.shield && g.level >= 3) me.shield = 40;
  }
  function simulate(from, angle, power, target) {
    const rad = angle * Math.PI / 180, v = power * 0.12;
    let x = from.x + Math.cos(rad) * 16, y = from.y - 10 - Math.sin(rad) * 16, vx = Math.cos(rad) * v, vy = -Math.sin(rad) * v;
    for (let n = 0; n < 2000; n++) { vx += wind * 0.0025; vy += G; x += vx; y += vy; if (x < 0 || x >= W || y > H) return null; if (y >= ground[x | 0]) return Math.hypot(target.x - x, target.y - y); }
    return null;
  }

  // ---------- ambience ----------
  function ambience(sh) {
    if (!flock && scene.birds && sh.rng.next() < 0.004) { const fromLeft = sh.rng.next() < 0.5; flock = { x: fromLeft ? -40 : W + 40, y: 60 + sh.rng.int(120), vx: (fromLeft ? 1 : -1) * (0.8 + sh.rng.next()), n: 4 + sh.rng.int(6), kind: scene.birds }; }
    if (flock) { flock.x += flock.vx; if (flock.x < -120 || flock.x > W + 120) flock = null; }
    if (sh.rng.next() < 0.003) { farBooms.push({ x: 60 + sh.rng.int(W - 120), ttl: 40 }); sh.audio.tone({ freq: 70, type: "sawtooth", dur: 0.6, slide: -40, vol: 0.08 }); }
    farBooms = farBooms.filter(b => (b.ttl -= 1) > 0);
    if (scene.rain) { if (lightning > 0) lightning--; else if (sh.rng.next() < 0.004) { lightning = 14; sh.audio.tone({ freq: 55, type: "sawtooth", dur: 1.2, slide: -30, vol: 0.18 }); } for (const r of rain) { r[1] += r[2]; r[0] += wind * 1.5; if (r[1] > H) { r[1] = -10; r[0] = sh.rng.next() * W; } if (r[0] < 0) r[0] += W; if (r[0] > W) r[0] -= W; } }
    if (sh.rng.next() < 0.0015) sh.audio.tone({ freq: 90 + sh.rng.int(40), type: "sawtooth", dur: 0.5, slide: 25, vol: 0.05 });
  }

  function hud() { const t = tanks[0]; return `${diff.name} · ${WEAPONS[weapon].name}${ammo[weapon] === Infinity ? "" : " ×" + ammo[weapon]} · angle ${Math.round(t.angle)}° · power ${Math.round(t.power)} · wind ${wind > 0 ? "→" : "←"} ${Math.abs(wind).toFixed(1)} · HP ${Math.max(0, t.hp)}${t.shield ? " +" + t.shield + " shield" : ""} vs ${Math.max(0, tanks[1].hp)}`; }

  // ---------- render ----------
  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    c.save();
    if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.8, (Math.random() - 0.5) * shake * 0.8);
    const sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, scene.top); sky.addColorStop(0.55, scene.mid); sky.addColorStop(1, scene.bot);
    c.fillStyle = sky; c.fillRect(-10, -10, W + 20, H + 20);
    if (lightning > 0) { c.fillStyle = `rgba(255,255,255,${lightning / 28})`; c.fillRect(-10, -10, W + 20, H + 20); if (lightning > 8) drawBolt(c, 100 + ((tick * 37) % (W - 200))); }
    if (scene.stars) { c.fillStyle = "#fff"; for (const [x, y, s] of stars) { c.globalAlpha = scene.stars * (0.3 + 0.6 * Math.abs(Math.sin(tick / 40 + s * 7))); c.fillRect(x, y, s > 0.8 ? 2 : 1, s > 0.8 ? 2 : 1); } c.globalAlpha = 1; }
    if (scene.sun) { const s = scene.sun; c.shadowColor = s.color; c.shadowBlur = 40; c.fillStyle = s.color; c.beginPath(); c.arc(s.x, s.y, s.r, 0, 7); c.fill(); c.shadowBlur = 0; }
    if (scene.moon) { const m = scene.moon; c.shadowColor = m.color; c.shadowBlur = 30; c.fillStyle = m.color; c.beginPath(); c.arc(m.x, m.y, m.r, 0, 7); c.fill(); c.shadowBlur = 0; c.fillStyle = "rgba(0,0,0,0.12)"; c.beginPath(); c.arc(m.x - m.r * 0.3, m.y - m.r * 0.2, m.r * 0.22, 0, 7); c.fill(); c.beginPath(); c.arc(m.x + m.r * 0.35, m.y + m.r * 0.3, m.r * 0.15, 0, 7); c.fill(); }
    c.fillStyle = shade(scene.tint, -0.1); c.beginPath(); c.moveTo(0, H); for (let x = 0; x <= W; x += 8) c.lineTo(x, ground[Math.min(W - 1, x)] * 0.75 + 60 + Math.sin(x * 0.03) * 8); c.lineTo(W, H); c.fill();
    for (const b of farBooms) { const y = ground[Math.min(W - 1, b.x | 0)] * 0.75 + 60; c.globalAlpha = b.ttl / 40; c.fillStyle = T.marquee; c.shadowColor = T.marquee; c.shadowBlur = 20; c.beginPath(); c.arc(b.x, y, (40 - b.ttl) * 0.4 + 3, 0, 7); c.fill(); c.shadowBlur = 0; }
    c.globalAlpha = 1;
    if (flock) drawFlock(c);
    const tg = c.createLinearGradient(0, 150, 0, H); tg.addColorStop(0, shade(scene.tint, 0.3)); tg.addColorStop(0.5, scene.tint); tg.addColorStop(1, shade(scene.tint, -0.5));
    c.fillStyle = tg; c.beginPath(); c.moveTo(0, H); for (let x = 0; x < W; x++) c.lineTo(x, ground[x]); c.lineTo(W, H); c.closePath(); c.fill();
    c.strokeStyle = shade(scene.tint, 0.55); c.lineWidth = 2; c.beginPath(); for (let x = 0; x < W; x++) c.lineTo(x, ground[x]); c.stroke();
    if (rain) { c.strokeStyle = "rgba(200,220,255,0.35)"; c.lineWidth = 1; c.beginPath(); for (const [x, y, v] of rain) { c.moveTo(x, y); c.lineTo(x + wind * 1.5, y + v); } c.stroke(); }
    for (const b of bunkers) { const y = groundAt(b.x); c.fillStyle = "#5E4A2E"; c.beginPath(); c.ellipse(b.x, y + 1, 16, 7, 0, Math.PI, 0); c.fill(); c.fillStyle = "#8A6E48"; for (let i = -2; i <= 2; i++) { c.beginPath(); c.ellipse(b.x + i * 6, y - 4 - (Math.abs(i) % 2) * 3, 4, 2.5, 0, 0, 7); c.fill(); } }
    for (const f of flags) { const y = groundAt(f.x), col = f.side === 0 ? T.cyan : T.accent; c.strokeStyle = "#ddd"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(f.x, y); c.lineTo(f.x, y - 26); c.stroke(); c.fillStyle = col; c.beginPath(); c.moveTo(f.x, y - 26); for (let i = 0; i <= 12; i++) c.lineTo(f.x + i, y - 26 + Math.sin(tick / 6 + i / 2) * 1.5 + i * 0.1); for (let i = 12; i >= 0; i--) c.lineTo(f.x + i, y - 18 + Math.sin(tick / 6 + i / 2) * 1.5); c.closePath(); c.fill(); }
    for (const s of troops) if (s.alive) drawTroop(c, s);
    for (const t of tracers) { c.strokeStyle = t.side === 0 ? "#FFF2A8" : "#FFB0B0"; c.globalAlpha = Math.min(1, t.ttl / 6); c.lineWidth = 1.2; c.shadowColor = c.strokeStyle; c.shadowBlur = 6; c.beginPath(); c.moveTo(t.x0, t.y0); c.lineTo(t.x1, t.y1); c.stroke(); c.shadowBlur = 0; } c.globalAlpha = 1;
    for (const [i, t] of tanks.entries()) drawTank(c, t, i === 0 ? T.cyan : T.accent, i === turn && phase === "aim");
    if (turn === 0 && phase === "aim" && !g.autopilot && !shop && !WEAPONS[weapon].drone) {
      const t = tanks[0], a = hoverAim || { angle: t.angle, power: t.power };
      c.setLineDash([3, 6]); c.strokeStyle = hoverAim ? T.marquee : "#ffffff99"; c.lineWidth = 1.5; c.beginPath();
      const rad = a.angle * Math.PI / 180, v = a.power * 0.12 * g.run.barrel; let x = t.x + Math.cos(rad) * 16, y = t.y - 10 - Math.sin(rad) * 16, vx = Math.cos(rad) * v, vy = -Math.sin(rad) * v;
      c.moveTo(x, y);
      for (let n = 0; n < 45; n++) { vx += wind * 0.0025; vy += G; x += vx; y += vy; if (y >= ground[Math.max(0, Math.min(W - 1, x | 0))]) break; c.lineTo(x, y); }
      c.stroke(); c.setLineDash([]);
    }
    for (const s of shells) {
      c.strokeStyle = T.marquee; c.lineWidth = 2; c.globalAlpha = 0.6; c.beginPath(); for (const [x, y] of s.trail) c.lineTo(x, y); c.stroke(); c.globalAlpha = 1;
      c.shadowColor = T.marquee; c.shadowBlur = 14; c.fillStyle = T.marquee;
      if (WEAPONS[s.kind]?.drone) { c.fillStyle = T.text; c.beginPath(); c.moveTo(s.x - 8, s.y); c.lineTo(s.x + 8, s.y); c.lineTo(s.x, s.y + 4); c.closePath(); c.fill(); c.fillRect(s.x - 1, s.y - 4, 2, 4); }
      else { c.beginPath(); c.arc(s.x, s.y, s.kind === "bomblet" ? 2.5 : s.kind === "heavy" ? 5 : 3.5, 0, 7); c.fill(); }
      c.shadowBlur = 0;
    }
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 20); c.fillStyle = p.color || T.marquee; c.beginPath(); c.arc(p.x, p.y, 2, 0, 7); c.fill(); }
    c.globalAlpha = 1;
    drawTopBar(c, sh);
    for (const p of popups) { const k = 1 - p.ttl / 60; c.globalAlpha = Math.min(1, p.ttl / 15); c.fillStyle = p.color || T.text; c.font = "800 15px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.shadowColor = "#000"; c.shadowBlur = 6; c.fillText(p.text, p.x, p.y - k * 26); c.shadowBlur = 0; }
    c.globalAlpha = 1;
    if (msgTtl > 0 && msg) { c.font = "700 16px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; const tw = c.measureText(msg).width + 24; c.fillStyle = "#000"; c.globalAlpha = 0.6; rr(c, W / 2 - tw / 2, H - 36, tw, 26, 13); c.fill(); c.globalAlpha = 1; c.fillStyle = T.marquee; c.fillText(msg, W / 2, H - 23); }
    if (shop) drawShop(c, sh);
    c.restore();
  }
  function drawTopBar(c, sh) {
    c.fillStyle = "rgba(0,0,0,0.45)"; c.fillRect(0, 0, W, 44);
    WEAPON_IDS.forEach((id, i) => {
      const x = 8 + i * 56, have = ammo[id] || 0, on = id === weapon;
      c.fillStyle = on ? T.marquee : have ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.05)"; rr(c, x, 6, 50, 32, 7); c.fill();
      c.fillStyle = on ? "#000" : have ? "#fff" : "rgba(255,255,255,0.35)"; c.font = "700 10px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(WEAPONS[id].name.split(" ")[0], x + 25, 16); c.font = "11px system-ui,sans-serif"; c.fillText(`${i + 1} · ${have === Infinity ? "∞" : have}`, x + 25, 29);
    });
    c.fillStyle = "#fff"; c.font = "11px system-ui,sans-serif"; c.textAlign = "center"; c.fillText("wind", W - 150, 12);
    c.strokeStyle = T.cyan; c.lineWidth = 3; c.beginPath(); c.moveTo(W - 150 - wind * 14, 28); c.lineTo(W - 150 + wind * 14, 28); c.stroke();
    const tip = W - 150 + wind * 14, dir = Math.sign(wind) || 1; c.beginPath(); c.moveTo(tip, 28); c.lineTo(tip - dir * 6, 23); c.lineTo(tip - dir * 6, 33); c.closePath(); c.fillStyle = T.cyan; c.fill();
    c.fillStyle = T.marquee; rr(c, W - 66, 8, 58, 28, 8); c.fill(); c.fillStyle = "#000"; c.font = "700 12px system-ui,sans-serif"; c.fillText("Shop (B)", W - 37, 22);
    c.fillStyle = T.cyan; c.font = "700 12px system-ui,sans-serif"; c.textAlign = "right"; c.fillText(`${(sh.wallet?.balance ?? 0).toLocaleString()} cr`, W - 76, 22);
  }
  function drawShop(c, sh) {
    const b = shopBox();
    c.fillStyle = "rgba(0,0,0,0.55)"; c.fillRect(-10, -10, W + 20, H + 20);
    c.fillStyle = T.surface; c.shadowColor = "#000"; c.shadowBlur = 30; rr(c, b.x, b.y, b.w, b.h, 14); c.fill(); c.shadowBlur = 0;
    c.strokeStyle = "#ffffff22"; c.lineWidth = 1; rr(c, b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, 14); c.stroke();
    c.fillStyle = T.text; c.font = "800 18px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText("Armory", b.x + 16, b.y + 22);
    c.fillStyle = T.cyan; c.textAlign = "right"; c.font = "700 14px system-ui,sans-serif"; c.fillText(`${(sh.wallet?.balance ?? 0).toLocaleString()} credits`, b.x + b.w - 16, b.y + 22);
    shop.items.forEach((it, i) => {
      const def = it.kind === "weapon" ? WEAPONS[it.id] : UPGRADES[it.id], y = b.y + 44 + i * 30;
      const can = (sh.wallet?.balance ?? 0) >= def.cost;
      c.fillStyle = i % 2 ? "rgba(255,255,255,0.04)" : "transparent"; c.fillRect(b.x + 8, y, b.w - 16, 30);
      c.fillStyle = can ? T.text : T.textDim; c.font = "700 13px system-ui,sans-serif"; c.textAlign = "left"; c.fillText(def.name + (it.kind === "weapon" && ammo[it.id] ? ` ×${ammo[it.id]}` : ""), b.x + 16, y + 15);
      c.fillStyle = T.textDim; c.font = "11px system-ui,sans-serif"; c.fillText(def.desc, b.x + 170, y + 15, b.w - 250);
      c.fillStyle = can ? T.marquee : T.textDim; c.font = "700 13px system-ui,sans-serif"; c.textAlign = "right"; c.fillText(def.cost + " cr", b.x + b.w - 16, y + 15);
    });
    c.fillStyle = T.textDim; c.font = "12px system-ui,sans-serif"; c.textAlign = "center"; c.fillText("Click an item to buy · click outside or press B to close", b.x + b.w / 2, b.y + b.h - 18);
  }
  function drawBolt(c, x) {
    c.strokeStyle = "#fff"; c.lineWidth = 2; c.shadowColor = "#fff"; c.shadowBlur = 16; c.beginPath(); c.moveTo(x, 0);
    let y = 0; while (y < 200) { y += 20 + (tick * 13 + y) % 18; x += ((tick * 7 + y) % 30) - 15; c.lineTo(x, y); }
    c.stroke(); c.shadowBlur = 0;
  }
  function drawFlock(c) {
    c.strokeStyle = flock.kind === "bats" ? "#1a1a2a" : "#000"; c.lineWidth = 1.5; c.globalAlpha = 0.8;
    for (let i = 0; i < flock.n; i++) {
      const x = flock.x - i * 11 * Math.sign(flock.vx) + (i % 2) * 4, y = flock.y + i * 3 + Math.sin(tick / 9 + i) * 2, w = Math.sin(tick / 4 + i) * 3;
      c.beginPath(); c.moveTo(x - 5, y + w); c.lineTo(x, y); c.lineTo(x + 5, y + w); c.stroke();
    }
    c.globalAlpha = 1;
  }
  function drawTroop(c, s) {
    const y = groundAt(s.x), col = s.side === 0 ? T.cyan : T.accent, moving = s.state === "advance" || s.state === "retreat";
    const duck = s.state === "duck" || s.state === "fire" ? 3 : 0, bob = moving ? Math.abs(Math.sin(s.step)) * 1.5 : 0, h = 10 - duck;
    c.strokeStyle = shade(col, -0.3); c.lineWidth = 1.2;
    // legs: walking, kneeling, or standing
    c.beginPath(); if (moving) { c.moveTo(s.x, y - 3 - bob); c.lineTo(s.x - 2.5 * Math.sin(s.step * 2), y); c.moveTo(s.x, y - 3 - bob); c.lineTo(s.x + 2.5 * Math.sin(s.step * 2), y); } else if (duck) { c.moveTo(s.x, y - 3); c.lineTo(s.x - s.dir * 3, y); c.moveTo(s.x, y - 3); c.lineTo(s.x + s.dir * 2, y - 1); c.lineTo(s.x + s.dir * 3, y); } else { c.moveTo(s.x - 1, y - 3); c.lineTo(s.x - 1.5, y); c.moveTo(s.x + 1, y - 3); c.lineTo(s.x + 1.5, y); } c.stroke();
    c.fillStyle = shade(col, -0.3); c.fillRect(s.x - 1.5, y - h + 2 - bob, 3, h - 5); // body
    c.fillStyle = col; c.beginPath(); c.arc(s.x, y - h - bob, 2, 0, 7); c.fill(); // head
    c.fillStyle = shade(col, -0.5); c.fillRect(s.x - 2.5, y - h - 2 - bob, 5, 1.5); // helmet brim
    if (s.state === "dig") { c.strokeStyle = "#ccc"; c.beginPath(); const a = Math.sin(s.step) * 0.8; c.moveTo(s.x, y - 6); c.lineTo(s.x + s.dir * (6 + a * 2), y - 2 + a * 3); c.stroke(); c.fillStyle = "#8A6E48"; c.fillRect(s.x + s.dir * 8 - 2, y - 2, 4, 2); }
    else { // weapon
      c.strokeStyle = s.weapon === "mg" ? "#ddd" : shade(col, -0.3); c.lineWidth = s.weapon === "mg" ? 1.8 : 1.2; c.beginPath(); c.moveTo(s.x, y - h + 3 - bob); c.lineTo(s.x + s.dir * (s.weapon === "mg" ? 7 : 5), y - h + 2 - bob); c.stroke();
      if (s.weapon === "mg" && duck) { c.strokeStyle = "#999"; c.lineWidth = 1; c.beginPath(); c.moveTo(s.x + s.dir * 6, y - h + 2); c.lineTo(s.x + s.dir * 6, y); c.stroke(); } // bipod
      if (s.flash > 0 && s.flash % 4 > 1) { c.fillStyle = "#FFF2A8"; c.shadowColor = "#FFF2A8"; c.shadowBlur = 8; c.beginPath(); c.arc(s.x + s.dir * (s.weapon === "mg" ? 9 : 7), y - h + 2 - bob, 2.2, 0, 7); c.fill(); c.shadowBlur = 0; }
    }
    if (s.hp < 2) { c.fillStyle = T.accent; c.fillRect(s.x - 3, y - h - 6 - bob, 6, 1.5); }
  }
  function drawTank(c, t, color, active) {
    const x = t.x, y = t.y;
    c.fillStyle = "#00000088"; rr(c, x - 18, y - 36, 36, 5, 2); c.fill();
    c.fillStyle = t.hp > t.maxHp * 0.3 ? color : T.accent; rr(c, x - 18, y - 36, 36 * Math.max(0, t.hp) / t.maxHp, 5, 2); c.fill();
    if (t.shield > 0) { c.globalAlpha = 0.25 + 0.1 * Math.sin(tick / 5); c.fillStyle = T.cyan; c.beginPath(); c.arc(x, y - 8, 26, 0, 7); c.fill(); c.globalAlpha = 0.8; c.strokeStyle = T.cyan; c.lineWidth = 1.5; c.stroke(); c.globalAlpha = 1; }
    c.fillStyle = "#00000066"; c.beginPath(); c.ellipse(x + 2, y + 2, 18, 7, 0, 0, 7); c.fill();
    const bg = c.createLinearGradient(x, y - 16, x, y); bg.addColorStop(0, shade(color, 0.35)); bg.addColorStop(1, shade(color, -0.4));
    c.fillStyle = bg; c.beginPath(); c.moveTo(x - 16, y); c.lineTo(x - 12, y - 8); c.lineTo(x + 12, y - 8); c.lineTo(x + 16, y); c.closePath(); c.fill();
    c.beginPath(); c.arc(x, y - 8, 7, Math.PI, 0); c.fill();
    const rad = t.angle * Math.PI / 180;
    c.strokeStyle = shade(color, -0.2); c.lineWidth = 4; c.lineCap = "round"; c.beginPath(); c.moveTo(x, y - 10); c.lineTo(x + Math.cos(rad) * 16, y - 10 - Math.sin(rad) * 16); c.stroke();
    c.fillStyle = shade(color, -0.6); rr(c, x - 17, y - 3, 34, 5, 2); c.fill();
    if (active) { c.globalAlpha = 0.4 + 0.3 * Math.sin(tick / 6); c.strokeStyle = color; c.lineWidth = 2; c.beginPath(); c.arc(x, y - 6, 24, 0, 7); c.stroke(); c.globalAlpha = 1; }
    c.fillStyle = "#fff"; c.font = "11px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.shadowColor = "#000"; c.shadowBlur = 4; c.fillText(t.name, x, y - 44); c.shadowBlur = 0;
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
