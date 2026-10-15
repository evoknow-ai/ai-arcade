import * as store from "./storage.js";

async function hmac(secret, body) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, "0")).join("");
}

// Queue a score locally; the background worker flushes it to the server.
export async function submitScore(apiBase, { gameId, score, level, durationMs, log }) {
  const { playerId, playerSecret, displayName } = await store.getIdentity();
  // secret rides along in the body so the server can register this install on first contact (TOFU)
  const entry = { gameId, score, level, durationMs, log, playerId, secret: playerSecret, name: displayName || "Player", ts: Date.now() };
  const { scoreQueue = [] } = await store.get("scoreQueue");
  scoreQueue.push(entry);
  await store.set({ scoreQueue });
  await flushScoreQueue(apiBase);
}

export async function flushScoreQueue(apiBase) {
  const { scoreQueue = [] } = await store.get("scoreQueue");
  if (!scoreQueue.length) return;
  const { playerId, playerSecret } = await store.getIdentity();
  const remaining = [];
  for (const entry of scoreQueue) {
    try {
      const body = JSON.stringify(entry);
      const res = await fetch(`${apiBase}/scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Player": playerId, "X-Signature": await hmac(playerSecret, body) },
        body,
      });
      if (res.status >= 500) remaining.push(entry); // retry later; 4xx is rejected for good
    } catch {
      remaining.push(entry);
    }
  }
  await store.set({ scoreQueue: remaining });
}

export async function fetchLeaderboard(apiBase, gameId, period = "all") {
  const res = await fetch(`${apiBase}/leaderboard/${encodeURIComponent(gameId)}?period=${period}`);
  if (!res.ok) throw new Error(`leaderboard ${res.status}`);
  return res.json();
}

export async function refreshLeaderboards(apiBase) {
  try {
    const res = await fetch(`${apiBase}/catalog`);
    if (!res.ok) return;
    const data = await res.json();
    await store.set({ remoteCatalog: data, remoteCatalogAt: Date.now() });
  } catch { /* offline is fine */ }
}

export async function registerName(apiBase, name) {
  const { playerId, playerSecret } = await store.getIdentity();
  const body = JSON.stringify({ playerId, name, secret: playerSecret });
  await fetch(`${apiBase}/players`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Player": playerId, "X-Signature": await hmac(playerSecret, body) },
    body,
  }).catch(() => {});
}
