// The logic of "may this frame be shown, and what do we store", with no database or network, so it can be tested completely.
import { checkImage, decodeBase64 } from "./mediacheck.js";
import { frameDecision, textRisk } from "./screenguard.js";

export const MIN_GAP_MS = 400;           // at most ~2.5 frames per second per session; faster frames are dropped, the previous one stays

export const hostOf = (u) => { try { return new URL(String(u)).hostname.replace(/^www\./, "").slice(0, 80); } catch { return null; } };

// body: what the VM sent. prev: the stored row (or null). now: ms. Returns what to do; the caller performs it.
//   {action:"reject", status, error}            bad request
//   {action:"skip"}                              a frame to SHOW arrived too soon after the last one: keep the old one (hides are never skipped)
//   {action:"hide", row}                         store a record with NO image: the user sees a black frame
//   {action:"show", row, bytes, mime, ext}       store the image and the record
export const ERROR_NOTE = "The AI's browser hit a problem, so this view is paused. It is restarting the browser by itself.";
export function planFrame(body, prev, now = Date.now()) {
  if (!body || typeof body !== "object") return { action: "reject", status: 400, error: "send JSON" };
  // The VM says its own screen broke (browser crashed, display gone) and it is fixing it. The stored picture is REPLACED by a black "error" frame, so an old
  // picture never stays up while the screen is dead. No page text is involved, so nothing can leak: only a short reason, screened like the activity line.
  if (body.status === "error") {
    const clean = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]+/g, " ").trim().slice(0, n) : "");
    const why = clean(body.why, 80) || "the browser stopped"; const act = clean(body.activity, 120);
    return { action: "hide", row: { shown: false, hidden_kind: "error", hidden_why: textRisk(why).risky ? "the browser stopped" : why, storage_path: null, width: null, height: null, title: null, host: null, activity: act && !textRisk(act).risky ? act : "Fixing the browser" } };
  }
  const unreadable = typeof body.text !== "string" || typeof body.url !== "string";
  const verdict = frameDecision({ unreadable, url: body.url, title: body.title, text: body.text, hasPasswordField: body.has_password_field === true, typed: typeof body.typed === "string" ? body.typed : "" });

  let activity = typeof body.activity === "string" ? body.activity.replace(/[\u0000-\u001f\u007f<>]+/g, " ").trim().slice(0, 120) : null;
  if (activity && textRisk(activity).risky) activity = null;

  if (!verdict.show) {
    return { action: "hide", row: { shown: false, hidden_kind: verdict.reason_kind === "unchecked" ? "unchecked" : "private", hidden_why: String(verdict.why ?? "").slice(0, 80), storage_path: null, width: null, height: null, title: null, host: null, activity } };
  }
  // Rate limit only frames that would be SHOWN. A hide is never skipped: if the AI lands on a private page, the stored picture must be replaced at once.
  if (prev?.updated_at) { const t = new Date(prev.updated_at).getTime(); if (Number.isFinite(t) && now - t >= 0 && now - t < MIN_GAP_MS) return { action: "skip" }; }
  const dec = decodeBase64(body.image); if (!dec.ok) return { action: "reject", status: 400, error: dec.error };
  const chk = checkImage(dec.bytes); if (!chk.ok) return { action: "reject", status: 400, error: chk.error };
  if (chk.mime !== "image/jpeg" && chk.mime !== "image/png") return { action: "reject", status: 400, error: "send a JPEG or PNG screenshot" };
  return { action: "show", bytes: dec.bytes, mime: chk.mime, ext: chk.ext, row: { shown: true, hidden_kind: null, hidden_why: null, width: chk.width, height: chk.height, title: String(body.title ?? "").replace(/[\u0000-\u001f\u007f<>]+/g, " ").slice(0, 120), host: hostOf(body.url), activity } };
}
