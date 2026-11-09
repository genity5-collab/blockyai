// The AI's live screen, as the site shows it. Pure functions (no React, no network) so they can be tested directly.
// The server decides what the user may see; this only presents it. It never guesses: if the server says nothing, the panel says nothing.

export const POLL_MS = { live: 1500, idle: 4000, hidden: 6000, away: 15000 };

// What to draw, from the latest server answer + whether the page is visible + whether the AI is working.
//   waiting: the AI has not opened a page yet
//   live:    a picture is shown
//   private: the AI is on a page the user may not see (login, password, secret, private network). A black "fixing it" frame, with no picture and no title.
//   error:   the picture could not be loaded; shown as black, never as an old picture
export function screenState(r, { error = null } = {}) {
  if (error) return { kind: "error", text: "Can't reach the screen right now" };
  if (!r || typeof r !== "object" || r.none || !r.seq) return { kind: "waiting", text: "The AI has not opened a page yet" };
  if (r.shown === false) {
    const why = r.kind === "error" ? "The AI's browser hit a problem, so this view is paused. It is restarting it by itself." : "The AI is on a private page, so this view is hidden";
    return { kind: r.kind === "error" ? "error" : "private", text: why, activity: cleanActivity(r.activity), hiddenFor: r.kind === "error" ? null : String(r.why || "").slice(0, 80) };
  }
  if (!r.image && !r.unchanged) return { kind: "error", text: "The picture is not ready yet" };
  return { kind: "live", activity: cleanActivity(r.activity), title: String(r.title || "").slice(0, 120), host: String(r.host || "").slice(0, 80), width: +r.width || 1280, height: +r.height || 800, unchanged: !!r.unchanged };
}

// The activity line is text from the AI. Show it as plain text only, short, no markup.
export const cleanActivity = (a) => String(a ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);

// How often to ask again. Fast while the AI is working and the tab is open, slow when idle, very slow when the tab is hidden. Never faster than 1.5 s.
export function nextDelay({ working, visible, kind }) {
  if (!visible) return POLL_MS.away;
  if (kind === "private" || kind === "error") return POLL_MS.hidden;
  return working ? POLL_MS.live : POLL_MS.idle;
}

// A data: address for the picture. Only the two types the server stores are accepted, so a odd answer can never become something else.
export function frameSrc(r) {
  if (!r || typeof r.image !== "string" || !/^[A-Za-z0-9+/=]+$/.test(r.image) || r.image.length < 100) return null;
  const mime = r.mime === "image/png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${r.image}`;
}

// "5 s ago" for the footer. Never negative.
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 5 ? "just now" : s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : "over an hour ago";
}

// The percentage bar while the VM starts. Uses the server's own list of real steps (supabase/functions/_shared/bootstages.js), so the site and the server cannot disagree.
// `vm` is the session row: vm_status, vm_boot_stage, vm_boot_started_at. The bar never goes backwards (prevPct) and never shows 100 until the server says ready.
import { bootPercent, stageInfo, isStage } from "../../../supabase/functions/_shared/bootstages.js";
export function bootBar(vm, prevPct = 0, now = Date.now()) {
  if (!vm || typeof vm !== "object") return null;
  if (vm.vm_status === "running" && (vm.vm_boot_stage === "ready" || !vm.vm_boot_stage)) return { pct: 100, done: true, label: "Ready" };
  if (vm.vm_status !== "starting") return null;
  const stage = isStage(vm.vm_boot_stage) ? vm.vm_boot_stage : "queued";
  const t = Date.parse(vm.vm_boot_started_at);
  const inStage = Number.isFinite(t) ? Math.max(0, now - t) : 0;
  const raw = bootPercent(stage, inStage % 60000);
  const pct = Math.min(99, Math.max(Number(prevPct) || 0, raw));
  return { pct, done: false, label: stageInfo(stage).label, stage };
}

// What to tell the user when the AI's computer could not start. The server already wrote a plain message; this only picks the toast style
// and stops the "warming up" wording when the server says trying again will not help.
export function vmStartToast(r) {
  if (!r || !r.error) return null;
  const text = typeof r.error === "string" && r.error.length < 220 && !/[<>{}]/.test(r.error) ? r.error : "The AI computer could not start. Please try again in a minute.";
  if (r.retry === false || r.reason === "capacity") return { text, tone: "error", retry: false };
  return { text: r.reason ? text : "VM is warming up...", tone: "warn", retry: true };
}
