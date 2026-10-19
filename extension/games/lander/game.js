// Lunar Lander — bring the module down on a pad. ←/→ rotate, ↑ (or Space) thrust. Land upright and
// slow (vertical < 1.5, horizontal < 0.8, tilt < 12°) on a flat pad; pads with higher multipliers are
// smaller and tucked into rougher ground. Fuel carries over between landings; running dry means
// you're falling. Each landing pays credits; crashes cost a lander.
const W = 640, H = 440, GRAV = 0.0045;
const DIFFICULTY = {
  beginner:     { name: "Beginner",     fuel: 1400, landers: 4, gravity: 0.8, pads: 4 },
  intermediate: { name: "Intermediate", fuel: 1000, landers: 3, gravity: 1.0, pads: 3 },
  advanced:     { name: "Advanced",     fuel: 700,  landers: 2, gravity: 1.25, pads: 2 },
};

export default function createLander({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0;
  const g = { id: "lander", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, hud };
  let ground, pads, lander, fuel, landers, particles, popups, stars, msg, msgTtl, shake, phase, phaseT, landings, lastLand;

  function init(sh) { g.score = 0; g.level = 1; landers = diff.landers; fuel = diff.fuel; landings = 0; particles = []; popups = []; shake = 0; stars = Array.from({ length: 90 }, () => [sh.rng.next() * W, sh.rng.next() * H * 0.7, sh.rng.next()]); newTerrain(sh); spawnLander(sh); }
  function newTerrain(sh) {
    ground = new Float32Array(W); pads = [];
    const rough = 1 + g.level * 0.25;
    let y = 300 + sh.rng.int(60); const pts = [[0, y]];
    for (let x = 30 + sh.rng.int(30); x < W; x += 20 + sh.rng.int(40)) { y = Math.max(180, Math.min(H - 30, y + (sh.rng.next() - 0.5) * 70 * rough)); pts.push([x, y]); }
    pts.push([W, y]);
    for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; for (let x = x0; x < x1 && x < W; x++) ground[x] = y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
    // carve pads: flat segments, multiplier by width
    for (let i = 0; i < diff.pads; i++) {
      const mult = i === 0 ? 1 : 1 + i + sh.rng.int(2), width = mult === 1 ? 70 : mult <= 3 ? 46 : 34;
      let px; for (let tries = 0; tries < 30; tries++) { px = 30 + sh.rng.int(W - 60 - width); if (!pads.some(p => Math.abs(p.x - px) < 110)) break; }
      const py = ground[px + width / 2 | 0];
      for (let x = px; x < px + width; x++) ground[x] = py;
      for (let x = px - 8; x < px; x++) if (x >= 0) ground[x] = ground[x] + (py - ground[x]) * (1 - (px - x) / 8);
      for (let x = px + width; x < px + width + 8; x++) if (x < W) ground[x] = ground[x] + (py - ground[x]) * (1 - (x - px - width) / 8);
      pads.push({ x: px, w: width, y: py, mult });
    }
  }
  function spawnLander(sh) { lander = { x: 60 + sh.rng.int(W - 120), y: 50, vx: (sh.rng.next() - 0.5) * 1.2, vy: 0, a: 0, thrust: false }; phase = "fly"; phaseT = 0; }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x, y, text, color, ttl: 70 }); }
  function onInput() {}

  function update(sh) {
    tick = sh.tick;
    if (msgTtl > 0) msgTtl--; if (shake > 0) shake--;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.03; }
    popups = popups.filter(p => (p.ttl -= 1) > 0);
    if (phase !== "fly") { if (++phaseT > 120) { if (phase === "crash" && landers <= 0) return sh.end(); if (phase === "landed" && landings % 3 === 0) { g.level++; newTerrain(sh); } spawnLander(sh); } return; }
    let l = sh.input?.isDown?.("left"), r = sh.input?.isDown?.("right"), up = sh.input?.isDown?.("up") || sh.input?.isDown?.("action");
    if (g.autopilot) { // aim for the best pad we can reach: kill horizontal drift, then descend slowly
      const pad = pads.slice().sort((a, b) => Math.abs(a.x + a.w / 2 - lander.x) - Math.abs(b.x + b.w / 2 - lander.x))[0];
      const dx = pad.x + pad.w / 2 - lander.x, alt = pad.y - lander.y, over = Math.abs(dx) < 18;
      const gx = Math.max(0, Math.min(W - 1, lander.x + Math.sign(lander.vx) * 30 | 0)), clearance = Math.min(ground[gx], ground[Math.max(0, Math.min(W - 1, lander.x | 0))]) - lander.y;
      const wantVx = over ? 0 : Math.max(-1.4, Math.min(1.4, dx * 0.02)), wantA = Math.max(-0.55, Math.min(0.55, (wantVx - lander.vx) * 0.9));
      l = lander.a > wantA + 0.02; r = lander.a < wantA - 0.02;
      let safeVy = over ? Math.min(1.1, 0.25 + alt * 0.012) : 0.15; // travel level, descend only when over the pad
      if (!over && clearance < 70) safeVy = -0.3; // climb away from terrain
      up = lander.vy > safeVy;
    }
    if (l) lander.a -= 0.035; if (r) lander.a += 0.035; lander.a = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, lander.a));
    lander.thrust = !!up && fuel > 0;
    if (lander.thrust) { fuel -= 1; lander.vx += Math.sin(lander.a) * 0.012; lander.vy -= Math.cos(lander.a) * 0.012; if (tick % 2 === 0) particles.push({ x: lander.x - Math.sin(lander.a) * 12, y: lander.y + Math.cos(lander.a) * 12, vx: -Math.sin(lander.a) * 2 + (sh.rng.next() - 0.5), vy: Math.cos(lander.a) * 2 + (sh.rng.next() - 0.5), ttl: 18, color: T?.marquee }); if (tick % 6 === 0) sh.audio.tone({ freq: 80, type: "sawtooth", dur: 0.1, vol: 0.05 }); }
    lander.vy += GRAV * diff.gravity; lander.x += lander.vx; lander.y += lander.vy;
    if (lander.x < 10) { lander.x = 10; lander.vx = Math.abs(lander.vx) * 0.5; } if (lander.x > W - 10) { lander.x = W - 10; lander.vx = -Math.abs(lander.vx) * 0.5; }
    if (lander.y < 20) { lander.y = 20; lander.vy = Math.max(0, lander.vy); }
    // contact: feet at ±9px
    const gy = Math.min(ground[Math.max(0, Math.min(W - 1, lander.x - 9 | 0))], ground[Math.max(0, Math.min(W - 1, lander.x + 9 | 0))]);
    if (lander.y + 12 >= gy) {
      const pad = pads.find(p => lander.x - 8 >= p.x && lander.x + 8 <= p.x + p.w);
      const ok = pad && Math.abs(lander.vy) < 1.5 && Math.abs(lander.vx) < 0.8 && Math.abs(lander.a) < 0.21;
      if (ok) {
        landings++; const soft = Math.abs(lander.vy) < 0.6 ? 2 : 1;
        const pts = Math.round((100 * pad.mult + Math.max(0, 1.5 - Math.abs(lander.vy)) * 100) * soft);
        g.score += pts; const cr = 5 * pad.mult + (soft === 2 ? 5 : 0); sh.wallet?.earn(cr);
        pop(lander.x, lander.y - 30, `${soft === 2 ? "Perfect! " : "Landed "}+${pts} · ${cr} cr`, T?.marquee);
        say(`${pad.mult}× pad${fuel < 150 ? " · low fuel" : ""}`, 110); fuel = Math.min(diff.fuel, fuel + 260); phase = "landed"; phaseT = 0; lander.y = gy - 12; lander.vx = lander.vy = 0; sh.audio.levelUp();
      } else {
        landers--; phase = "crash"; phaseT = 0; shake = 24; sh.audio.hit();
        for (let i = 0; i < 60; i++) { const a = sh.rng.next() * 6.28, sp = 0.5 + sh.rng.next() * 3; particles.push({ x: lander.x, y: lander.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, ttl: 40 + sh.rng.int(40), color: i % 2 ? T?.accent : T?.marquee }); }
        const why = !pad ? "not on a pad" : Math.abs(lander.a) >= 0.21 ? "too much tilt" : Math.abs(lander.vy) >= 1.5 ? "too fast" : "drifting sideways";
        say(`Crashed — ${why}${landers > 0 ? ` · ${landers} left` : ""}`, 120);
      }
    }
  }
  function hud() { return `${diff.name} · ${landings} landings · fuel ${Math.max(0, fuel)} · ${landers} landers · vy ${lander?.vy.toFixed(1) ?? "-"} vx ${lander?.vx.toFixed(1) ?? "-"}`; }

  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    c.save(); if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.6, (Math.random() - 0.5) * shake * 0.6);
    c.fillStyle = "#04060D"; c.fillRect(-10, -10, W + 20, H + 20);
    c.fillStyle = "#fff"; for (const [x, y, s] of stars) { c.globalAlpha = 0.2 + 0.6 * Math.abs(Math.sin(tick / 50 + s * 9)); c.fillRect(x, y, s > 0.85 ? 2 : 1, s > 0.85 ? 2 : 1); } c.globalAlpha = 1;
    // Earth in the distance
    const eg = c.createRadialGradient(560, 70, 4, 560, 70, 22); eg.addColorStop(0, "#9BD0FF"); eg.addColorStop(0.6, "#2D74C8"); eg.addColorStop(1, "#0A2A55"); c.fillStyle = eg; c.shadowColor = "#5FA8FF"; c.shadowBlur = 20; c.beginPath(); c.arc(560, 70, 22, 0, 7); c.fill(); c.shadowBlur = 0;
    // terrain
    const tg = c.createLinearGradient(0, 180, 0, H); tg.addColorStop(0, "#8E8A82"); tg.addColorStop(0.4, "#5C5953"); tg.addColorStop(1, "#1E1D1B");
    c.fillStyle = tg; c.beginPath(); c.moveTo(0, H); for (let x = 0; x < W; x++) c.lineTo(x, ground[x]); c.lineTo(W, H); c.closePath(); c.fill();
    c.strokeStyle = "#CFCAC0"; c.lineWidth = 1.5; c.beginPath(); for (let x = 0; x < W; x++) c.lineTo(x, ground[x]); c.stroke();
    for (const p of pads) { c.fillStyle = T.cyan; c.shadowColor = T.cyan; c.shadowBlur = 10; c.fillRect(p.x, p.y - 2, p.w, 3); c.shadowBlur = 0; c.fillStyle = "#fff"; c.font = "700 11px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(`${p.mult}×`, p.x + p.w / 2, p.y + 12); c.fillStyle = T.cyan; c.globalAlpha = 0.5 + 0.5 * Math.sin(tick / 8); c.fillRect(p.x, p.y - 2, 3, 3); c.fillRect(p.x + p.w - 3, p.y - 2, 3, 3); c.globalAlpha = 1; }
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color || "#fff"; c.fillRect(p.x, p.y, 2.5, 2.5); } c.globalAlpha = 1;
    if (lander && phase !== "crash") drawLander(c);
    // instruments
    c.fillStyle = "rgba(0,0,0,0.5)"; c.fillRect(0, 0, 160, 92);
    c.fillStyle = "#fff"; c.font = "12px ui-monospace,monospace"; c.textAlign = "left"; c.textBaseline = "middle";
    const vyBad = lander && Math.abs(lander.vy) >= 1.5, vxBad = lander && Math.abs(lander.vx) >= 0.8, aBad = lander && Math.abs(lander.a) >= 0.21;
    c.fillText("ALT", 10, 14); c.fillText(lander ? String(Math.max(0, Math.round(ground[Math.max(0, Math.min(W - 1, lander.x | 0))] - lander.y - 12))) : "-", 70, 14);
    c.fillStyle = vyBad ? T.accent : "#fff"; c.fillText("VSPD", 10, 30); c.fillText(lander ? lander.vy.toFixed(2) : "-", 70, 30);
    c.fillStyle = vxBad ? T.accent : "#fff"; c.fillText("HSPD", 10, 46); c.fillText(lander ? lander.vx.toFixed(2) : "-", 70, 46);
    c.fillStyle = aBad ? T.accent : "#fff"; c.fillText("TILT", 10, 62); c.fillText(lander ? Math.round(lander.a * 57.3) + "°" : "-", 70, 62);
    c.fillStyle = "#fff"; c.fillText("FUEL", 10, 78); c.fillStyle = "#ffffff22"; c.fillRect(70, 74, 80, 8); c.fillStyle = fuel < 150 ? T.accent : T.marquee; c.fillRect(70, 74, 80 * Math.max(0, fuel) / diff.fuel, 8);
    c.fillStyle = T.cyan; for (let i = 0; i < landers; i++) { c.beginPath(); c.moveTo(W - 14 - i * 16, 8); c.lineTo(W - 8 - i * 16, 20); c.lineTo(W - 20 - i * 16, 20); c.closePath(); c.fill(); }
    for (const p of popups) { const k = 1 - p.ttl / 70; c.globalAlpha = Math.min(1, p.ttl / 15); c.fillStyle = p.color || "#fff"; c.font = "800 14px system-ui,sans-serif"; c.textAlign = "center"; c.shadowColor = "#000"; c.shadowBlur = 6; c.fillText(p.text, p.x, p.y - k * 22); c.shadowBlur = 0; } c.globalAlpha = 1;
    if (msgTtl > 0 && msg) { c.font = "800 20px 'Chakra Petch',system-ui,sans-serif"; c.textAlign = "center"; c.fillStyle = T.marquee; c.shadowColor = "#000"; c.shadowBlur = 10; c.globalAlpha = Math.min(1, msgTtl / 20); c.fillText(msg, W / 2, 120); c.shadowBlur = 0; c.globalAlpha = 1; }
    c.restore();
  }
  function drawLander(c) {
    c.save(); c.translate(lander.x, lander.y); c.rotate(lander.a);
    if (lander.thrust) { c.fillStyle = T.marquee; c.shadowColor = T.marquee; c.shadowBlur = 16; c.beginPath(); c.moveTo(-4, 12); c.lineTo(0, 22 + Math.random() * 10); c.lineTo(4, 12); c.closePath(); c.fill(); c.shadowBlur = 0; }
    c.strokeStyle = "#D8D4CC"; c.lineWidth = 2; c.beginPath(); c.moveTo(-7, 6); c.lineTo(-12, 13); c.moveTo(7, 6); c.lineTo(12, 13); c.stroke(); c.fillStyle = "#D8D4CC"; c.fillRect(-15, 12, 7, 2); c.fillRect(8, 12, 7, 2);
    const bg = c.createLinearGradient(-10, 0, 10, 0); bg.addColorStop(0, "#A8A39A"); bg.addColorStop(0.5, "#E6E2DA"); bg.addColorStop(1, "#8C8880");
    c.fillStyle = bg; c.beginPath(); c.moveTo(-10, 8); c.lineTo(10, 8); c.lineTo(8, -2); c.lineTo(-8, -2); c.closePath(); c.fill();
    c.fillStyle = "#C9C5BD"; c.beginPath(); c.arc(0, -6, 7, Math.PI, 0); c.lineTo(7, -2); c.lineTo(-7, -2); c.closePath(); c.fill();
    c.fillStyle = "#1B2A3D"; c.beginPath(); c.arc(0, -6, 3.5, 0, 7); c.fill();
    c.restore();
  }
  return g;
}
