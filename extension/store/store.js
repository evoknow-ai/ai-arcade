import { API_BASE, CATALOG_REFRESH_MINUTES } from "../config.js";
import { CATALOG } from "../games/catalog.js";
import { GameShell } from "../shell/GameShell.js";
import * as store from "../shell/storage.js";
import { fetchLeaderboard, submitScore, registerName } from "../shell/leaderboard.js";
import { THEMES, loadTheme, saveTheme, currentTheme } from "../shell/theme.js";
import { Recorder, download } from "../shell/recorder.js";
const recorder = new Recorder(); let lastClip = null;

const $ = (id) => document.getElementById(id);
let remote = { games: {} };           // server metadata keyed by game id
let shell = null, attractShell = null, current = null, period = "all";
let identity = await store.getIdentity();
let favorites = await store.getFavorites();
let activeFilter = "All";
let playStart = null; // when the current run started, for time-played stats
const HEART = `<svg viewBox="0 0 24 24"><path d="M12 21s-7-4.6-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.4-9.5 9-9.5 9z"/></svg>`;
const PLAY_ICON = `<svg viewBox="0 0 24 24"><path d="M7 4l12 8-12 8z"/></svg>`;
const CLOCK_ICON = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
async function toggleFavorite(id) { favorites = favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites, id]; await store.setFavorites(favorites); }
function fmtDuration(ms) { const s = Math.round(ms / 1000); if (s < 60) return `${s}s`; const m = Math.floor(s / 60); if (m < 60) return `${m}m`; const h = Math.floor(m / 60); return `${h}h ${m % 60}m`; }
function fmtAgo(ts) { const d = Date.now() - ts; const m = Math.floor(d / 60000); if (m < 1) return "just now"; if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; const days = Math.floor(h / 24); return days === 1 ? "yesterday" : `${days}d ago`; }
function flushPlayTime() { if (playStart && current) { store.addPlayTime(current.id, Date.now() - playStart); playStart = null; } }
await loadTheme();
let difficulty = (await store.getSync("difficulty")).difficulty || "intermediate";
// shared credits wallet: games earn with good play and spend in their shops
const wallet = {
  balance: await store.getCredits(),
  earn(n) { this.balance += Math.round(n); store.setCredits(this.balance); renderCredits(); },
  spend(n) { if (this.balance < n) return false; this.balance -= n; store.setCredits(this.balance); renderCredits(); return true; },
};
function renderCredits() { $("credits").textContent = wallet.balance.toLocaleString() + " cr"; }
const DIFF_LABEL = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

// ---------- Store view ----------
async function renderStore() {
  const featuredId = remote.featured || "pipedream";
  const featured = CATALOG.find(g => g.id === featuredId && g.status === "ready") || CATALOG.find(g => g.status === "ready");
  $("heroTitle").textContent = featured.title;
  $("heroMarquee").textContent = featured.title;
  $("heroTagline").textContent = featured.tagline;
  $("heroAi").textContent = featured.ai || "";
  $("heroKicker").textContent = remote.featured ? "Featured this week" : "Featured";
  const best = await store.localBest(featured.id);
  $("heroLocalBest").textContent = best ? best.score.toLocaleString() : "–";
  $("heroWorld").hidden = !API_BASE;
  $("heroWorldBest").textContent = remote.games[featured.id]?.top?.score?.toLocaleString() || "–";
  $("heroPlay").onclick = () => play(featured);
  startAttract(featured);

  const genres = ["All", "♥ Favorites", ...new Set(CATALOG.map(g => g.genre))];
  const filters = $("filters"); filters.innerHTML = "";
  for (const genre of genres) {
    const b = document.createElement("button"); b.textContent = genre; if (genre === activeFilter) b.classList.add("on"); if (genre.startsWith("♥")) b.classList.add("fav-filter");
    b.onclick = () => { activeFilter = genre; [...filters.children].forEach(x => x.classList.toggle("on", x === b)); list(activeFilter); };
    filters.appendChild(b);
  }
  list(activeFilter);

  async function list(genre) {
    const ul = $("games"); ul.innerHTML = "";
    const { bests = {} } = await store.get("bests");
    const stats = await store.getStats();
    let i = 0;
    const games = CATALOG.filter(g => genre === "All" || (genre.startsWith("♥") ? favorites.includes(g.id) : g.genre === genre));
    if (!games.length) { ul.innerHTML = `<li class="empty">No favorites yet — tap the heart on any game.</li>`; return; }
    for (const g of games) {
      const li = document.createElement("li");
      li.className = "game" + (g.status === "soon" ? " soon" : ""); li.dataset.genre = g.genre;
      const world = remote.games[g.id]?.top, st = stats[g.id] || { plays: 0, timeMs: 0 }, fav = favorites.includes(g.id);
      li.style.setProperty("--d", `${0.3 + i * 0.05}s`); li.classList.add("reveal"); i++;
      li.innerHTML = `<div class="cover"><img src="../covers/${g.id}.jpg" alt="" loading="lazy" onerror="this.remove()"><span class="genre">${g.genre}</span>
          <button class="fav${fav ? " on" : ""}" title="${fav ? "Remove from favorites" : "Add to favorites"}" aria-pressed="${fav}">${HEART}</button>
          <div class="icon">${ICONS[g.id] || ICONS.default}</div></div>
        <div class="inner">
        <h3>${g.title}</h3><p>${g.tagline}</p>
        <div class="stats"><span>${PLAY_ICON}<b>${st.plays}</b> ${st.plays === 1 ? "play" : "plays"}</span><span>${CLOCK_ICON}<b>${fmtDuration(st.timeMs)}</b> played</span>${st.lastPlayed ? `<span>last ${fmtAgo(st.lastPlayed)}</span>` : ""}</div>
        <div class="row"><span>Your best <b>${bests[g.id]?.score?.toLocaleString() ?? "–"}</b>${API_BASE ? ` · World <b>${world ? world.score.toLocaleString() + " " + esc(world.name) : "–"}</b>` : ""}</span>
        <button class="playbtn">${g.status === "soon" ? "Coming soon" : "Play"}</button></div></div>`;
      if (g.status === "ready") li.querySelector(".playbtn").onclick = () => play(g);
      li.querySelector(".fav").onclick = async (e) => { e.stopPropagation(); await toggleFavorite(g.id); const on = favorites.includes(g.id); e.currentTarget.classList.toggle("on", on); e.currentTarget.title = on ? "Remove from favorites" : "Add to favorites"; if (genre.startsWith("♥") && !on) list(genre); };
      tilt(li, 5);
      ul.appendChild(li);
    }
  }
}

async function startAttract(game) {
  attractShell?.destroy();
  const mod = await game.load();
  attractShell = new GameShell({ canvas: $("attract"), game: mod.default({ autopilot: true }), seed: 7, onEnd: () => setTimeout(() => startAttract(game), 1200) });
  attractShell.audio.muted = true;
  attractShell.input.destroy(); // attract mode never takes input
  attractShell.start();
}

// ---------- Play view ----------
async function play(game) {
  attractShell?.destroy(); attractShell = null;
  flushPlayTime();
  current = game; playStart = Date.now(); store.bumpPlays(game.id);
  syncDifficultyUI();
  $("storeView").hidden = true; $("playView").hidden = false;
  $("playTitle").textContent = game.title; renderKeystrip(game);
  loadBoard();
  const mod = await game.load();
  shell?.destroy();
  shell = new GameShell({
    canvas: $("game"), game: mod.default({ difficulty }), wallet,
    onHud: ({ score, level, elapsed, extra }) => {
      $("hudScore").textContent = score.toLocaleString(); $("hudLevel").textContent = level;
      $("hudTime").textContent = fmt(elapsed); $("hudExtra").textContent = extra || "";
    },
    onEnd: (result) => gameOver(result),
  });
  shell.start();
  $("game").focus();
}

async function gameOver(result) {
  flushPlayTime();
  const isBest = await store.recordLocalBest(current.id, { score: result.score, level: result.level, ts: Date.now() });
  $("finalScore").textContent = result.score.toLocaleString(); $("finalLevel").textContent = result.level;
  $("finalNote").textContent = isBest ? "New personal best." : "";
  const dlg = $("overDialog");
  const showNameField = (show) => { $("finalNameWrap").hidden = !show; $("savedAs").hidden = show; if (show) { $("finalName").value = identity.displayName; setTimeout(() => $("finalName").focus(), 0); } };
  $("savedName").textContent = identity.displayName;
  showNameField(!identity.displayName); // ask once; afterwards the name is remembered
  $("changeName").onclick = () => showNameField(true);
  dlg.showModal();
  dlg.onclose = async () => {
    const v = dlg.returnValue;
    if (!$("finalNameWrap").hidden) {
      const name = $("finalName").value.trim();
      if (name && name !== identity.displayName) { await store.setSync({ displayName: name }); identity.displayName = name; $("nameBtn").textContent = name; if (API_BASE) registerName(API_BASE, name); }
    }
    // every finished run is saved, whichever button closed the dialog
    await store.addLocalScore(current.id, { name: identity.displayName || "Player", score: result.score, level: result.level, difficulty, ts: Date.now(), playerId: identity.playerId });
    if (API_BASE) { $("boardNote").textContent = "Submitting…"; await submitScore(API_BASE, { gameId: current.id, ...result }); }
    if (v === "again") play(current); else backToStore(); // Esc counts as back to store
  };
}

function backToStore() {
  if (recorder.active) finishRecording();
  flushPlayTime();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); // leaving the stage fullscreen would otherwise hide the store
  shell?.destroy(); shell = null;
  $("playView").hidden = true; $("storeView").hidden = false;
  renderStore();
}

async function loadBoard() {
  const ol = $("boardList"); ol.innerHTML = "";
  if (!API_BASE) { // local-only mode
    const rows = await store.localScores(current.id, period);
    $("boardTitle").textContent = "Your scores";
    if (!rows.length) { $("boardNote").textContent = "No runs yet. Your finished games show up here."; return; }
    for (const r of rows.slice(0, 50)) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="n">${esc(r.name)} <small>L${r.level}${r.difficulty ? " · " + DIFF_LABEL[r.difficulty][0] : ""}</small></span><span class="s">${r.score.toLocaleString()}</span>`;
      ol.appendChild(li);
    }
    $("boardNote").textContent = "Global leaderboard coming soon.";
    return;
  }
  try {
    const rows = await fetchLeaderboard(API_BASE, current.id, period);
    setNet(true);
    if (!rows.length) { $("boardNote").textContent = "No scores yet. Be the first."; return; }
    for (const r of rows) {
      const li = document.createElement("li");
      if (r.playerId === identity.playerId) li.className = "me";
      li.innerHTML = `<span class="n">${esc(r.name)}</span><span class="s">${r.score.toLocaleString()}</span>`;
      ol.appendChild(li);
    }
    $("boardNote").textContent = "";
  } catch {
    setNet(false);
    const best = await store.localBest(current.id);
    $("boardNote").textContent = best ? `Server unreachable. Your best here: ${best.score.toLocaleString()}.` : "Server unreachable. Scores are queued and sent when it's back.";
  }
}

// ---------- Wiring ----------
$("back").onclick = backToStore;
$("home").onclick = (e) => { e.preventDefault(); if (shell) backToStore(); };
$("pause").onclick = () => shell?.togglePause();
document.querySelectorAll(".periods button").forEach(b => b.onclick = () => {
  period = b.dataset.period; document.querySelectorAll(".periods button").forEach(x => x.classList.toggle("on", x === b)); loadBoard();
});
renderCredits();
$("nameBtn").textContent = identity.displayName || "Set your name";
$("nameBtn").onclick = () => { $("nameInput").value = identity.displayName; const d = $("nameDialog"); d.showModal(); d.onclose = async () => {
  if (d.returnValue !== "save") return;
  const name = $("nameInput").value.trim(); if (!name) return;
  await store.setSync({ displayName: name }); identity.displayName = name; $("nameBtn").textContent = name; if (API_BASE) registerName(API_BASE, name);
}; };

// difficulty controls (hero + HUD share state)
function syncDifficultyUI() {
  document.querySelectorAll(".difficulty button").forEach(b => b.classList.toggle("on", b.dataset.level === difficulty));
}
document.querySelectorAll(".difficulty button").forEach(b => b.onclick = async () => {
  if (b.dataset.level === difficulty) return;
  difficulty = b.dataset.level; await store.setSync({ difficulty }); syncDifficultyUI();
  if (shell && current) play(current); // restart at the new difficulty
});
syncDifficultyUI();

// theme picker
$("themeBtn").onclick = () => {
  const list = $("themeList"); list.innerHTML = "";
  for (const [id, t] of Object.entries(THEMES)) {
    const b = document.createElement("button"); b.type = "button"; b.className = "theme" + (t === currentTheme() ? " on" : "");
    b.style.setProperty("--t-surface", t.surface); b.style.setProperty("--t-text", t.text); b.style.setProperty("--t-dim", t.textDim);
    b.innerHTML = `<b>${t.name}</b><small>${t.blurb}</small><span class="sw">${[t.bg, t.surface2, t.marquee, t.accent, t.cyan].map(c => `<i style="background:${c}"></i>`).join("")}</span>`;
    b.onclick = async () => { await saveTheme(id); [...list.children].forEach(x => x.classList.toggle("on", x === b)); };
    list.appendChild(b);
  }
  $("themeDialog").showModal();
};

// gameplay recording
async function toggleRecording() {
  if (!shell) return;
  if (recorder.active) { await finishRecording(); return; }
  try { recorder.start($("game"), shell.audio.stream()); } catch (e) { console.warn(e); $("hudExtra").textContent = "Recording isn't available in this browser"; return; }
  $("recBtn").classList.add("on"); $("recBtn").textContent = "■ Stop";
}
async function finishRecording() {
  const res = await recorder.stop(); $("recBtn").classList.remove("on"); $("recBtn").textContent = "● Rec";
  if (!res) return;
  const d = $("clipDialog"), status = $("clipStatus"), bar = $("clipBar"), video = $("clipVideo"), save = $("clipSave");
  video.hidden = true; save.hidden = true; bar.style.width = "0%"; d.showModal();
  let blob = res.blob, ext = "mp4";
  if (!res.mime.startsWith("video/mp4")) {
    status.textContent = "Converting to MP4 with ffmpeg…"; bar.style.width = "5%";
    const mp4 = await recorder.toMp4(res.blob, (p) => { bar.style.width = `${5 + p * 95}%`; status.textContent = `Converting to MP4… ${Math.round(p * 100)}%`; });
    if (mp4) blob = mp4; else { ext = "webm"; status.textContent = "MP4 converter not installed (see tools/fetch-ffmpeg.sh) — saving as WebM."; }
  }
  bar.style.width = "100%"; if (ext === "mp4") status.textContent = `${Math.round(res.seconds)}s clip ready · ${(blob.size / 1048576).toFixed(1)} MB`;
  const name = `${current?.id || "arcade"}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`;
  lastClip = { blob, name }; video.src = URL.createObjectURL(blob); video.hidden = false; save.hidden = false; save.textContent = `Download ${ext.toUpperCase()}`;
  save.onclick = () => download(blob, name);
}
$("recBtn").onclick = toggleRecording;

// keyboard shortcuts: on-screen strip, help dialog, fullscreen, mute
function renderKeystrip(game) {
  const strip = $("keystrip"); strip.innerHTML = "";
  const items = [...(game.shortcuts || []), ["P", "Pause"], ["R", "Record clip"], ["F", "Full screen"], ["?", "All keys"]];
  for (const [keys, label] of items) {
    const span = document.createElement("span");
    span.innerHTML = keys.split(" ").filter(Boolean).map(k => /^(\/|\+)$/.test(k) ? k : `<kbd>${esc(k)}</kbd>`).join(" ") + ` ${esc(label)}`;
    strip.appendChild(span);
  }
}
function showKeys() {
  if (!current) return;
  $("keysGame").textContent = current.title;
  const list = $("keysList"); list.innerHTML = "";
  for (const [keys, label] of current.shortcuts || []) {
    const row = document.createElement("div");
    row.innerHTML = `<dt>${keys.split(" ").filter(Boolean).map(k => /^(\/|\+)$/.test(k) ? k : `<kbd>${esc(k)}</kbd>`).join(" ")}</dt><dd>${esc(label)}</dd>`;
    list.appendChild(row);
  }
  const wasPaused = shell?.paused; if (shell && !wasPaused) shell.togglePause();
  const d = $("keysDialog"); d.showModal(); d.onclose = () => { if (shell && !wasPaused && shell.paused) shell.togglePause(); };
}
function toggleFullscreen() {
  const stage = document.querySelector(".stage");
  if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen?.();
}
$("keysBtn").onclick = showKeys;
$("fullscreenBtn").onclick = toggleFullscreen;
window.addEventListener("beforeunload", flushPlayTime);
window.addEventListener("keydown", (e) => {
  const tag = e.target?.tagName; if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable || document.querySelector("dialog[open]")) return;
  if (!shell) return;
  if (e.key === "f" || e.key === "F") { e.preventDefault(); toggleFullscreen(); }
  if (e.key === "?" ) { e.preventDefault(); showKeys(); }
  if (e.key === "m" || e.key === "M") { shell.audio.muted = !shell.audio.muted; $("hudExtra").dataset.muted = shell.audio.muted; }
  if (e.key === "r" || e.key === "R") { e.preventDefault(); toggleRecording(); }
});
document.addEventListener("fullscreenchange", () => $("fullscreenBtn").textContent = document.fullscreenElement ? "⤢" : "⛶");

// 3D tilt that follows the pointer
function tilt(el, max = 8) {
  el.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--ry", `${x * max}deg`); el.style.setProperty("--rx", `${-y * max}deg`);
  });
  el.addEventListener("pointerleave", () => { el.style.removeProperty("--ry"); el.style.removeProperty("--rx"); });
}
tilt($("cabinet"), 10);

// simple line icons per game, drawn in the genre colour
const ICONS = {
  pipedream: `<svg viewBox="0 0 40 40" fill="none" stroke="var(--genre)" stroke-width="4" stroke-linecap="round"><path d="M6 12h14a6 6 0 0 1 6 6v16"/><path d="M34 28H26"/><circle cx="6" cy="12" r="3" fill="var(--genre)"/></svg>`,
  snake: `<svg viewBox="0 0 40 40" fill="none" stroke="var(--genre)" stroke-width="4" stroke-linecap="round"><path d="M8 30c0-6 4-8 8-8s8 2 8-4-4-6-8-6"/><circle cx="30" cy="12" r="3" fill="var(--genre)" stroke="none"/></svg>`,
  breakout: `<svg viewBox="0 0 40 40" fill="var(--genre)"><rect x="6" y="6" width="8" height="5" rx="1"/><rect x="16" y="6" width="8" height="5" rx="1"/><rect x="26" y="6" width="8" height="5" rx="1"/><rect x="11" y="13" width="8" height="5" rx="1"/><rect x="21" y="13" width="8" height="5" rx="1"/><circle cx="20" cy="25" r="3"/><rect x="12" y="32" width="16" height="4" rx="2"/></svg>`,
  stacker: `<svg viewBox="0 0 40 40" fill="var(--genre)"><rect x="6" y="26" width="8" height="8" rx="1"/><rect x="16" y="26" width="8" height="8" rx="1"/><rect x="26" y="26" width="8" height="8" rx="1"/><rect x="16" y="16" width="8" height="8" rx="1"/><rect x="26" y="16" width="8" height="8" rx="1"/><rect x="26" y="6" width="8" height="8" rx="1" opacity=".5"/></svg>`,
  rocks: `<svg viewBox="0 0 40 40" fill="none" stroke="var(--genre)" stroke-width="3" stroke-linejoin="round"><path d="M20 6l8 16H12z" fill="var(--genre)"/><path d="M28 28l5-3 3 5-4 4-5-2z"/><path d="M6 28l4-4 4 3-2 5-5 0z"/></svg>`,
  maze: `<svg viewBox="0 0 40 40" fill="none" stroke="var(--genre)" stroke-width="3"><path d="M6 6h28v28H6zM6 14h12M22 14h12M14 14v12M26 22h8M14 26h12"/><circle cx="10" cy="30" r="2.5" fill="var(--genre)" stroke="none"/></svg>`,
  scorched: `<svg viewBox="0 0 40 40" fill="none" stroke="var(--genre)" stroke-width="3" stroke-linecap="round"><path d="M4 30q8-10 14-4t8-8 10-2"/><path d="M8 30h8"/><path d="M12 30v-4l5-5"/><circle cx="29" cy="12" r="2.5" fill="var(--genre)" stroke="none"/></svg>`,
  minefield: `<svg viewBox="0 0 40 40" fill="var(--genre)"><circle cx="20" cy="22" r="8"/><path d="M20 8v6M20 30v6M6 22h6M28 22h6M10 12l4 4M26 16l4-4M10 32l4-4M26 28l4 4" stroke="var(--genre)" stroke-width="2.5"/><path d="M22 10l4-5" stroke="var(--genre)" stroke-width="2.5"/></svg>`,
  missile: `<svg viewBox="0 0 40 40" fill="none" stroke="var(--genre)" stroke-width="3" stroke-linecap="round"><path d="M6 34h28"/><path d="M12 34v-6M20 34v-9M28 34v-6"/><path d="M30 6l-7 12M10 6l5 10"/><circle cx="21" cy="21" r="4" fill="var(--genre)" stroke="none"/></svg>`,
  solitaire: `<svg viewBox="0 0 40 40" fill="none" stroke="var(--genre)" stroke-width="2.5"><rect x="6" y="9" width="16" height="22" rx="2" transform="rotate(-8 14 20)"/><rect x="17" y="8" width="16" height="22" rx="2" fill="var(--genre)" fill-opacity=".2" transform="rotate(8 25 19)"/><path d="M25 15l3 3-3 3-3-3z" fill="var(--genre)" stroke="none"/></svg>`,
  belt: `<svg viewBox="0 0 40 40" fill="none" stroke="var(--genre)" stroke-width="2.5" stroke-linejoin="round"><path d="M20 30l-6 6 3-8-3-4 4-3 2-5 2 5 4 3-3 4 3 8z" fill="var(--genre)"/><path d="M8 8l4 2-2 4-4-2z"/><path d="M30 6l3 3-2 3-3-2z"/></svg>`,
  chopper: `<svg viewBox="0 0 40 40" fill="none" stroke="var(--genre)" stroke-width="3" stroke-linecap="round"><path d="M8 12h24"/><path d="M20 12v4"/><ellipse cx="22" cy="21" rx="9" ry="5" fill="var(--genre)"/><path d="M13 21H5l-1-4"/><path d="M16 29h12"/></svg>`,
  lander: `<svg viewBox="0 0 40 40" fill="none" stroke="var(--genre)" stroke-width="2.5" stroke-linecap="round"><path d="M14 20h12l-2-8h-8z" fill="var(--genre)"/><path d="M14 20l-4 8M26 20l4 8M8 28h5M27 28h5"/><path d="M18 24l2 6 2-6" stroke="var(--marquee)"/><path d="M4 34h32"/></svg>`,
  invaders: `<svg viewBox="0 0 40 40" fill="var(--genre)"><rect x="12" y="8" width="4" height="4"/><rect x="24" y="8" width="4" height="4"/><rect x="8" y="12" width="24" height="4"/><rect x="4" y="16" width="32" height="8"/><rect x="8" y="24" width="4" height="4"/><rect x="28" y="24" width="4" height="4"/><rect x="12" y="28" width="4" height="4"/><rect x="24" y="28" width="4" height="4"/></svg>`,
  rails: `<svg viewBox="0 0 40 40" fill="none" stroke="var(--genre)" stroke-width="2.5" stroke-linecap="round"><path d="M4 12h32M4 28h32"/><path d="M12 12c8 0 8 16 16 16"/><path d="M8 8v8M32 24v8"/></svg>`,
  chess: `<svg viewBox="0 0 40 40" fill="var(--genre)"><path d="M14 34h12v-3H14zM15 29h10l-2-9h-6z"/><path d="M16 18h8l2-6-3 2-3-6-3 6-3-2z"/></svg>`,
  tower: `<svg viewBox="0 0 40 40" fill="var(--genre)"><path d="M10 34h20v-4H10zM13 30h14V16H13z"/><path d="M11 16h18v-5h-4v3h-3v-3h-4v3h-3v-3h-4z"/><circle cx="20" cy="22" r="3" fill="#000" fill-opacity=".4"/></svg>`,
  default: `<svg viewBox="0 0 40 40" fill="var(--genre)"><circle cx="20" cy="20" r="8"/></svg>`,
};

function setNet(on) { const s = $("netStatus"); s.textContent = on ? "online" : "offline"; s.classList.toggle("online", on); }
function fmt(ms) { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

async function loadRemote() {
  if (!API_BASE) { $("netStatus").hidden = true; return; }
  const { remoteCatalog, remoteCatalogAt } = await store.get(["remoteCatalog", "remoteCatalogAt"]);
  if (remoteCatalog) remote = remoteCatalog;
  if (!remoteCatalogAt || Date.now() - remoteCatalogAt > CATALOG_REFRESH_MINUTES * 60000) {
    try { const res = await fetch(`${API_BASE}/catalog`); if (res.ok) { remote = await res.json(); await store.set({ remoteCatalog: remote, remoteCatalogAt: Date.now() }); setNet(true); } }
    catch { setNet(false); }
  } else setNet(true);
}

await loadRemote();
renderStore();
