// Rail Switch — four lines, trains from both ends. Engines pull a random number of coal cars at their
// own speed; two trains on one line will meet or rear-end. Draw your own crossovers: drag from a spot
// on one line to a spot on the line above or below. A train that reaches a crossover's end while
// heading toward the other end takes the curve. Click a crossover's diamond to remove it. Every car
// that reaches the far end pays. H sketches the crossover that prevents the next collision.
const W = 640, H = 420, TRACKS = 4, TY = [84, 164, 244, 324], MIN_SPAN = 40, MAX_SPAN = 220, ENG = 34, CAR = 26;
const DIFFICULTY = {
  beginner:     { name: "Beginner",     every: 300, speed: [0.7, 1.4], cars: [2, 5], lives: 4 },
  intermediate: { name: "Intermediate", every: 220, speed: [0.8, 1.9], cars: [2, 7], lives: 3 },
  advanced:     { name: "Advanced",     every: 160, speed: [0.9, 2.4], cars: [3, 9], lives: 2 },
};

const ease = (k) => k * k * (3 - 2 * k); // smoothstep: horizontal tangents at both ends
export default function createRails({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0;
  const g = { id: "rails", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, onPointer, onPointerDown, onPointerUp, onHover, hud };
  let switches, trains, spawnT, delivered, lives, particles, popups, smoke, msg, msgTtl, shake, hover, hint, hintTtl, combo, warn, drag;

  function init(sh) {
    g.score = 0; g.level = 1; delivered = 0; lives = diff.lives; particles = []; popups = []; smoke = []; shake = 0; combo = 0; hint = null; hintTtl = 0; warn = null;
    switches = []; drag = null;
    trains = []; spawnT = 60; say("Drag between two lines to lay a crossover", 150);
  }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x, y, text, color, ttl: 55 }); }
  function spawn(sh) {
    const dir = sh.rng.next() < 0.5 ? 1 : -1, track = sh.rng.int(TRACKS);
    const x0 = dir > 0 ? -40 : W + 40;
    if (trains.some(tr => Math.round(tr.y) === track && Math.abs(tr.x - x0) < 260)) return; // entrance busy
    const speed = diff.speed[0] + sh.rng.next() * (diff.speed[1] - diff.speed[0]) + g.level * 0.05;
    const cars = diff.cars[0] + sh.rng.int(diff.cars[1] - diff.cars[0] + 1);
    trains.push({ x: x0, y: track, dir, speed, cars, trail: [], color: [T?.accent, T?.marquee, "#B57BFF", "#4CD964", "#FFB454"][sh.rng.int(5)], hue: sh.rng.next(), cross: null, passed: new Set() });
  }
  // ---------- input ----------
  const mid = (s) => [(s.x0 + s.x1) / 2, (TY[s.l0] + TY[s.l1]) / 2];
  function switchAt(px, py) { for (const s of switches) { const [mx, my] = mid(s); if (Math.abs(px - mx) < 18 && Math.abs(py - my) < 18) return s; } return null; }
  function lineAt(py) { for (let i = 0; i < TRACKS; i++) if (Math.abs(py - TY[i]) < 22) return i; return -1; }
  function onHover(px, py) { hover = switchAt(px, py); if (drag) { drag.x = px; drag.y = py; } }
  function onPointerDown(px, py, sh, button) { if (button !== 0 || switchAt(px, py)) return; const l = lineAt(py); if (l < 0) return; drag = { x0: px, l0: l, x: px, y: py }; }
  function onPointerUp(px, py, sh) {
    if (!drag) return; const d = drag; drag = null;
    const l1 = lineAt(py); const span = Math.abs(px - d.x0);
    if (l1 < 0 || Math.abs(l1 - d.l0) !== 1) { if (span > 10) say("Connect two neighbouring lines", 60); return; }
    if (span < MIN_SPAN) { say("Too sharp — make it longer", 60); sh.audio.hit(); return; }
    const sw = { x0: d.x0, l0: d.l0, x1: d.x0 + Math.sign(px - d.x0) * Math.min(MAX_SPAN, span), l1 };
    if (switches.some(o => overlaps(o, sw))) { say("That crossover overlaps another", 60); sh.audio.hit(); return; }
    switches.push(sw); sh.record(1000 + Math.round(sw.x0) * 1000 + sw.l0 * 100 + Math.round(Math.abs(sw.x1 - sw.x0)) * (sw.x1 > sw.x0 ? 1 : -1)); sh.audio.tone({ freq: 520, type: "triangle", dur: 0.08, vol: 0.08 });
  }
  function overlaps(a, b) { const lines = new Set([a.l0, a.l1]); if (!lines.has(b.l0) && !lines.has(b.l1)) return false; const [a0, a1] = [Math.min(a.x0, a.x1), Math.max(a.x0, a.x1)], [b0, b1] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)]; return a0 < b1 + 10 && b0 < a1 + 10; }
  function onPointer(px, py, sh) { const s = switchAt(px, py); if (!s) return; if (trains.some(tr => tr.cross && tr.cross.sw === s)) { say("A train is on it", 50); return; } switches.splice(switches.indexOf(s), 1); sh.record(2000 + Math.round(px)); sh.audio.tone({ freq: 380, type: "triangle", dur: 0.06, vol: 0.08 }); }
  function onInput(action, sh) { if (action === "hint") { const h = findFix(); if (h) { hint = h; hintTtl = 240; g.score = Math.max(0, g.score - 25); } else say(warn ? "No single crossover fixes it" : "Nothing on a collision course", 80); } }
  // does a train at (x, line, dir) enter crossover s this step?
  function entry(s, line, dir, xPrev, xNow) {
    for (const [xe, le, xo, lo] of [[s.x0, s.l0, s.x1, s.l1], [s.x1, s.l1, s.x0, s.l0]]) {
      if (le !== line || Math.sign(xo - xe) !== dir) continue;
      if ((dir > 0 && xNow >= xe && xPrev < xe) || (dir < 0 && xNow <= xe && xPrev > xe)) return { from: le, to: lo, x0: xe, x1: xo, sw: s };
    }
    return null;
  }

  // ---------- simulation ----------
  function update(sh) {
    tick = sh.tick;
    if (msgTtl > 0) msgTtl--; if (shake > 0) shake--; if (hintTtl > 0 && --hintTtl === 0) hint = null;
    particles = particles.filter(p => (p.ttl -= 1) > 0); for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.08; }
    smoke = smoke.filter(p => (p.ttl -= 1) > 0); for (const p of smoke) { p.x += p.vx; p.y -= 0.5; p.r += 0.15; }
    popups = popups.filter(p => (p.ttl -= 1) > 0);
    if (--spawnT <= 0) { spawnT = Math.max(90, diff.every - g.level * 10); spawn(sh); }
    for (const tr of trains) {
      tr.x += tr.dir * tr.speed;
      if (!tr.cross) for (const s of switches) { if (tr.passed.has(s)) continue; const e = entry(s, Math.round(tr.y), tr.dir, tr.x - tr.dir * tr.speed, tr.x); if (e) { tr.cross = e; tr.passed.add(s); sh.audio.tone({ freq: 200, type: "sawtooth", dur: 0.1, vol: 0.05 }); break; } }
      if (tr.cross) { const k = Math.min(1, Math.abs(tr.x - tr.cross.x0) / Math.abs(tr.cross.x1 - tr.cross.x0)); tr.y = tr.cross.from + (tr.cross.to - tr.cross.from) * ease(k); if (k >= 1) { tr.y = tr.cross.to; tr.cross = null; } }
      tr.trail.unshift([tr.x, tr.y]); if (tr.trail.length > 900) tr.trail.pop();
      if (tick % 4 === 0) smoke.push({ x: tr.x + tr.dir * 8, y: TY[0] + (tr.y) * 80 - 20, vx: -tr.dir * 0.3 + (sh.rng.next() - 0.5) * 0.3, r: 2, ttl: 40 });
      const tail = tr.x - tr.dir * (ENG + tr.cars * CAR);
      if ((tr.dir > 0 && tail > W + 10) || (tr.dir < 0 && tail < -10)) { tr.done = true; delivered += tr.cars; combo++; const pts = tr.cars * 10 * Math.min(5, combo); g.score += pts; sh.wallet?.earn(tr.cars); pop(tr.dir > 0 ? W - 60 : 60, TY[Math.round(tr.y)] - 24, `+${pts} · ${tr.cars} cr`, T?.marquee); sh.audio.eat(); if (delivered >= g.level * 40) { g.level++; say(`Level ${g.level} · faster`, 90); sh.audio.levelUp(); } }
    }
    trains = trains.filter(t => !t.done);
    // collisions: same line, bodies overlap
    for (let i = 0; i < trains.length; i++) for (let j = i + 1; j < trains.length; j++) {
      const a = trains[i], b = trains[j]; if (Math.abs(a.y - b.y) > 0.45) continue;
      const [a0, a1] = span(a), [b0, b1] = span(b);
      if (a0 < b1 && b0 < a1) { crash(a, b, sh); return; }
    }
    warn = predict();
    if (g.autopilot && tick % 20 === 0) { const h = findFix(); if (h) { switches.push(h); sh.audio.tone({ freq: 520, type: "triangle", dur: 0.08, vol: 0.08 }); } }
    // autopilot tidies: remove crossovers no train is near, so old ones don't cause surprises
    if (g.autopilot && tick % 90 === 0) switches = switches.filter(s => trains.some(tr => tr.cross?.sw === s || Math.abs(tr.x - (s.x0 + s.x1) / 2) < 200));
  }
  function span(tr) { const head = tr.x + tr.dir * 6, tail = tr.x - tr.dir * (ENG + tr.cars * CAR); return [Math.min(head, tail), Math.max(head, tail)]; }
  function crash(a, b, sh) {
    const x = (a.x + b.x) / 2, y = TY[Math.round(a.y)];
    for (let i = 0; i < 70; i++) { const an = sh.rng.next() * 6.28, sp = 0.5 + sh.rng.next() * 4; particles.push({ x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 2, ttl: 30 + sh.rng.int(40), color: i % 3 ? T?.accent : T?.marquee }); }
    shake = 24; sh.audio.hit(); combo = 0; lives--; a.done = true; b.done = true; trains = trains.filter(t => !t.done);
    say(lives > 0 ? `Collision! ${lives} ${lives === 1 ? "strike" : "strikes"} left` : "Collision — line closed", 110);
    if (lives <= 0) sh.end();
  }
  // simulate ahead (no switch changes) and return the first pair that would collide, with time-to-impact
  function predict(sw = switches, horizon = 420) { const sim = trains;
    const st = sim.map(tr => ({ x: tr.x, y: tr.y, dir: tr.dir, speed: tr.speed, cars: tr.cars, cross: tr.cross ? { ...tr.cross } : null, passed: new Set(tr.passed), ref: tr }));
    for (let t = 0; t < horizon; t += 3) {
      for (const tr of st) {
        tr.x += tr.dir * tr.speed * 3;
        if (!tr.cross) for (const s of sw) { if (tr.passed.has(s)) continue; const e = entry(s, Math.round(tr.y), tr.dir, tr.x - tr.dir * tr.speed * 3, tr.x); if (e) { tr.cross = e; tr.passed.add(s); break; } }
        if (tr.cross) { const k = Math.min(1, Math.abs(tr.x - tr.cross.x0) / Math.abs(tr.cross.x1 - tr.cross.x0)); tr.y = tr.cross.from + (tr.cross.to - tr.cross.from) * ease(k); if (k >= 1) { tr.y = tr.cross.to; tr.cross = null; } }
      }
      for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) { const a = st[i], b = st[j]; if (Math.abs(a.y - b.y) > 0.45) continue; const [a0, a1] = span(a), [b0, b1] = span(b); if (a0 < b1 && b0 < a1) return { a: a.ref, b: b.ref, t, x: (a.x + b.x) / 2, y: a.y }; }
    }
    return null;
  }
  // which single new crossover (ahead of either train, to a neighbouring line) avoids the collision?
  function findFix() {
    const base = predict(); if (!base) return null;
    let best = null;
    for (const tr of [base.a, base.b]) {
      if (tr.cross) continue;
      const line = Math.round(tr.y);
      for (const to of [line - 1, line + 1]) {
        if (to < 0 || to >= TRACKS) continue;
        for (const ahead of [50, 110, 180]) {
          const x0 = tr.x + tr.dir * ahead, x1 = x0 + tr.dir * 80;
          if (x0 < 10 || x0 > W - 10 || x1 < 10 || x1 > W - 10) continue;
          const cand = { x0, l0: line, x1, l1: to };
          if (switches.some(o => overlaps(o, cand))) continue;
          const p = predict([...switches, cand]); const t = p ? p.t : Infinity;
          if (t > base.t + 90 && (!best || t > best.t)) best = { cand, t };
        }
      }
    }
    return best ? best.cand : null;
  }
  function hud() { return `${diff.name} · level ${g.level} · ${delivered} cars delivered · ${lives} strikes · ${trains.length} trains${combo > 1 ? ` · combo ×${Math.min(5, combo)}` : ""}`; }

  // ---------- render ----------
  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    c.save(); if (shake > 0) c.translate((Math.random() - 0.5) * shake * 0.6, (Math.random() - 0.5) * shake * 0.6);
    const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, shade(T.bg, 0.05)); bg.addColorStop(1, shade(T.bgGlow1, -0.5)); c.fillStyle = bg; c.fillRect(-10, -10, W + 20, H + 20);
    // ballast strips + rails
    for (let t = 0; t < TRACKS; t++) {
      const y = TY[t];
      c.fillStyle = "#00000044"; c.fillRect(0, y - 14, W, 28);
      c.fillStyle = shade(T.surface2, -0.2); for (let x = 4; x < W; x += 12) c.fillRect(x, y - 9, 6, 18);
      c.strokeStyle = shade(T.textDim, 0.2); c.lineWidth = 2; c.beginPath(); c.moveTo(0, y - 5); c.lineTo(W, y - 5); c.moveTo(0, y + 5); c.lineTo(W, y + 5); c.stroke();
      c.fillStyle = T.textDim; c.font = "10px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(`LINE ${t + 1}`, 6, y - 22);
    }
    // crossovers the player has drawn
    for (const s of switches) drawCrossover(c, s, hover === s ? "#fff" : T.cyan, 1, true);
    if (hint && hintTtl > 0) { c.globalAlpha = 0.5 + 0.4 * Math.sin(tick / 5); drawCrossover(c, hint, T.marquee, 1, false); c.globalAlpha = 1; c.fillStyle = T.marquee; c.font = "700 11px system-ui,sans-serif"; c.textAlign = "center"; c.fillText("draw this", (hint.x0 + hint.x1) / 2, (TY[hint.l0] + TY[hint.l1]) / 2 - 16); }
    if (drag) { const l1 = lineAt(drag.y), ok = l1 >= 0 && Math.abs(l1 - drag.l0) === 1 && Math.abs(drag.x - drag.x0) >= MIN_SPAN; const cand = { x0: drag.x0, l0: drag.l0, x1: ok ? drag.x0 + Math.sign(drag.x - drag.x0) * Math.min(MAX_SPAN, Math.abs(drag.x - drag.x0)) : drag.x, l1: ok ? l1 : drag.l0 }; c.globalAlpha = 0.7; if (ok) drawCrossover(c, cand, T.cyan, 1, false); else { c.strokeStyle = T.accent; c.lineWidth = 2; c.setLineDash([6, 6]); c.beginPath(); c.moveTo(drag.x0, TY[drag.l0]); c.lineTo(drag.x, drag.y); c.stroke(); c.setLineDash([]); } c.globalAlpha = 1; c.fillStyle = T.cyan; c.beginPath(); c.arc(drag.x0, TY[drag.l0], 5, 0, 7); c.fill(); }
    // collision warning
    if (warn && warn.t < 240) { const y = TY[Math.round(warn.y)]; c.globalAlpha = 0.25 + 0.25 * Math.sin(tick / 4); c.fillStyle = T.accent; c.fillRect(Math.max(0, warn.x - 60), y - 16, 120, 32); c.globalAlpha = 1; c.fillStyle = T.accent; c.font = "800 11px system-ui,sans-serif"; c.textAlign = "center"; c.fillText(`⚠ ${Math.ceil(warn.t / 60)}s`, Math.max(40, Math.min(W - 40, warn.x)), y - 26); }
    for (const p of smoke) { c.globalAlpha = Math.min(0.35, p.ttl / 80); c.fillStyle = "#cfd3da"; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 7); c.fill(); } c.globalAlpha = 1;
    for (const tr of trains) drawTrain(c, tr);
    for (const p of particles) { c.globalAlpha = Math.min(1, p.ttl / 15); c.fillStyle = p.color; c.fillRect(p.x, p.y, 3, 3); } c.globalAlpha = 1;
    for (const p of popups) { const k = 1 - p.ttl / 55; c.globalAlpha = Math.min(1, p.ttl / 12); c.fillStyle = p.color || "#fff"; c.font = "800 13px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.shadowColor = "#000"; c.shadowBlur = 5; c.fillText(p.text, p.x, p.y - k * 18); c.shadowBlur = 0; } c.globalAlpha = 1;
    c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(0, 0, W, 28);
    c.fillStyle = "#fff"; c.font = "700 13px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(`Level ${g.level}`, 12, 14);
    c.fillStyle = T.textDim; c.font = "12px system-ui,sans-serif"; c.fillText(`${delivered} cars delivered`, 80, 14);
    c.fillStyle = T.accent; for (let i = 0; i < lives; i++) { c.beginPath(); c.arc(W - 16 - i * 16, 14, 5, 0, 7); c.fill(); }
    if (msgTtl > 0 && msg) { c.font = "800 22px 'Chakra Petch',system-ui,sans-serif"; c.textAlign = "center"; c.fillStyle = T.marquee; c.shadowColor = "#000"; c.shadowBlur = 10; c.globalAlpha = Math.min(1, msgTtl / 20); c.fillText(msg, W / 2, H - 30); c.shadowBlur = 0; c.globalAlpha = 1; }
    c.restore();
  }
  function drawCrossover(c, s, color, alpha, lever) {
    const y0 = TY[s.l0], y1 = TY[s.l1], x0 = s.x0, x1 = s.x1;
    c.globalAlpha *= alpha; c.fillStyle = shade(T.surface2, -0.2);
    for (let k = 0.06; k < 1; k += 0.08) { const px = x0 + (x1 - x0) * k, py = y0 + (y1 - y0) * ease(k); const ang = Math.atan2((y1 - y0) * 6 * k * (1 - k), (x1 - x0)); c.save(); c.translate(px, py); c.rotate(ang); c.fillRect(-3, -9, 6, 18); c.restore(); }
    c.strokeStyle = color; c.lineWidth = 2; c.shadowColor = color; c.shadowBlur = 10;
    c.beginPath(); curve(c, x0, y0 - 5, x1, y1 - 5); curve(c, x0, y0 + 5, x1, y1 + 5); c.stroke(); c.shadowBlur = 0;
    if (lever) { const [mx, my] = mid(s); c.save(); c.translate(mx, my); c.rotate(Math.PI / 4); c.fillStyle = shade(T.surface3, 0.1); c.shadowColor = "#000"; c.shadowBlur = 6; c.fillRect(-7, -7, 14, 14); c.shadowBlur = 0; c.strokeStyle = color === "#fff" ? "#fff" : "#ffffff55"; c.lineWidth = 1.5; c.strokeRect(-8, -8, 16, 16); c.restore(); c.fillStyle = T.textDim; c.font = "800 10px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("×", mx, my + 1); }
    c.globalAlpha = 1;
  }
  function curve(c, x0, y0, x1, y1) { c.moveTo(x0, y0); c.bezierCurveTo(x0 + (x1 - x0) * 0.5, y0, x0 + (x1 - x0) * 0.5, y1, x1, y1); }
  function posAt(tr, back) { // position `back` px behind the engine along its trail
    const idx = Math.min(tr.trail.length - 1, Math.round(back / tr.speed));
    if (idx < 0 || !tr.trail.length) return [tr.x - tr.dir * back, tr.y];
    const p = tr.trail[idx]; return idx === tr.trail.length - 1 ? [tr.x - tr.dir * back, p[1]] : p;
  }
  function headingAt(tr, back) { const [xa, ya] = posAt(tr, Math.max(0, back - 8)), [xb, yb] = posAt(tr, back + 8); return Math.atan2((ya - yb) * 80 * tr.dir, Math.max(1, Math.abs(xa - xb))); }
  function drawTrain(c, tr) {
    for (let k = tr.cars - 1; k >= 0; k--) {
      const back = ENG / 2 + CAR / 2 + k * CAR; const [cx, ty] = posAt(tr, back); const cy = TY[0] + ty * 80;
      c.save(); c.translate(cx, cy); c.rotate(headingAt(tr, back)); const x = 0, y = 0;
      c.fillStyle = "#00000055"; c.fillRect(x - CAR / 2 + 2, y - 4, CAR - 3, 10);
      const grd = c.createLinearGradient(0, y - 10, 0, y + 4); grd.addColorStop(0, shade("#6B7280", 0.2)); grd.addColorStop(1, shade("#6B7280", -0.4));
      c.fillStyle = grd; rr(c, x - CAR / 2 + 1, y - 9, CAR - 2, 12, 2); c.fill();
      c.fillStyle = "#1a1a1a"; c.beginPath(); c.arc(x - 7, y + 4, 2.5, 0, 7); c.arc(x + 7, y + 4, 2.5, 0, 7); c.fill();
      c.fillStyle = "#2b2b2b"; c.beginPath(); c.moveTo(x - CAR / 2 + 3, y - 9); c.quadraticCurveTo(x, y - 17, x + CAR / 2 - 3, y - 9); c.closePath(); c.fill();
      c.fillStyle = "#555"; for (let i = 0; i < 4; i++) c.fillRect(x - 8 + i * 5, y - 13 + (i % 2) * 2, 2, 2);
      c.restore();
    }
    c.save(); c.translate(tr.x, TY[0] + tr.y * 80); c.rotate(headingAt(tr, 0)); const y = 0, x = 0, d = tr.dir;
    c.fillStyle = "#00000066"; c.fillRect(x - ENG / 2 + 2, y - 4, ENG - 3, 10);
    const eg = c.createLinearGradient(0, y - 14, 0, y + 4); eg.addColorStop(0, shade(tr.color, 0.4)); eg.addColorStop(1, shade(tr.color, -0.45));
    c.fillStyle = eg; c.shadowColor = tr.color; c.shadowBlur = 10; rr(c, x - ENG / 2, y - 10, ENG, 14, 3); c.fill(); c.shadowBlur = 0;
    c.fillStyle = shade(tr.color, -0.2); rr(c, x - d * 14, y - 18, 11, 9, 2); c.fill(); // cab
    c.fillStyle = "#222"; c.fillRect(x + d * 8 - 2, y - 18, 4, 8); // stack
    c.fillStyle = "#1a1a1a"; c.beginPath(); c.arc(x - 9, y + 4, 3, 0, 7); c.arc(x, y + 4, 3, 0, 7); c.arc(x + 9, y + 4, 3, 0, 7); c.fill();
    c.fillStyle = "#FFF4CC"; c.shadowColor = "#FFF4CC"; c.shadowBlur = 12; c.beginPath(); c.arc(x + d * (ENG / 2 - 2), y - 4, 2.5, 0, 7); c.fill(); c.shadowBlur = 0;
    c.globalAlpha = 0.12; c.fillStyle = "#FFF4CC"; c.beginPath(); c.moveTo(x + d * ENG / 2, y - 6); c.lineTo(x + d * (ENG / 2 + 70), y - 16); c.lineTo(x + d * (ENG / 2 + 70), y + 6); c.closePath(); c.fill(); c.globalAlpha = 1;
    c.restore();
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
