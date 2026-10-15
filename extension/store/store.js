import { API_BASE, CATALOG_REFRESH_MINUTES } from "../config.js";
import { CATALOG } from "../games/catalog.js";
import { GameShell } from "../shell/GameShell.js";
import * as store from "../shell/storage.js";
import { fetchLeaderboard, submitScore, registerName } from "../shell/leaderboard.js";

const $ = (id) => document.getElementById(id);
let remote = { games: {} };           // server metadata keyed by game id
let shell = null, attractShell = null, current = null, period = "all";
let identity = await store.getIdentity();

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
    for (const g of CATALOG.filter(g => genre === "All" || g.genre === genre)) {
      const li = document.createElement("li");
      li.className = "game" + (g.status === "soon" ? " soon" : ""); li.dataset.genre = g.genre;
      const world = remote.games[g.id]?.top;
      li.innerHTML = `<div class="strip"></div><div class="inner">
        <h3>${g.title}</h3><p>${g.tagline}</p>
        <div class="row"><span>Your best <b>${bests[g.id]?.score?.toLocaleString() ?? "–"}</b>${API_BASE ? ` · World <b>${world ? world.score.toLocaleString() + " " + esc(world.name) : "–"}</b>` : ""}</span>
        <button>${g.status === "soon" ? "Coming soon" : "Play"}</button></div></div>`;
      if (g.status === "ready") li.querySelector("button").onclick = () => play(g);
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
  $("storeView").hidden = true; $("playView").hidden = false;
  $("playTitle").textContent = game.title; $("playControls").textContent = game.controls || "";
  loadBoard();
  const mod = await game.load();
  shell?.destroy();
  shell = new GameShell({
    canvas: $("game"), game: mod.default(),
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
    await store.addLocalScore(current.id, { name: identity.displayName || "Player", score: result.score, level: result.level, ts: Date.now(), playerId: identity.playerId });
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
      li.innerHTML = `<span class="n">${esc(r.name)} <small>L${r.level}</small></span><span class="s">${r.score.toLocaleString()}</span>`;
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
