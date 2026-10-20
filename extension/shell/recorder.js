// Gameplay recording. Captures the canvas (plus the synthesized game audio) with MediaRecorder.
// Chrome can often record MP4 (H.264) directly; otherwise we record WebM and, when the bundled
// ffmpeg.wasm core is present under /vendor/ffmpeg-core/, transcode to MP4 in a worker.
export class Recorder {
  constructor() { this.rec = null; this.chunks = []; this.mime = ""; this.startedAt = 0; this.onProgress = () => {}; }
  get active() { return !!this.rec && this.rec.state === "recording"; }
  start(canvas, audioStream, fps = 60) {
    const stream = canvas.captureStream(fps);
    if (audioStream) for (const t of audioStream.getAudioTracks()) stream.addTrack(t);
    const candidates = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    this.mime = candidates.find(m => MediaRecorder.isTypeSupported(m)) || "";
    this.chunks = []; this.rec = new MediaRecorder(stream, { mimeType: this.mime || undefined, videoBitsPerSecond: 6_000_000 });
    this.rec.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
    this.rec.start(500); this.startedAt = Date.now();
  }
  stop() {
    return new Promise((resolve) => {
      if (!this.rec) return resolve(null);
      const rec = this.rec; this.rec = null;
      rec.onstop = () => { const blob = new Blob(this.chunks, { type: this.mime || "video/webm" }); resolve({ blob, mime: this.mime, seconds: (Date.now() - this.startedAt) / 1000 }); };
      rec.stop();
    });
  }
  // Convert a WebM blob to MP4 with the bundled ffmpeg.wasm. Resolves null if the core isn't installed.
  async toMp4(blob, onProgress = () => {}) {
    try {
      const coreURL = new URL("../vendor/ffmpeg-core/ffmpeg-core.js", import.meta.url).href;
      const head = await fetch(coreURL, { method: "HEAD" }).catch(() => null); if (!head?.ok) return null;
      const { FFmpeg } = await import("../vendor/ffmpeg/index.js");
      const ff = new FFmpeg();
      ff.on("progress", ({ progress }) => onProgress(Math.max(0, Math.min(1, progress))));
      await ff.load({ coreURL, wasmURL: new URL("../vendor/ffmpeg-core/ffmpeg-core.wasm", import.meta.url).href, classWorkerURL: new URL("../vendor/ffmpeg/worker.js", import.meta.url).href });
      await ff.writeFile("in.webm", new Uint8Array(await blob.arrayBuffer()));
      await ff.exec(["-i", "in.webm", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "out.mp4"]);
      const data = await ff.readFile("out.mp4"); ff.terminate();
      return new Blob([data.buffer], { type: "video/mp4" });
    } catch (e) { console.warn("mp4 transcode failed", e); return null; }
  }
}
export function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
