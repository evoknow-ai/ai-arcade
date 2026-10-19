// Chess — you play White against the engine. Click a piece, then a highlighted square (or drag).
// Full rules: castling, en passant, promotion (to a queen), check, checkmate, stalemate, 50-move and
// threefold-repetition draws. The engine is alpha-beta minimax with piece-square tables; search depth
// and randomness come from the difficulty. H asks the engine for a suggestion. Score: material you
// win, checkmate bonus, credits for a win or draw.
const W = 640, H = 480, SQ = 52, OX = 40, OY = 28;
const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const DIFFICULTY = {
  beginner:     { name: "Beginner",     depth: 1, noise: 120, think: 30 },
  intermediate: { name: "Intermediate", depth: 2, noise: 25, think: 40 },
  advanced:     { name: "Advanced",     depth: 3, noise: 0, think: 50 },
};
// piece-square tables (white's view, a8 first)
const PST = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
};

export default function createChess({ autopilot = false, difficulty = "intermediate" } = {}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
  let T = null, tick = 0;
  const g = { id: "chess", tps: 60, size: { width: W, height: H }, score: 0, level: 1, autopilot, init, update, render, onInput, onPointer, onPointerDown, onPointerUp, onHover, hud };
  let S, sel, legal, drag, hover, lastMove, thinking, over, hint, hintTtl, history, captured, msg, msgTtl, flipAnim, popups, moveNo, seen, replay, logScroll;
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
  const SPEEDS = [1, 2, 3, 5, "real"]; // "real" replays with the recorded thinking times
  let turnStart = 0, clocks = { w: 0, b: 0 };
  let analysis = null, summary = null, showSummary = false; // post-game annotation

  // ---------- state ----------
  // S: { b: 64 cells ('' or 'wP'...), turn: 'w'|'b', castle: {wK,wQ,bK,bQ}, ep: index|-1, half: n }
  function init(sh) {
    g.score = 0; g.level = 1;
    S = freshState(); replay = null; logScroll = 0; turnStart = 0; clocks = { w: 0, b: 0 }; analysis = null; summary = null; showSummary = false;
    sel = null; legal = []; drag = null; lastMove = null; thinking = 0; over = null; hint = null; hintTtl = 0; history = []; captured = { w: [], b: [] }; popups = []; moveNo = 1; seen = new Map();
    say(g.autopilot ? "Engine vs engine" : "You are White", 120);
  }
  function freshState() { return { b: parseFen(START), turn: "w", castle: { wK: true, wQ: true, bK: true, bQ: true }, ep: -1, half: 0 }; }
  function parseFen(f) { const b = []; for (const ch of f) { if (ch === "/") continue; if (/\d/.test(ch)) { for (let i = 0; i < +ch; i++) b.push(""); } else b.push((ch === ch.toUpperCase() ? "w" : "b") + ch.toLowerCase()); } return b; }
  function say(t, ttl) { msg = t; msgTtl = ttl; }
  function pop(x, y, text, color) { popups.push({ x, y, text, color, ttl: 70 }); }
  const sqX = (i) => OX + (i % 8) * SQ, sqY = (i) => OY + Math.floor(i / 8) * SQ;
  const cellAt = (px, py) => { const f = Math.floor((px - OX) / SQ), r = Math.floor((py - OY) / SQ); return f >= 0 && r >= 0 && f < 8 && r < 8 ? r * 8 + f : -1; };

  // ---------- move generation ----------
  function genPseudo(st, side) {
    const b = st.b, mv = [], add = (from, to, extra) => mv.push({ from, to, ...extra });
    for (let i = 0; i < 64; i++) {
      const pc = b[i]; if (!pc || pc[0] !== side) continue;
      const t = pc[1], x = i % 8, y = Math.floor(i / 8), opp = side === "w" ? "b" : "w";
      if (t === "p") {
        const d = side === "w" ? -1 : 1, start = side === "w" ? 6 : 1, last = side === "w" ? 0 : 7;
        const f = i + d * 8;
        if (y + d >= 0 && y + d < 8 && !b[f]) { add(i, f, { promo: y + d === last }); if (y === start && !b[f + d * 8]) add(i, f + d * 8, { dbl: true }); }
        for (const dx of [-1, 1]) { const nx = x + dx; if (nx < 0 || nx > 7 || y + d < 0 || y + d > 7) continue; const to = f + dx; if (b[to] && b[to][0] === opp) add(i, to, { promo: y + d === last }); else if (to === st.ep) add(i, to, { ep: true }); }
      } else if (t === "n" || t === "k") {
        const deltas = t === "n" ? [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        for (const [dx, dy] of deltas) { const nx = x + dx, ny = y + dy; if (nx < 0 || nx > 7 || ny < 0 || ny > 7) continue; const to = ny * 8 + nx; if (!b[to] || b[to][0] === opp) add(i, to, {}); }
        if (t === "k") { // castling (squares empty; attack checks done in filter)
          const r = side === "w" ? 7 : 0;
          if (st.castle[side + "K"] && !b[r * 8 + 5] && !b[r * 8 + 6] && b[r * 8 + 7] === side + "r") add(i, r * 8 + 6, { castle: "K" });
          if (st.castle[side + "Q"] && !b[r * 8 + 3] && !b[r * 8 + 2] && !b[r * 8 + 1] && b[r * 8] === side + "r") add(i, r * 8 + 2, { castle: "Q" });
        }
      } else {
        const dirs = t === "b" ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : t === "r" ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of dirs) { let nx = x + dx, ny = y + dy; while (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) { const to = ny * 8 + nx; if (b[to]) { if (b[to][0] === opp) add(i, to, {}); break; } add(i, to, {}); nx += dx; ny += dy; } }
      }
    }
    return mv;
  }
  function attacked(st, sq, by) { // is square attacked by side `by`?
    const b = st.b, x = sq % 8, y = Math.floor(sq / 8);
    const d = by === "w" ? 1 : -1; // pawns of `by` attack from y+d
    for (const dx of [-1, 1]) { const nx = x + dx, ny = y + d; if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && b[ny * 8 + nx] === by + "p") return true; }
    for (const [dx, dy] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && b[ny * 8 + nx] === by + "n") return true; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && b[ny * 8 + nx] === by + "k") return true; }
    for (const [dx, dy, kinds] of [[1, 0, "rq"], [-1, 0, "rq"], [0, 1, "rq"], [0, -1, "rq"], [1, 1, "bq"], [1, -1, "bq"], [-1, 1, "bq"], [-1, -1, "bq"]]) { let nx = x + dx, ny = y + dy; while (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) { const p = b[ny * 8 + nx]; if (p) { if (p[0] === by && kinds.includes(p[1])) return true; break; } nx += dx; ny += dy; } }
    return false;
  }
  function kingSq(st, side) { return st.b.indexOf(side + "k"); }
  function inCheck(st, side) { return attacked(st, kingSq(st, side), side === "w" ? "b" : "w"); }
  function apply(st, m) {
    const n = { b: st.b.slice(), turn: st.turn === "w" ? "b" : "w", castle: { ...st.castle }, ep: -1, half: st.half + 1 };
    const pc = n.b[m.from], side = pc[0];
    n.captured = n.b[m.to] || (m.ep ? side + "p" : "");
    n.b[m.to] = pc; n.b[m.from] = "";
    if (pc[1] === "p" || n.captured) n.half = 0;
    if (m.ep) n.b[m.to + (side === "w" ? 8 : -8)] = "";
    if (m.dbl) n.ep = m.from + (side === "w" ? -8 : 8);
    if (m.promo) n.b[m.to] = side + "q";
    if (m.castle) { const r = side === "w" ? 7 : 0; if (m.castle === "K") { n.b[r * 8 + 5] = n.b[r * 8 + 7]; n.b[r * 8 + 7] = ""; } else { n.b[r * 8 + 3] = n.b[r * 8]; n.b[r * 8] = ""; } }
    if (pc[1] === "k") { n.castle[side + "K"] = false; n.castle[side + "Q"] = false; }
    if (m.from === 63 || m.to === 63) n.castle.wK = false; if (m.from === 56 || m.to === 56) n.castle.wQ = false;
    if (m.from === 7 || m.to === 7) n.castle.bK = false; if (m.from === 0 || m.to === 0) n.castle.bQ = false;
    return n;
  }
  function legalMoves(st, side = st.turn) {
    const out = [], opp = side === "w" ? "b" : "w";
    for (const m of genPseudo(st, side)) {
      if (m.castle) { const r = side === "w" ? 7 : 0; const path = m.castle === "K" ? [r * 8 + 4, r * 8 + 5, r * 8 + 6] : [r * 8 + 4, r * 8 + 3, r * 8 + 2]; if (path.some(s => attacked(st, s, opp))) continue; }
      const n = apply(st, m); if (!inCheck(n, side)) out.push(m);
    }
    return out;
  }
  function evaluate(st) { // from white's view
    let s = 0;
    for (let i = 0; i < 64; i++) { const p = st.b[i]; if (!p) continue; const t = p[1], idx = p[0] === "w" ? i : 63 - i; const v = VAL[t] + PST[t][idx]; s += p[0] === "w" ? v : -v; }
    return s;
  }
  function search(st, depth, alpha, beta, sh) {
    const side = st.turn, sign = side === "w" ? 1 : -1;
    const moves = legalMoves(st);
    if (!moves.length) return inCheck(st, side) ? -99999 : 0;
    if (depth <= 0) return sign * evaluate(st);
    moves.sort((a, b) => (VAL[(st.b[b.to] || "x ")[1]] || 0) - (VAL[(st.b[a.to] || "x ")[1]] || 0));
    let best = -Infinity;
    for (const m of moves) {
      const n = apply(st, m);
      const ext = depth === 1 && n.captured && (VAL[n.captured[1]] || 0) >= 300 ? 1 : 0; // extend on big captures
      const v = -search(n, depth - 1 + ext, -beta, -alpha, sh);
      if (v > best) best = v; if (v > alpha) alpha = v; if (alpha >= beta) break;
    }
    return best;
  }
  function bestMove(st, depth, noise, sh) {
    const moves = legalMoves(st); if (!moves.length) return null;
    let best = null, bestV = -Infinity;
    for (const m of moves) { const v = -search(apply(st, m), depth - 1, -Infinity, Infinity, sh) + (noise ? (sh.rng.next() - 0.5) * noise : 0); if (v > bestV) { bestV = v; best = m; } }
    return best;
  }
  function evalPos(st, sh) { // white-view score after a 2-ply look, mate-aware
    const moves = legalMoves(st); if (!moves.length) return inCheck(st, st.turn) ? (st.turn === "w" ? -99999 : 99999) : 0;
    const v = search(st, 2, -Infinity, Infinity, sh); return st.turn === "w" ? v : -v;
  }
  function writeSummary() {
    const files = "abcdefgh", sq = (i) => files[i % 8] + (8 - Math.floor(i / 8)), mv = (i) => `${Math.floor(i / 2) + 1}${i % 2 ? "…" : "."} ${history[i].san}`;
    const winner = over.includes("White wins") ? "w" : over.includes("Black wins") ? "b" : null, loser = winner === "w" ? "b" : winner === "b" ? "w" : null;
    const name = (c) => c === "w" ? "White" : "Black", you = (c) => (c === "w" && !g.autopilot) ? "you" : name(c);
    const lines = [];
    // how it ended
    if (over.startsWith("Checkmate")) lines.push(`${name(winner)} won by checkmate on move ${Math.ceil(history.length / 2)} (${history[history.length - 1].san}).`);
    else if (over.startsWith("Stalemate")) lines.push(`The game ended in stalemate on move ${Math.ceil(history.length / 2)} — ${name(S.turn)} had no legal move but was not in check.`);
    else lines.push(`${over}, after ${Math.ceil(history.length / 2)} moves.`);
    // material story
    const matW = captured.b.reduce((a, t) => a + VAL[t], 0), matB = captured.w.reduce((a, t) => a + VAL[t], 0);
    const pname = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen" };
    if (Math.abs(matW - matB) >= 100) {
      const ahead = matW > matB ? "w" : "b", took = matW > matB ? captured.b : captured.w;
      const counts = {}; for (const t of took) counts[t] = (counts[t] || 0) + 1;
      const list = Object.entries(counts).sort((a, b) => VAL[b[0]] - VAL[a[0]]).map(([t, n]) => `${n} ${pname[t]}${n > 1 ? "s" : ""}`).join(", ");
      lines.push(`${name(ahead)} finished ${(Math.abs(matW - matB) / 100).toFixed(1).replace(/\.0$/, "")} points of material ahead (took ${list})${!winner ? " but couldn't convert it" : ""}.`);
    }
    // decisive mistakes
    const blunders = history.map((h, i) => ({ i, h })).filter(x => x.h.mark === "??" || x.h.mark === "?").sort((a, b) => a.h.swing - b.h.swing);
    const first = blunders.find(x => history[x.i].pc[0] === loser) || blunders[0];
    if (first) {
      const h = history[first.i], side = h.pc[0], nextCap = history[first.i + 1];
      let why = "";
      if (nextCap && history[first.i + 1].san.includes("x")) why = ` — it allowed ${history[first.i + 1].san}${nextCap.pc ? "" : ""}, ${captureDesc(first.i + 1)}`;
      else if (h.san.includes("x") && history[first.i + 1]?.san.includes("x")) why = ` — the exchange lost material`;
      lines.push(`The turning point was ${mv(first.i)}${h.mark} by ${you(side)}${why}. The engine's evaluation swung by about ${Math.abs(Math.round(h.swing / 100 * 10) / 10)} pawns.`);
    } else if (winner) lines.push(`${name(winner)} built the advantage gradually rather than through one big mistake.`);
    // mistakes count
    const cnt = (c) => ({ bl: history.filter(h => h.pc[0] === c && h.mark === "??").length, mi: history.filter(h => h.pc[0] === c && h.mark === "?").length });
    const cw = cnt("w"), cb = cnt("b");
    lines.push(`Mistakes — White: ${cw.bl} blunder${cw.bl === 1 ? "" : "s"}, ${cw.mi} inaccurac${cw.mi === 1 ? "y" : "ies"}. Black: ${cb.bl} blunder${cb.bl === 1 ? "" : "s"}, ${cb.mi} inaccurac${cb.mi === 1 ? "y" : "ies"}.`);
    // best move
    const best = history.map((h, i) => ({ i, h })).filter(x => x.h.mark === "!").sort((a, b) => b.h.swing - a.h.swing)[0];
    if (best) lines.push(`Best shot: ${mv(best.i)}! by ${you(best.h.pc[0])}, ${captureDesc(best.i)}.`);
    // when the lead changed hands
    const ev = analysis.evals; let lead = 0, changes = [];
    ev.forEach((e, i) => { const l = e > 150 ? 1 : e < -150 ? -1 : 0; if (l !== lead && l !== 0) changes.push([i, l]); if (l !== 0) lead = l; });
    if (changes.length) lines.push(`${name(changes[0][1] > 0 ? "w" : "b")} first took a clear lead after ${mv(changes[0][0])}${changes.length > 1 ? `; the lead changed hands ${changes.length - 1} more time${changes.length > 2 ? "s" : ""}` : ""}.`);
    // time
    const tw = clocks.w, tb = clocks.b, slow = history.slice().sort((a, b) => b.secs - a.secs)[0];
    lines.push(`Time — White ${fmtT(tw)}, Black ${fmtT(tb)}.${slow && slow.secs > 15 ? ` The longest think was ${fmtT(slow.secs)} on ${slow.san}.` : ""}`);
    return lines;
  }
  function captureDesc(i) { const h = history[i]; if (!h) return "a strong move"; const st = replayTo(i); const cap = st.b[h.m.to]; const pn = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" }; return cap ? `winning the ${pn[cap[1]]} on ${"abcdefgh"[h.m.to % 8]}${8 - Math.floor(h.m.to / 8)}` : h.san.includes("+") ? "a check that gained time" : "a strong move"; }
  function replayTo(i) { let st = freshState(); for (let k = 0; k < i; k++) st = apply(st, history[k].m); return st; }
  function fmtT(sec) { return sec >= 60 ? `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s` : `${sec.toFixed(sec < 10 ? 1 : 0)}s`; }
  function posKey(st) { return st.b.join("") + st.turn + JSON.stringify(st.castle) + st.ep; }

  // ---------- play ----------
  function playMove(m, sh, byEngine) {
    const pc = S.b[m.from]; const n = apply(S, m);
    if (n.captured) { captured[n.captured[0]].push(n.captured[1]); const v = VAL[n.captured[1]]; if (pc[0] === "w" && !g.autopilot) { g.score += v; pop(sqX(m.to) + SQ / 2, sqY(m.to), "+" + v, T?.marquee); } sh.audio.hit(); } else sh.audio.blip();
    const secs = Math.max(0, (tick - turnStart)) / 60; clocks[pc[0]] += secs; turnStart = tick;
    history.push({ m, pc, san: san(S, m), secs }); S = n; lastMove = m; sel = null; legal = []; hint = null;
    if (S.turn === "w") moveNo++;
    const k = posKey(S); seen.set(k, (seen.get(k) || 0) + 1);
    const moves = legalMoves(S);
    if (!moves.length) { if (inCheck(S, S.turn)) { over = S.turn === "w" ? "Checkmate — Black wins" : "Checkmate — White wins"; if (S.turn === "b" && !g.autopilot) { g.score += 5000; sh.wallet?.earn(60); } sh.audio.levelUp(); } else { over = "Stalemate — draw"; if (!g.autopilot) sh.wallet?.earn(15); } }
    else if (S.half >= 100) { over = "Draw — 50-move rule"; if (!g.autopilot) sh.wallet?.earn(15); }
    else if (seen.get(k) >= 3) { over = "Draw — threefold repetition"; if (!g.autopilot) sh.wallet?.earn(15); }
    else if (inCheck(S, S.turn)) { say("Check", 60); sh.audio.tone({ freq: 660, type: "triangle", dur: 0.15, vol: 0.1 }); }
    if (over) { say(over, 100000); g._endAt = sh.tick + 60 * 20; analysis = { idx: 0, st: freshState(), evals: [], prevEval: 0 }; }
  }
  function san(st, m) {
    const pc = st.b[m.from], files = "abcdefgh", sq = (i) => files[i % 8] + (8 - Math.floor(i / 8));
    const after = apply(st, m), opp = after.turn, suffix = legalMoves(after).length === 0 ? (inCheck(after, opp) ? "#" : "") : inCheck(after, opp) ? "+" : "";
    if (m.castle) return (m.castle === "K" ? "O-O" : "O-O-O") + suffix;
    const cap = st.b[m.to] || m.ep ? "x" : "";
    if (pc[1] === "p") return (cap ? files[m.from % 8] : "") + cap + sq(m.to) + (m.promo ? "=Q" : "") + suffix;
    // disambiguate when another piece of the same kind can reach the square
    const others = legalMoves(st, pc[0]).filter(o => o.to === m.to && o.from !== m.from && st.b[o.from] === pc);
    let dis = ""; if (others.length) { const sameFile = others.some(o => o.from % 8 === m.from % 8), sameRank = others.some(o => Math.floor(o.from / 8) === Math.floor(m.from / 8)); dis = !sameFile ? files[m.from % 8] : !sameRank ? String(8 - Math.floor(m.from / 8)) : sq(m.from); }
    return pc[1].toUpperCase() + dis + cap + sq(m.to) + suffix;
  }
  function pgn() {
    let out = `[Event "AI Arcade"]\n[Result "${over ? (over.includes("White wins") ? "1-0" : over.includes("Black wins") ? "0-1" : "1/2-1/2") : "*"}"]\n\n`;
    history.forEach((h, i) => { if (i % 2 === 0) out += `${i / 2 + 1}. `; out += `${h.san} {${h.secs.toFixed(1)}s} `; });
    return out.trim();
  }
  // ---------- replay ----------
  function startReplay() { if (!history.length) return; replay = { idx: 0, speed: 1, playing: true, timer: 0, live: { S, lastMove, captured, over, moveNo, seen } }; S = freshState(); lastMove = null; captured = { w: [], b: [] }; sel = null; legal = []; hint = null; say("Replay", 60); }
  function stopReplay() { if (!replay) return; const l = replay.live; S = l.S; lastMove = l.lastMove; captured = l.captured; over = l.over; moveNo = l.moveNo; seen = l.seen; replay = null; say(over || "Back to the game", 60); }
  function replayStep(sh) { if (!replay || replay.idx >= history.length) return false; const h = history[replay.idx++]; const n = apply(S, h.m); if (n.captured) captured[n.captured[0]].push(n.captured[1]); S = n; lastMove = h.m; sh.audio.blip(); return true; }
  function replayBack() { if (!replay || replay.idx === 0) return; const target = replay.idx - 1; S = freshState(); captured = { w: [], b: [] }; lastMove = null; replay.idx = 0; while (replay.idx < target) { const h = history[replay.idx++]; const n = apply(S, h.m); if (n.captured) captured[n.captured[0]].push(n.captured[1]); S = n; lastMove = h.m; } }
  const PANEL_X = OX + SQ * 8 + 16, PANEL_W = W - (OX + SQ * 8 + 16) - 10;
  function buttons() { // [label, x, y, w, h, action]
    const y = OY + SQ * 8 - 26, bw = (PANEL_W - 12) / 4;
    if (!replay) return [[history.length ? "▶ Replay" : "", PANEL_X, y, PANEL_W / 2 - 3, 22, "replay"], ["PGN", PANEL_X + PANEL_W / 2 + 3, y, PANEL_W / 2 - 3, 22, "pgn"], ...(summary ? [[showSummary ? "Hide summary" : "Game summary", PANEL_X, y - 28, PANEL_W, 22, "summary"]] : [])];
    return [["⏮", PANEL_X, y, bw, 22, "first"], [replay.playing ? "⏸" : "▶", PANEL_X + bw + 4, y, bw, 22, "toggle"], ["⏭", PANEL_X + (bw + 4) * 2, y, bw, 22, "step"], [replay.speed === "real" ? "⏱" : `${replay.speed}×`, PANEL_X + (bw + 4) * 3, y, bw, 22, "speed"], ["✕ Exit replay", PANEL_X, y - 28, PANEL_W, 22, "exit"]];
  }
  function buttonAt(px, py) { return buttons().find(b => b[0] && px >= b[1] && px <= b[1] + b[3] && py >= b[2] && py <= b[2] + b[4]); }
  function doButton(b, sh) {
    const a = b[5];
    if (a === "replay") startReplay();
    if (a === "pgn") { const text = pgn(); try { navigator.clipboard?.writeText(text); say("PGN copied to clipboard", 80); } catch { say("Couldn't copy", 60); } }
    if (a === "exit") stopReplay();
    if (a === "summary") showSummary = !showSummary;
    if (a === "toggle") replay.playing = !replay.playing;
    if (a === "step") { replay.playing = false; replayStep(sh); }
    if (a === "first") { replay.playing = false; S = freshState(); captured = { w: [], b: [] }; lastMove = null; replay.idx = 0; }
    if (a === "speed") replay.speed = SPEEDS[(SPEEDS.indexOf(replay.speed) + 1) % SPEEDS.length];
    sh.audio.blip();
  }
  function select(i) { const pc = S.b[i]; if (pc && pc[0] === S.turn) { sel = i; legal = legalMoves(S).filter(m => m.from === i); } else { sel = null; legal = []; } }
  function tryMove(from, to, sh) { const m = legal.find(m => m.from === from && m.to === to); if (m) { sh.record(1000 + from * 100 + to); playMove(m, sh, false); if (!over) thinking = diff.think; return true; } return false; }

  // ---------- input ----------
  function onHover(px, py) { hover = cellAt(px, py); if (drag) { drag.x = px; drag.y = py; } }
  function onInput(action, sh) {
    if (replay) { if (action === "action") replay.playing = !replay.playing; if (action === "right") { replay.playing = false; replayStep(sh); } if (action === "left") { replay.playing = false; replayBack(); } if (action === "up") replay.speed = SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(replay.speed) + 1)]; if (action === "down") replay.speed = SPEEDS[Math.max(0, SPEEDS.indexOf(replay.speed) - 1)]; if (action !== "action") replay.timer = 0; return; }
    if (action === "hint" && !over && S.turn === "w" && !g.autopilot) { hint = bestMove(S, Math.max(2, diff.depth), 0, sh); hintTtl = 300; g.score = Math.max(0, g.score - 50); }
  }
  function onPointerDown(px, py, sh, button) { if (replay || over || thinking > 0 || S.turn !== "w" || g.autopilot || button !== 0) return; const i = cellAt(px, py); if (i < 0) return; const pc = S.b[i]; if (pc && pc[0] === "w") { select(i); drag = { from: i, x: px, y: py, sx: px, sy: py }; } }
  function onPointerUp(px, py, sh) { if (!drag) return; const d = drag; drag = null; if (Math.hypot(px - d.sx, py - d.sy) < 6) return; const to = cellAt(px, py); if (to >= 0) { if (!tryMove(d.from, to, sh)) sh.audio.tone({ freq: 200, type: "square", dur: 0.05, vol: 0.05 }); } }
  function onPointer(px, py, sh) {
    const b = buttonAt(px, py); if (b) { doButton(b, sh); return; }
    if (showSummary && px < OX + SQ * 8) { showSummary = false; return; }
    if (replay || over || thinking > 0 || S.turn !== "w" || g.autopilot) return;
    const i = cellAt(px, py); if (i < 0) { sel = null; legal = []; return; }
    if (sel !== null && tryMove(sel, i, sh)) return;
    select(i);
  }

  // ---------- loop ----------
  function update(sh) {
    tick = sh.tick;
    if (msgTtl > 0) msgTtl--; if (hintTtl > 0 && --hintTtl === 0) hint = null;
    popups = popups.filter(p => (p.ttl -= 1) > 0);
    if (replay) {
      if (replay.playing) {
        const next = history[replay.idx];
        if (replay.speed === "real") { replay.timer++; if (next && replay.timer >= Math.max(12, next.secs * 60)) { replay.timer = 0; if (!replayStep(sh)) replay.playing = false; } else if (!next) replay.playing = false; }
        else { replay.timer += replay.speed; if (replay.timer >= 90) { replay.timer = 0; if (!replayStep(sh)) replay.playing = false; } }
      }
      return;
    }
    if (analysis && analysis.idx < history.length) { // annotate one move per frame so the UI never stalls
      for (let n = 0; n < 2 && analysis.idx < history.length; n++) {
        const h = history[analysis.idx], st = analysis.st, mover = st.turn;
        const before = analysis.prevEval; // white-view eval before this move
        const after = apply(st, h.m); const ev = evalPos(after, sh);
        const swing = mover === "w" ? ev - before : before - ev; // negative = the mover lost ground
        h.eval = ev; h.swing = swing;
        h.mark = swing <= -300 ? "??" : swing <= -120 ? "?" : (swing >= 120 && after.captured ? "!" : "");
        analysis.evals.push(ev); analysis.prevEval = ev; analysis.st = after; analysis.idx++;
      }
      if (analysis.idx >= history.length) { summary = writeSummary(); showSummary = !g.autopilot; }
    }
    if (g._endAt && sh.tick >= g._endAt && !showSummary && !replay) { g._endAt = null; sh.end(); return; }
    if (over) return;
    if (g.autopilot && thinking === 0) thinking = 25;
    if (thinking > 0 && --thinking === 0 && (S.turn === "b" || g.autopilot)) {
      const m = bestMove(S, g.autopilot ? 1 : diff.depth, g.autopilot ? 60 : diff.noise, sh);
      if (m) playMove(m, sh, true);
    }
  }
  function hud() { const mat = (side) => captured[side === "w" ? "b" : "w"].reduce((a, t) => a + VAL[t], 0) / 100; return `${diff.name} · move ${moveNo} · ${over ? over : S.turn === "w" ? (thinking ? "engine thinking…" : "your move") : "engine thinking…"} · material ${mat("w") >= mat("b") ? "+" : ""}${(mat("w") - mat("b")).toFixed(0)}`; }

  // ---------- render ----------
  function render(c, sh) {
    T = sh.theme; tick = sh.tick;
    const bg = c.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.75); bg.addColorStop(0, T.bgGlow1); bg.addColorStop(1, T.bg); c.fillStyle = bg; c.fillRect(0, 0, W, H);
    // board frame
    c.fillStyle = "#00000066"; rr(c, OX - 10, OY - 10, SQ * 8 + 20, SQ * 8 + 20, 10); c.fill();
    const light = shade(T.surface3, 0.45), dark = shade(T.surface2, -0.15);
    for (let i = 0; i < 64; i++) {
      const x = sqX(i), y = sqY(i), isLight = ((i % 8) + Math.floor(i / 8)) % 2 === 0;
      c.fillStyle = isLight ? light : dark; c.fillRect(x, y, SQ, SQ);
      if (lastMove && (lastMove.from === i || lastMove.to === i)) { c.fillStyle = T.marquee; c.globalAlpha = 0.28; c.fillRect(x, y, SQ, SQ); c.globalAlpha = 1; }
      if (sel === i) { c.fillStyle = T.cyan; c.globalAlpha = 0.35; c.fillRect(x, y, SQ, SQ); c.globalAlpha = 1; }
      if (hint && hintTtl > 0 && (hint.from === i || hint.to === i)) { c.strokeStyle = T.marquee; c.lineWidth = 3; c.globalAlpha = 0.5 + 0.5 * Math.sin(tick / 5); c.strokeRect(x + 2, y + 2, SQ - 4, SQ - 4); c.globalAlpha = 1; }
    }
    const kw = kingSq(S, S.turn); if (!over && inCheck(S, S.turn) && kw >= 0) { const grd = c.createRadialGradient(sqX(kw) + SQ / 2, sqY(kw) + SQ / 2, 4, sqX(kw) + SQ / 2, sqY(kw) + SQ / 2, SQ * 0.7); grd.addColorStop(0, T.accent + "AA"); grd.addColorStop(1, T.accent + "00"); c.fillStyle = grd; c.fillRect(sqX(kw), sqY(kw), SQ, SQ); }
    for (const m of legal) { const x = sqX(m.to) + SQ / 2, y = sqY(m.to) + SQ / 2; c.fillStyle = T.cyan; c.globalAlpha = 0.6; if (S.b[m.to] || m.ep) { c.lineWidth = 3; c.strokeStyle = T.cyan; c.beginPath(); c.arc(x, y, SQ / 2 - 4, 0, 7); c.stroke(); } else { c.beginPath(); c.arc(x, y, 7, 0, 7); c.fill(); } c.globalAlpha = 1; }
    c.fillStyle = T.textDim; c.font = "10px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    for (let i = 0; i < 8; i++) { c.fillText("abcdefgh"[i], OX + i * SQ + SQ / 2, OY + SQ * 8 + 14); c.fillText(8 - i, OX - 16, OY + i * SQ + SQ / 2); }
    for (let i = 0; i < 64; i++) { if (!S.b[i] || (drag && drag.from === i && Math.hypot(drag.x - drag.sx, drag.y - drag.sy) >= 6)) continue; piece(c, S.b[i], sqX(i) + SQ / 2, sqY(i) + SQ / 2); }
    if (drag && Math.hypot(drag.x - drag.sx, drag.y - drag.sy) >= 6) { c.save(); c.shadowColor = "#000"; c.shadowBlur = 20; c.shadowOffsetY = 8; piece(c, S.b[drag.from], drag.x, drag.y, 1.1); c.restore(); }
    // side panel: captured pieces + move list
    const px = PANEL_X;
    c.fillStyle = T.textDim; c.font = "11px system-ui,sans-serif"; c.textAlign = "left"; c.fillText("BLACK", px, OY + 6);
    c.font = "20px system-ui,sans-serif"; c.fillStyle = "#fff"; captured.w.forEach((t, i) => c.fillText(GLYPH[t], px + (i % 3) * 20, OY + 28 + Math.floor(i / 3) * 20));
    c.fillStyle = T.textDim; c.font = "11px system-ui,sans-serif"; c.fillText("WHITE", px, OY + SQ * 8 - 50);
    c.font = "20px system-ui,sans-serif"; c.fillStyle = "#1B1F2A"; c.shadowColor = "#fff"; c.shadowBlur = 4; captured.b.forEach((t, i) => c.fillText(GLYPH[t], px + (i % 3) * 20, OY + SQ * 8 - 28 + Math.floor(i / 3) * 20)); c.shadowBlur = 0;
    // move log: full game, auto-scrolled to the latest (or to the replay cursor)
    const logY = OY + 100, logH = OY + SQ * 8 - 60 - logY, rowH = 14, rows = Math.floor(logH / rowH), pairs = Math.ceil(history.length / 2);
    const cursor = replay ? replay.idx : history.length; const curPair = Math.max(0, Math.ceil(cursor / 2) - 1);
    const first = Math.max(0, Math.min(pairs - rows, curPair - rows + 2));
    const fmt = (sec) => sec >= 60 ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}` : `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
    const liveTurn = !over && !replay ? (tick - turnStart) / 60 : 0;
    c.fillStyle = T.textDim; c.font = "11px system-ui,sans-serif"; c.fillText(`MOVES (${history.length})`, px, logY - 26);
    c.fillStyle = "#fff"; c.font = "11px ui-monospace,monospace"; c.fillText(`♔ ${fmt(clocks.w + (S.turn === "w" ? liveTurn : 0))}   ♚ ${fmt(clocks.b + (S.turn === "b" ? liveTurn : 0))}`, px, logY - 12);
    c.font = "10px ui-monospace,monospace";
    for (let r = 0; r < rows && first + r < pairs; r++) {
      const pr = first + r, i = pr * 2, y = logY + r * rowH;
      c.fillStyle = T.textDim; c.textAlign = "left"; c.fillText(`${pr + 1}.`, px, y);
      for (const k of [0, 1]) {
        const h = history[i + k]; if (!h) continue; const x = px + 22 + k * 66, cur = replay && i + k === replay.idx - 1, played = !replay || i + k < replay.idx;
        if (cur) { c.fillStyle = T.marquee; c.fillRect(x - 2, y - 7, 64, 14); }
        c.fillStyle = cur ? "#000" : played ? "#fff" : T.textDim; c.font = "700 10px ui-monospace,monospace"; c.fillText(h.san, x, y);
        if (h.mark) { c.fillStyle = h.mark === "!" ? "#4CD964" : h.mark === "??" ? T.accent : T.marquee; c.fillText(h.mark, x + c.measureText(h.san).width + 1, y); }
        c.fillStyle = cur ? "#333" : T.textDim; c.font = "9px ui-monospace,monospace"; c.textAlign = "right"; c.fillText(fmt(h.secs), x + 60, y); c.textAlign = "left";
      }
    }
    for (const b of buttons()) { if (!b[0]) continue; c.fillStyle = b[5] === "exit" ? T.surface3 : T.marquee; rr(c, b[1], b[2], b[3], b[4], 6); c.fill(); c.fillStyle = b[5] === "exit" ? T.text : "#000"; c.font = "700 11px system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(b[0], b[1] + b[3] / 2, b[2] + b[4] / 2 + 1); }
    if (replay) { c.fillStyle = T.cyan; c.font = "11px system-ui,sans-serif"; c.textAlign = "left"; c.fillText(`Replay ${replay.idx}/${history.length} · ${replay.speed === "real" ? "real time" : replay.speed + "×"} · Space, ←/→, ↑/↓`, px, OY + SQ * 8 + 14, PANEL_W); }
    for (const p of popups) { const k = 1 - p.ttl / 70; c.globalAlpha = Math.min(1, p.ttl / 15); c.fillStyle = p.color || "#fff"; c.font = "800 14px system-ui,sans-serif"; c.textAlign = "center"; c.shadowColor = "#000"; c.shadowBlur = 6; c.fillText(p.text, p.x, p.y - k * 22); c.shadowBlur = 0; } c.globalAlpha = 1;
    if (!replay && thinking > 0 && S.turn === "b") { c.fillStyle = T.cyan; c.globalAlpha = 0.6 + 0.4 * Math.sin(tick / 5); c.font = "11px system-ui,sans-serif"; c.textAlign = "left"; c.fillText("thinking…", px, OY + SQ * 8 + 14); c.globalAlpha = 1; }
    if (showSummary && summary) drawSummary(c);
    if (analysis && analysis.idx < history.length && over) { c.fillStyle = T.cyan; c.font = "11px system-ui,sans-serif"; c.textAlign = "left"; c.fillText(`analysing… ${analysis.idx}/${history.length}`, PANEL_X, OY + SQ * 8 + 14); }
    if (msgTtl > 0 && msg && !replay && !showSummary) { c.font = `800 ${over ? 20 : 16}px 'Chakra Petch',system-ui,sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; const tw = c.measureText(msg).width + 28; c.fillStyle = T.bg; c.globalAlpha = 0.85; rr(c, OX + SQ * 4 - tw / 2, OY + SQ * 4 - 16, tw, 32, 16); c.fill(); c.globalAlpha = 1; c.fillStyle = T.marquee; c.fillText(msg, OX + SQ * 4, OY + SQ * 4); }
  }
  function drawSummary(c) {
    const x = OX + 10, y = OY + 10, w = SQ * 8 - 20, h = SQ * 8 - 20;
    c.fillStyle = "rgba(0,0,0,0.78)"; rr(c, x, y, w, h, 14); c.fill(); c.strokeStyle = "#ffffff22"; c.lineWidth = 1; rr(c, x + 0.5, y + 0.5, w - 1, h - 1, 14); c.stroke();
    c.fillStyle = T.marquee; c.font = "800 20px 'Chakra Petch',system-ui,sans-serif"; c.textAlign = "left"; c.textBaseline = "top"; c.fillText(over, x + 18, y + 16);
    c.fillStyle = "#fff"; c.font = "13px system-ui,sans-serif"; let ty = y + 50;
    for (const line of summary) { ty = wrapText(c, "• " + line, x + 18, ty, w - 36, 18) + 8; }
    c.fillStyle = T.textDim; c.font = "11px system-ui,sans-serif"; c.textBaseline = "bottom"; c.fillText("?? blunder · ? inaccuracy · ! strong move — click to close", x + 18, y + h - 12); c.textBaseline = "middle";
  }
  function wrapText(c, text, x, y, maxW, lh) { const words = text.split(" "); let line = ""; for (const wd of words) { const t = line ? line + " " + wd : wd; if (c.measureText(t).width > maxW && line) { c.fillText(line, x, y); y += lh; line = wd; } else line = t; } if (line) { c.fillText(line, x, y); y += lh; } return y; }
  function piece(c, pc, x, y, scale = 1) {
    const white = pc[0] === "w";
    c.save(); c.translate(x, y); c.scale(scale, scale);
    c.font = "800 40px 'Segoe UI Symbol','Apple Symbols','DejaVu Sans',system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = "#00000066"; c.fillText(GLYPH[pc[1]], 2, 4);
    c.fillStyle = white ? "#F4F1E8" : "#1C1F2B"; c.shadowColor = white ? "#000" : T.cyan; c.shadowBlur = white ? 0 : 0; c.fillText(GLYPH[pc[1]], 0, 1);
    c.strokeStyle = white ? "#3B3A36" : "#9DB4CC"; c.lineWidth = 1; c.strokeText(GLYPH[pc[1]], 0, 1);
    c.restore();
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function shade(hex, amt) { if (!hex || hex[0] !== "#" || hex.length < 7) return hex; const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return "#" + ch.map(v => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))).toString(16).padStart(2, "0")).join(""); }
  return g;
}
