// Optional sprite packs. A game asks for a pack by name; if /sprites/<pack>/manifest.json exists the
// listed PNGs are loaded and the game draws them (rotating as needed). If the pack is missing the
// loader resolves to null and the game keeps its vector fallback, so the extension never breaks.
//
// manifest.json: { "scale": 1, "sprites": { "name": { "file": "x.png", "w": 64, "h": 64, "anchor": [0.5, 0.5], "frames": 1 } } }
const cache = new Map();
export async function loadPack(name) {
  if (cache.has(name)) return cache.get(name);
  const p = (async () => {
    try {
      if (typeof document === "undefined") return null;
      const base = new URL(`../sprites/${name}/`, import.meta.url);
      const res = await fetch(new URL("manifest.json", base)); if (!res.ok) return null;
      const man = await res.json(); const out = { scale: man.scale || 1, sprites: {} };
      await Promise.all(Object.entries(man.sprites).map(async ([k, s]) => {
        const img = new Image(); img.src = new URL(s.file, base).href;
        await new Promise((ok, no) => { img.onload = ok; img.onerror = no; }).catch(() => null);
        if (img.complete && img.naturalWidth) out.sprites[k] = { img, w: s.w || img.naturalWidth, h: s.h || img.naturalHeight, ax: s.anchor?.[0] ?? 0.5, ay: s.anchor?.[1] ?? 0.5, frames: s.frames || 1 };
      }));
      return Object.keys(out.sprites).length ? out : null;
    } catch { return null; }
  })();
  cache.set(name, p); return p;
}
// draw sprite `k` centred on (x,y) with rotation and uniform scale; frame index for sheets laid out horizontally
export function draw(c, pack, k, x, y, { rot = 0, scale = 1, frame = 0, alpha = 1 } = {}) {
  const s = pack?.sprites?.[k]; if (!s) return false;
  const fw = s.w / s.frames;
  c.save(); c.translate(x, y); c.rotate(rot); c.scale(scale * pack.scale, scale * pack.scale); c.globalAlpha *= alpha;
  c.drawImage(s.img, (frame % s.frames) * fw, 0, fw, s.h, -fw * s.ax, -s.h * s.ay, fw, s.h);
  c.restore(); return true;
}
