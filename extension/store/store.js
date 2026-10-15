import { API_BASE, CATALOG_REFRESH_MINUTES } from "../config.js";
import { CATALOG } from "../games/catalog.js";
import { GameShell } from "../shell/GameShell.js";
import * as store from "../shell/storage.js";
import { fetchLeaderboard, submitScore, registerName } from "../shell/leaderboard.js";
import { THEMES, loadTheme, saveTheme, currentTheme } from "../shell/theme.js";

const $ = (id) => document.getElementById(id);
let remote = { games: {} };           // server metadata keyed by game id
let shell = null, attractShell = null, current = null, period = "all";
let identity = await store.getIdentity();
await loadTheme();
let difficulty = (await store.getSync("difficulty")).difficulty || "intermediate";
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

  const genres = ["All", ...new Set(CATALOG.map(g => g.genre))];
  const filters = $("filters"); filters.innerHTML = "";
  let active = "All";
  for (const genre of genres) {
    const b = document.createElement("button"); b.textContent = genre; if (genre === active) b.classList.add("on");
    b.onclick = () => { active = genre; [...filters.children].forEach(x => x.classList.toggle("on", x === b)); list(active); };
    filters.appendChild(b);
  }
  list(active);

  async function list(genre) {
    const ul = $("games"); ul.innerHTML = "";
    const { bests = {} } = await store.get("bests");
    let i = 0;
    for (const g of CATALOG.filter(g => genre === "All" || g.genre === genre)) {
      const li = document.createElement("li");
      li.className = "game" + (g.status === "soon" ? " soon" : ""); li.dataset.genre = g.genre;
      const world = remote.games[g.id]?.top;
      li.style.setProperty("--d", `${0.3 + i * 0.06}s`); li.classList.add("reveal"); i++;
      li.innerHTML = `<div class="icon">${ICONS[g.id] || ICONS.default}</div><div class="inner">
        <h3>${g.title}</h3><p>${g.tagline}</p>
        <div class="row"><span>Your best <b>${bests[g.id]?.score?.toLocaleString() ?? "–"}</b>${API_BASE ? ` · World <b>${world ? world.score.toLocaleString() + " " + esc(world.name) : "–"}</b>` : ""}</span>
        <button>${g.status === "soon" ? "Coming soon" : "Play"}</button></div></div>`;
      if (g.status === "ready") li.querySelector("button").onclick = () => play(g);
      tilt(li, 6);
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
  current = game;
  syncDifficultyUI();
  $("storeView").hidden = true; $("playView").hidden = false;
  $("playTitle").textContent = game.title; $("playControls").textContent = game.controls || "";
  loadBoard();
  const mod = await game.load();
  shell?.destroy();
  shell = new GameShell({
    canvas: $("game"), game: mod.default({ difficulty }),
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
