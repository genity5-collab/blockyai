export const cx = (...a) => a.filter(Boolean).join(" ");
export const ago = (iso) => { const s = Math.max(0, (Date.now() - new Date(iso)) / 1000); if (s < 5) return "now"; if (s < 60) return `${s | 0}s`; if (s < 3600) return `${(s / 60) | 0}m`; if (s < 86400) return `${(s / 3600) | 0}h`; return `${(s / 86400) | 0}d`; };
export const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour12: false });
export const fmtDur = (ms) => { const s = Math.floor(ms / 1000); const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, x = s % 60; return (h ? h + ":" : "") + String(m).padStart(h ? 2 : 1, "0") + ":" + String(x).padStart(2, "0"); };
export const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || localStorage.getItem("blocky_reduce") === "1";
export const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem("blocky_" + k)) ?? d; } catch { return d; } }, set: (k, v) => localStorage.setItem("blocky_" + k, JSON.stringify(v)) };
// Tiny UI blips (WebAudio). Off by default; opt-in in Settings.
let ctx; export function blip(kind) {
  if (!store.get("sound", false)) return;
  try { ctx ??= new AudioContext(); const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "square";
    o.frequency.value = kind === "fail" ? 140 : kind === "done" ? 740 : 520; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14); o.stop(ctx.currentTime + 0.15); } catch {}
}
export const CMD_META = {
  get_tree: ["Network", "Read tree"], find: ["Search", "Find"], set_properties: ["SlidersHorizontal", "Set properties"], create: ["Box", "Create"],
  delete: ["Trash2", "Delete"], move: ["Move", "Move"], read_script: ["FileCode", "Read script"], write_script: ["FilePen", "Write script"],
  patch_script: ["Wrench", "Patch script"], batch: ["Layers", "Batch"], playtest_start: ["Play", "Playtest"], playtest_stop: ["Square", "Stop"],
  get_playtest_logs: ["Terminal", "Read output"], screenshot: ["Camera", "Screenshot"], snapshot_save: ["Save", "Snapshot"], snapshot_restore: ["RotateCcw", "Restore"],
  get_selection: ["MousePointerClick", "Selection"], run_lua: ["Zap", "Run Lua"],
};
