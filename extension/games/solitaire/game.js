// Solitaire — Klondike. Drag cards (or click a card, then click where it goes). Click the stock to
// draw; clicking a card with no selection tries to send it to a foundation first. Beginner draws one
// card with unlimited passes; Intermediate draws three; Advanced draws three with only three passes.
// Scoring: +10 per card to a foundation, +5 waste→tableau, +5 for turning a card over, −15 for taking
// a card back off a foundation; a time bonus and +1000 on completion. H highlights a legal move.
import { loadPack, draw as spr } from "../../shell/sprites.js";
const W = 640, H = 460, CW = 70, CH = 96, TOP = 46, GAP = 12, COLS = 7;
const SUITS = ["♠", "♥", "♦", "♣"], RED = { "♥": true, "♦": true };
const DIFFICULTY = {
  beginner:     { name: "Beginner",     draw: 1, passes: Infinity },
  intermediate: { name: "Intermediate", draw: 3, passes: Infinity },
  advanced:     { name: "Advanced",     draw: 3, passes: 3 },
};

export default function createSolitaire({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0, pack = null; loadPack("cards").then(p => { pack = p; });
  const g = { id: "solitaire", tps: 60, score: 0, level: 1, size: { width: W, height: H }, autopilot, init, update, render, onInput, onPointer, onPointerDown, onPointerUp, onHover, hud };
  let stock, waste, found, tab, drag, sel, hover, passes, startTick, elapsed, hint, hintTtl, msg, msgTtl, won, wonT, confetti, moves, flips;
  const colX = (i) => GAP + i * (CW + GAP) + 10, tabY = TOP + CH + 24;

  function init(sh) {
    g.score = 0; g.level = 1; moves = 0; flips = [];
    const deck = []; for (const s of SUITS) for (let r = 1; r <= 13; r++) deck.push({ s, r, up: false });
    for (let i = deck.length - 1; i > 0; i--) { const j = sh.rng.int(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    tab = Array.from({ length: COLS }, () => []);
    for (let c = 0; c < COLS; c++) for (let r = 0; r <= c; r++) { const card = deck.pop(); card.up = r === c; tab[c].push(card); }
    stock = deck; waste = []; found = [[], [], [], []];
    drag = null; sel = null; hover = null; passes = 0; startTick = null; elapsed = 0; hint = null; hintTtl = 0; won = false; wonT = 0; confetti = [];
    say(`${diff.name} · draw ${diff.draw}${diff.passes !== Infinity ? ` · ${diff.passes} passes` : ""}`, 150);
  }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  const color = (c) => RED[c.s] ? "r" : "b";
  const canFound = (c, i) => { const f = found[i]; return f.length ? f[0].s === c.s && f[f.length - 1].r === c.r - 1 : c.r === 1; };
  const canTab = (c, i) => { const t = tab[i]; return t.length ? t[t.length - 1].up && color(t[t.length - 1]) !== color(c) && t[t.length - 1].r === c.r + 1 : c.r === 13; };

  // ---------- geometry ----------
  function layout() { // returns hit regions, topmost last
    const out = [];
    out.push({ kind: "stock", x: colX(0), y: TOP, w: CW, h: CH });
    waste.slice(-3).forEach((c, i, arr) => out.push({ kind: "waste", card: c, idx: waste.length - arr.length + i, x: colX(1) + i * 18, y: TOP, w: CW, h: CH, top: i === arr.length - 1 }));
    found.forEach((f, i) => out.push({ kind: "found", i, card: f[f.length - 1], x: colX(3 + i), y: TOP, w: CW, h: CH }));
    tab.forEach((col, i) => {
      if (!col.length) { out.push({ kind: "tab", i, idx: 0, x: colX(i), y: tabY, w: CW, h: CH, empty: true }); return; }
      let y = tabY;
      col.forEach((c, j) => { const step = c.up ? 24 : 10; out.push({ kind: "tab", i, idx: j, card: c, x: colX(i), y, w: CW, h: j === col.length - 1 ? CH : step }); y += step; });
    });
    return out;
  }
  function hit(px, py) { const regs = layout(); for (let i = regs.length - 1; i >= 0; i--) { const r = regs[i]; if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return r; } return null; }

  // ---------- moves ----------
  function pickup(r) { // what moves with this region
    if (r.kind === "waste" && r.top && r.card) return { from: "waste", cards: [r.card] };
    if (r.kind === "found" && r.card) return { from: "found", i: r.i, cards: [r.card] };
    if (r.kind === "tab" && r.card && r.card.up) return { from: "tab", i: r.i, idx: r.idx, cards: tab[r.i].slice(r.idx) };
    return null;
  }
  function removeSource(src) {
    if (src.from === "waste") waste.pop();
    else if (src.from === "found") found[src.i].pop();
    else tab[src.i].splice(src.idx);
  }
  function place(src, dest, sh) {
    const lead = src.cards[0];
    if (dest.kind === "found" && src.cards.length === 1 && canFound(lead, dest.i)) { removeSource(src); found[dest.i].push(lead); g.score += 10; after(src, sh); sh.audio.eat(); return true; }
    if (dest.kind === "tab" && canTab(lead, dest.i)) { removeSource(src); tab[dest.i].push(...src.cards); if (src.from === "waste") g.score += 5; if (src.from === "found") g.score = Math.max(0, g.score - 15); after(src, sh); sh.audio.blip(); return true; }
    return false;
  }
  function after(src, sh) {
    moves++;
    if (src.from === "tab") { const col = tab[src.i]; const last = col[col.length - 1]; if (last && !last.up) { last.up = true; g.score += 5; flips.push({ card: last, t: 0 }); } }
    if (startTick === null) startTick = sh.tick;
    if (found.every(f => f.length === 13)) win(sh);
  }
  function autoFound(src, sh) { for (let i = 0; i < 4; i++) if (src.cards.length === 1 && canFound(src.cards[0], i)) return place(src, { kind: "found", i }, sh); return false; }
  function draw(sh) {
    if (!stock.length) {
      if (!waste.length) return;
      if (passes + 1 >= diff.passes) { say("No more passes through the stock", 80); sh.audio.hit(); return; }
      passes++; stock = waste.reverse().map(c => (c.up = false, c)); waste = []; sh.audio.blip(); return;
    }
    for (let i = 0; i < diff.draw && stock.length; i++) { const c = stock.pop(); c.up = true; waste.push(c); }
    if (startTick === null) startTick = sh.tick;
    sh.audio.blip();
  }
  function win(sh) {
    won = true; wonT = 0;
    const secs = Math.floor(elapsed / 60), bonus = 1000 + Math.max(0, 700 - secs * 2);
    g.score += bonus; sh.wallet?.earn(40 + Math.max(0, 60 - Math.floor(secs / 10)));
    say(`Solved! +${bonus}`, 400); sh.audio.levelUp();
    for (let i = 0; i < 200; i++) confetti.push({ x: W / 2 + (sh.rng.next() - 0.5) * 200, y: H / 2, vx: (sh.rng.next() - 0.5) * 8, vy: -sh.rng.next() * 9, ttl: 90 + sh.rng.int(90), color: [T?.cyan, T?.marquee, T?.accent, "#fff"][i % 4], r: sh.rng.next() * 6 });
  }
  // find any legal move (for the hint and autopilot)
  function findMove() {
    const srcs = [];
    if (waste.length) srcs.push({ from: "waste", cards: [waste[waste.length - 1]] });
    tab.forEach((col, i) => { const first = col.findIndex(c => c.up); if (first >= 0) for (let j = first; j < col.length; j++) srcs.push({ from: "tab", i, idx: j, cards: col.slice(j) }); });
    // 1. anything that can go up to a foundation
    for (const s of srcs) for (let i = 0; i < 4; i++) if (s.cards.length === 1 && canFound(s.cards[0], i)) return { src: s, dest: { kind: "found", i }, score: 4 };
    const tabMoves = [];
    for (const s of srcs) for (let i = 0; i < COLS; i++) {
      if (s.from === "tab" && s.i === i) continue;
      if (!canTab(s.cards[0], i)) continue;
      if (s.from === "tab" && s.idx === 0 && !tab[i].length) continue; // king shuffling between empty columns
      const reveals = s.from === "tab" && s.idx > 0 && !tab[s.i][s.idx - 1].up;
      tabMoves.push({ src: s, dest: { kind: "tab", i }, score: reveals ? 3 : s.from === "waste" ? 2 : s.from === "tab" && s.idx === 0 ? 1 : 0 });
    }
    tabMoves.sort((a, b) => b.score - a.score);
    // 2. a tableau move that reveals a card or comes from the waste; plain reshuffles only if nothing else
    return tabMoves.find(m => m.score >= 1) || tabMoves[0] || null;
  }

  // ---------- input ----------
  function onHover(px, py) { hover = px < 0 ? null : { x: px, y: py }; if (drag) { drag.x = px; drag.y = py; } }
  function onInput(action, sh) { if (action === "hint") { const m = findMove(); if (m) { hint = m; hintTtl = 180; g.score = Math.max(0, g.score - 20); } else say(stock.length || waste.length ? "Try drawing from the stock" : "No moves left", 80); } if (action === "action") draw(sh); }
  function onPointerDown(px, py, sh, button) {
    if (won || button !== 0) return;
    const r = hit(px, py); if (!r) return;
    const src = pickup(r);
    if (src) drag = { src, x: px, y: py, ox: px - r.x, oy: py - r.y, startX: px, startY: py, region: r };
  }
  function onPointerUp(px, py, sh) {
    if (!drag) return;
    const d = drag; drag = null;
    const moved = Math.hypot(px - d.startX, py - d.startY) > 8;
    if (!moved) return; // a click: handled by onPointer
    const dest = hit(px, py);
    if (dest && (dest.kind === "found" || dest.kind === "tab")) { if (place(d.src, dest, sh)) { sh.record(1000 + Math.round(px) * 1000 + Math.round(py)); sel = null; return; } }
    sh.audio.hit();
  }
  function onPointer(px, py, sh) {
    if (won) return;
    const r = hit(px, py);
    if (!r) { sel = null; return; }
    sh.record(1000 + Math.round(px) * 1000 + Math.round(py));
    if (r.kind === "stock") { draw(sh); sel = null; return; }
    if (sel) { // second click: try to place the selection
      if ((r.kind === "found" || r.kind === "tab") && place(sel, r, sh)) { sel = null; return; }
      sel = null;
    }
    const src = pickup(r); if (!src) return;
    if (autoFound(src, sh)) return;
    sel = src;
  }

  // ---------- loop ----------
  function update(sh) {
    tick = sh.tick;
    if (startTick !== null && !won) elapsed = sh.tick - startTick;
    if (msgTtl > 0) msgTtl--; if (hintTtl > 0 && --hintTtl === 0) hint = null;
    flips = flips.filter(f => (f.t += 1) < 16);
    confetti = confetti.filter(p => (p.ttl -= 1) > 0); for (const p of confetti) { p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.r += 0.1; }
    if (won) { if (++wonT > 240) sh.end(); return; }
    if (g.autopilot && tick % 30 === 0) {
      const m = findMove();
      const sig = m && `${m.src.cards[0].s}${m.src.cards[0].r}>${m.dest.kind}${m.dest.i}`;
      const canDraw = stock.length || (waste.length && passes + 1 < diff.passes);
      g._recent = g._recent || [];
      const fresh = m && !g._recent.includes(sig);
      if (m && (m.score >= 3 || (!canDraw && fresh))) { place(m.src, m.dest, sh); g._recent = [sig, ...g._recent].slice(0, 8); }
      else if (canDraw) draw(sh);
      else if (m && fresh) { place(m.src, m.dest, sh); g._recent = [sig, ...g._recent].slice(0, 8); }
      else sh.end();
      if (tick > 60 * 240) sh.end();
    }
  }
  function hud() { return `${diff.name} · ${Math.floor(elapsed / 60)}s · ${moves} moves · stock ${stock.length}${diff.passes !== Infinity ? ` · pass ${passes + 1}/${diff.passes}` : ""}`; }

  // ---------- render ----------
  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    const bg = c.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.7); bg.addColorStop(0, T.bgGlow1); bg.addColorStop(1, T.bg);
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    // felt texture lines
    c.strokeStyle = "#ffffff06"; c.lineWidth = 1; for (let y = 0; y < H; y += 6) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.fillStyle = T.textDim; c.font = "12px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "middle";
    c.fillText(`${Math.floor(elapsed / 60)}s · ${moves} moves`, 14, 20);
    c.textAlign = "right"; c.fillText(diff.passes !== Infinity ? `pass ${passes + 1} of ${diff.passes}` : `draw ${diff.draw}`, W - 14, 20);
    // slots
    slot(c, colX(0), TOP, stock.length ? null : (waste.length && passes + 1 < diff.passes ? "↻" : "✕"));
    slot(c, colX(1), TOP, null);
    for (let i = 0; i < 4; i++) slot(c, colX(3 + i), TOP, "A");
    for (let i = 0; i < COLS; i++) slot(c, colX(i), tabY, null);
    // stock pile
    if (stock.length) for (let i = 0; i < Math.min(3, stock.length); i++) back(c, colX(0) + i * 1.5, TOP - i * 1.5);
    // waste
    const dragging = (card) => drag && drag.src.cards.includes(card) && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 8;
    waste.slice(-3).forEach((card, i) => { if (!dragging(card)) face(c, card, colX(1) + i * 18, TOP, isSel(card)); });
    for (let i = 0; i < 4; i++) { const f = found[i]; if (f.length) face(c, f[f.length - 1], colX(3 + i), TOP, isSel(f[f.length - 1])); }
    // tableau
    tab.forEach((col, i) => { let y = tabY; col.forEach((card, j) => { if (!dragging(card)) { if (card.up) { const fl = flips.find(f => f.card === card); face(c, card, colX(i), y, isSel(card), fl ? fl.t / 16 : 1); } else back(c, colX(i), y); } y += card.up ? 24 : 10; }); });
    // hint
    if (hint && hintTtl > 0) { const regs = layout(); const s = regs.find(r => r.card === hint.src.cards[0]); const d = regs.filter(r => r.kind === hint.dest.kind && r.i === hint.dest.i).pop(); c.globalAlpha = 0.5 + 0.5 * Math.sin(tick / 5); c.strokeStyle = T.marquee; c.lineWidth = 3; if (s) rr(c, s.x - 2, s.y - 2, CW + 4, CH + 4, 8), c.stroke(); if (d) rr(c, d.x - 2, d.y - 2, CW + 4, CH + 4, 8), c.stroke(); c.globalAlpha = 1; }
    // dragged stack
    if (drag && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 8) { c.save(); c.shadowColor = "#000"; c.shadowBlur = 24; c.shadowOffsetY = 10; drag.src.cards.forEach((card, j) => face(c, card, drag.x - drag.ox, drag.y - drag.oy + j * 24, false, 1, 1.04)); c.restore(); }
    for (const p of confetti) { c.globalAlpha = Math.min(1, p.ttl / 30); c.fillStyle = p.color; c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.fillRect(-3, -2, 6, 4); c.restore(); }
    c.globalAlpha = 1;
    if (msgTtl > 0 && msg) { c.font = "700 15px system-ui,sans-serif"; c.textAlign = "center"; const tw = c.measureText(msg).width + 24; c.fillStyle = T.bg; c.globalAlpha = 0.85; rr(c, W / 2 - tw / 2, H - 34, tw, 26, 13); c.fill(); c.globalAlpha = 1; c.fillStyle = T.marquee; c.fillText(msg, W / 2, H - 21); }
  }
  function isSel(card) { return sel && sel.cards.includes(card); }
  function slot(c, x, y, glyph) { c.strokeStyle = "#ffffff22"; c.lineWidth = 1.5; rr(c, x, y, CW, CH, 8); c.stroke(); if (glyph) { c.fillStyle = "#ffffff22"; c.font = "700 28px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(glyph, x + CW / 2, y + CH / 2); } }
  function back(c, x, y) {
    if (pack?.sprites?.card_back) { const s = pack.sprites.card_back; c.save(); c.drawImage(s.img, x, y, CW, CH); c.restore(); return; }
    c.fillStyle = "#00000055"; rr(c, x + 2, y + 3, CW, CH, 8); c.fill();
    const grd = c.createLinearGradient(x, y, x + CW, y + CH); grd.addColorStop(0, shade(T.surface3, 0.1)); grd.addColorStop(1, shade(T.surface2, -0.2));
    c.fillStyle = grd; rr(c, x, y, CW, CH, 8); c.fill();
    c.strokeStyle = "#ffffff33"; c.lineWidth = 1; rr(c, x + 0.5, y + 0.5, CW - 1, CH - 1, 8); c.stroke();
    c.strokeStyle = shade(T.cyan, -0.1); c.globalAlpha = 0.5; rr(c, x + 6, y + 6, CW - 12, CH - 12, 5); c.stroke();
    c.save(); rr(c, x + 6, y + 6, CW - 12, CH - 12, 5); c.clip(); c.beginPath(); for (let i = -CH; i < CW + CH; i += 8) { c.moveTo(x + i, y); c.lineTo(x + i - CH, y + CH); c.moveTo(x + i, y); c.lineTo(x + i + CH, y + CH); } c.stroke(); c.restore(); c.globalAlpha = 1;
  }
  function face(c, card, x, y, selected, k = 1, scale = 1) {
    const red = RED[card.s], col = red ? "#E0244D" : "#1B1F2A";
    const key = "card_" + ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"][card.r] + { "♠": "s", "♥": "h", "♦": "d", "♣": "c" }[card.s];
    if (pack?.sprites?.[key]) { const s = pack.sprites[key]; c.save(); if (k < 1) { c.translate(x + CW / 2, y + CH / 2); c.scale(Math.abs(Math.cos((1 - k) * Math.PI / 2)), 1); c.translate(-(x + CW / 2), -(y + CH / 2)); } if (scale !== 1) { c.translate(x + CW / 2, y + CH / 2); c.scale(scale, scale); c.translate(-(x + CW / 2), -(y + CH / 2)); } c.drawImage(s.img, x, y, CW, CH); if (selected) { c.strokeStyle = T.cyan; c.lineWidth = 3; rr(c, x + 0.5, y + 0.5, CW - 1, CH - 1, 6); c.stroke(); } c.restore(); return; }
    c.save();
    if (k < 1) { c.translate(x + CW / 2, y + CH / 2); c.scale(Math.abs(Math.cos((1 - k) * Math.PI / 2)), 1); c.translate(-(x + CW / 2), -(y + CH / 2)); }
    if (scale !== 1) { c.translate(x + CW / 2, y + CH / 2); c.scale(scale, scale); c.translate(-(x + CW / 2), -(y + CH / 2)); }
    c.fillStyle = "#00000044"; rr(c, x + 1.5, y + 2.5, CW, CH, 8); c.fill();
    const grd = c.createLinearGradient(x, y, x, y + CH); grd.addColorStop(0, "#FFFFFF"); grd.addColorStop(1, "#E9ECF2");
    c.fillStyle = grd; rr(c, x, y, CW, CH, 8); c.fill();
    c.strokeStyle = selected ? T.cyan : "#00000022"; c.lineWidth = selected ? 3 : 1; rr(c, x + 0.5, y + 0.5, CW - 1, CH - 1, 8); c.stroke();
    const rank = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"][card.r];
    c.fillStyle = col; c.font = "800 15px system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "top"; c.fillText(rank, x + 6, y + 5);
    c.font = "13px system-ui,sans-serif"; c.fillText(card.s, x + 6, y + 21);
    c.font = "800 34px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.globalAlpha = card.r > 10 ? 0.9 : 0.75; c.fillText(card.s, x + CW / 2, y + CH / 2 + 6); c.globalAlpha = 1;
    if (card.r > 10) { c.fillStyle = col; c.font = "800 11px system-ui,sans-serif"; c.fillText(rank === "J" ? "JACK" : rank === "Q" ? "QUEEN" : "KING", x + CW / 2, y + CH - 12); }
    c.restore();
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
