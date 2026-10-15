import { API_BASE, CATALOG_REFRESH_MINUTES } from "./config.js";
import { flushScoreQueue, refreshLeaderboards } from "./shell/leaderboard.js";

const STORE_URL = chrome.runtime.getURL("store/store.html");

chrome.action.onClicked.addListener(async () => {
  const [existing] = await chrome.tabs.query({ url: STORE_URL + "*" });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: STORE_URL });
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const { playerId } = await chrome.storage.local.get("playerId");
  if (!playerId) {
    const id = crypto.randomUUID();
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
    await chrome.storage.local.set({ playerId: id, playerSecret: secret, installedAt: Date.now() });
  }
  chrome.alarms.create("sync", { periodInMinutes: CATALOG_REFRESH_MINUTES });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "sync" || !API_BASE) return;
  await flushScoreQueue(API_BASE);
  await refreshLeaderboards(API_BASE);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "flush-scores" && API_BASE) {
    flushScoreQueue(API_BASE).then(() => sendResponse({ ok: true }));
    return true;
  }
});
