// Themes drive both the store (CSS variables) and the game canvases (shell.theme).
import * as store from "./storage.js";

export const THEMES = {
  aurora: {
    name: "Aurora", blurb: "Deep teal night with pink and mint light",
    bg: "#07111F", bgGlow1: "#1D3F6E", bgGlow2: "#3A1A5C", surface: "#0F1F33", surface2: "#183048", surface3: "#234461",
    text: "#F2F7FF", textDim: "#9DB4CC", marquee: "#FFCF4A", accent: "#FF5CA8", cyan: "#2CE6D6",
    board1: "#0C1A2B", board2: "#0F2034", pipe: "#5B7FA6", pipeDark: "#3E5A7A", rock: "#2C4660", hint: "#FFCF4A",
    fluids: { water: "#2CE6D6", oil: "#FFB454", gas: "#B6FF5C" },
  },
  midnight: {
    name: "Midnight", blurb: "Indigo cabinet, yellow marquee",
    bg: "#1B1540", bgGlow1: "#2A2260", bgGlow2: "#1B1540", surface: "#2A2260", surface2: "#3A3078", surface3: "#4A3F98",
    text: "#F4EFE6", textDim: "#B9B3C9", marquee: "#FFD447", accent: "#FF5C8A", cyan: "#4DE1F0",
    board1: "#1F184B", board2: "#221B52", pipe: "#5A4F9A", pipeDark: "#3A3078", rock: "#3A3078", hint: "#FFD447",
    fluids: { water: "#4DE1F0", oil: "#FFB454", gas: "#B6FF5C" },
  },
  sunset: {
    name: "Sunset", blurb: "Warm light theme for daytime play",
    bg: "#FFF4E6", bgGlow1: "#FFD9B0", bgGlow2: "#FFE9D6", surface: "#FFE4C7", surface2: "#FFD2A3", surface3: "#F4B97C",
    text: "#2B1B12", textDim: "#7A5A48", marquee: "#F77F00", accent: "#E63946", cyan: "#0096C7",
    board1: "#FBE6CF", board2: "#F7DCBF", pipe: "#8D6E63", pipeDark: "#5D4037", rock: "#B08968", hint: "#D62828",
    fluids: { water: "#0096C7", oil: "#B5651D", gas: "#2A9D8F" },
  },
  terminal: {
    name: "Terminal", blurb: "Green phosphor, amber highlights",
    bg: "#050A05", bgGlow1: "#0E2A0E", bgGlow2: "#050A05", surface: "#0B160B", surface2: "#132613", surface3: "#1E3A1E",
    text: "#C8FFC8", textDim: "#6FA86F", marquee: "#7CFF5F", accent: "#FFB000", cyan: "#59FFD1",
    board1: "#081108", board2: "#0A150A", pipe: "#2F6B2F", pipeDark: "#1E4A1E", rock: "#244024", hint: "#FFB000",
    fluids: { water: "#59FFD1", oil: "#FFB000", gas: "#F1FF5C" },
  },
};
export const DEFAULT_THEME = "aurora";
let current = THEMES[DEFAULT_THEME];
export function currentTheme() { return current; }

export function applyTheme(id) {
  const t = THEMES[id] || THEMES[DEFAULT_THEME];
  current = t;
  if (typeof document === "undefined") return t;
  const root = document.documentElement;
  root.dataset.theme = id;
  const map = { bg: "--bg", bgGlow1: "--bg-glow-1", bgGlow2: "--bg-glow-2", surface: "--surface", surface2: "--surface-2", surface3: "--surface-3", text: "--text", textDim: "--text-dim", marquee: "--marquee", accent: "--accent", cyan: "--cyan" };
  for (const [k, v] of Object.entries(map)) root.style.setProperty(v, t[k]);
  root.style.colorScheme = id === "sunset" ? "light" : "dark";
  return t;
}
export async function loadTheme() {
  const { theme } = await store.getSync("theme");
  return applyTheme(theme || DEFAULT_THEME);
}
export async function saveTheme(id) { await store.setSync({ theme: id }); return applyTheme(id); }
