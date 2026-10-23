// $ARCADE token economy. Rules come from economy.json today; `load()` is the one place to swap in a
// server-side config later (fetch the same shape from the backend, fall back to the bundled file).
import * as store from "./storage.js";

let cfg = null;
export async function load() {
  if (cfg) return cfg;
  try { cfg = await (await fetch(new URL("../economy.json", import.meta.url))).json(); }
  catch { cfg = { currency: "$ARCADE", installGrant: 1000, perActiveMinute: 1, fullscreenMultiplier: 1.5, idleAfterSeconds: 10, daily: { minutes: 5, bonus: 10 }, rates: { default: 8 } }; }
  return cfg;
}
export const config = () => cfg;
export function rate(gameId) { return cfg?.rates?.[gameId] ?? cfg?.rates?.default ?? 8; }

// ---- balances ----
export async function balance() { return (await store.get("arcade")).arcade || 0; }
export async function adjust(delta, reason, meta = {}) {
  const { arcade = 0, arcadeHistory = [] } = await store.get(["arcade", "arcadeHistory"]);
  const next = Math.max(0, Math.round((arcade + delta) * 100) / 100);
  arcadeHistory.unshift({ ts: Date.now(), delta: Math.round(delta * 100) / 100, reason, ...meta });
  await store.set({ arcade: next, arcadeHistory: arcadeHistory.slice(0, 50) });
  return next;
}
export async function history() { return (await store.get("arcadeHistory")).arcadeHistory || []; }

// one-time install grant
export async function grantIfNew() {
  const { arcadeGranted } = await store.get("arcadeGranted");
  if (arcadeGranted) return false;
  await store.set({ arcadeGranted: true });
  await adjust(cfg.installGrant, "welcome");
  return true;
}

// ---- per-game credits ----
export async function gameCredits(gameId) { const { gameCredits = {} } = await store.get("gameCredits"); return gameCredits[gameId] || 0; }
export async function setGameCredits(gameId, n) { const { gameCredits = {} } = await store.get("gameCredits"); gameCredits[gameId] = Math.max(0, Math.round(n)); await store.set({ gameCredits }); }
export async function convert(gameId, tokens) {
  tokens = Math.floor(tokens); if (tokens <= 0) return null;
  const bal = await balance(); if (tokens > bal) return null;
  const credits = tokens * rate(gameId);
  await adjust(-tokens, "convert", { game: gameId, credits });
  await setGameCredits(gameId, (await gameCredits(gameId)) + credits);
  return { tokens, credits, balance: bal - tokens };
}

// ---- daily record ----
const today = () => new Date().toISOString().slice(0, 10);
export async function daily() { const { daily } = await store.get("daily"); return daily && daily.date === today() ? daily : { date: today(), seconds: 0, bonus: false }; }
export async function saveDaily(d) { await store.set({ daily: d }); }
