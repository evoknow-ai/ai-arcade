// Thin promise wrappers over chrome.storage with a localStorage fallback for dev-in-browser.
const hasChrome = typeof chrome !== "undefined" && chrome.storage;

export async function get(keys) {
  if (hasChrome) return chrome.storage.local.get(keys);
  const out = {};
  for (const k of [].concat(keys)) {
    const v = localStorage.getItem("arcade:" + k);
    if (v !== null) out[k] = JSON.parse(v);
  }
  return out;
}

export async function set(obj) {
  if (hasChrome) return chrome.storage.local.set(obj);
  for (const [k, v] of Object.entries(obj)) localStorage.setItem("arcade:" + k, JSON.stringify(v));
}

export async function getSync(keys) {
  if (hasChrome) return chrome.storage.sync.get(keys);
  return get(keys);
}

export async function setSync(obj) {
  if (hasChrome) return chrome.storage.sync.set(obj);
  return set(obj);
}

export async function getIdentity() {
  let { playerId, playerSecret } = await get(["playerId", "playerSecret"]);
  if (!playerId) { // dev-in-browser or first run before background ran
    playerId = crypto.randomUUID();
    playerSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
    await set({ playerId, playerSecret });
  }
  const { displayName } = await getSync("displayName");
  return { playerId, playerSecret, displayName: displayName || "" };
}

export async function localBest(gameId) {
  const { bests = {} } = await get("bests");
  return bests[gameId] || null;
}

export async function recordLocalBest(gameId, entry) {
  const { bests = {} } = await get("bests");
  if (!bests[gameId] || entry.score > bests[gameId].score) {
    bests[gameId] = entry;
    await set({ bests });
    return true;
  }
  return false;
}

// Local leaderboard: every finished run, best 100 per game.
export async function addLocalScore(gameId, entry) {
  const { history = {} } = await get("history");
  const list = history[gameId] || [];
  list.push(entry);
  list.sort((a, b) => b.score - a.score || a.ts - b.ts);
  history[gameId] = list.slice(0, 100);
  await set({ history });
}
export async function localScores(gameId, period = "all") {
  const { history = {} } = await get("history");
  const since = period === "daily" ? Date.now() - 864e5 : period === "weekly" ? Date.now() - 7 * 864e5 : 0;
  return (history[gameId] || []).filter(e => e.ts >= since);
}
