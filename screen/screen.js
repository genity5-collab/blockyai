// The AI's own computer screen, on the VM. A virtual display (Xvfb), a window manager (Openbox) and Google Chrome that the AI drives with a real
// mouse and keyboard (xdotool) and reads through the browser's own debugging channel (CDP, bound to 127.0.0.1 only, never published).
// Every picture the user could see is first paired with what the page really says, and sent to the server, which decides whether it may be shown.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

export const DISPLAY = ":0", W = 1280, H = 800, CDP = "http://127.0.0.1:9222";
const ENVV = { ...process.env, DISPLAY };

// Runs a program with NO shell, so nothing the AI types can become a command. Resolves {ok, stdout, stderr, code}.
export const run = (file, args, { timeout = 15000, input } = {}) => new Promise((resolve) => {
  const p = execFile(file, args, { env: ENVV, timeout, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code: err?.code ?? 0 }));
  if (input != null) p.stdin.end(input);
});

// ---- input validation: every value that reaches xdotool is checked first ----
const KEY_OK = /^(?:(?:ctrl|alt|shift|Control|Alt|Shift)\+)*(?:[A-Za-z0-9]|F(?:[1-9]|1[0-2])|Return|Enter|Tab|Escape|Esc|BackSpace|Delete|space|Up|Down|Left|Right|Home|End|Page_Up|Page_Down|plus|minus|period|comma|slash)$/;
export const cleanKey = (k) => {
  const s = typeof k === "string" ? k.trim() : ""; if (!KEY_OK.test(s)) return null;
  const parts = s.split("+"), mods = parts.slice(0, -1).map((m) => m.toLowerCase().replace("control", "ctrl"));
  if (mods.length > 2 || new Set(mods).size !== mods.length) return null;                 // at most two different modifiers
  if (mods.includes("ctrl") && mods.includes("alt")) return null;                         // ctrl+alt+anything: reserved for the system (Delete, F1..F12, BackSpace)
  return [...mods, parts.at(-1).replace(/^Enter$/, "Return").replace(/^Esc$/, "Escape")].join("+");
};
export const clampXY = (x, y) => (Number.isFinite(+x) && Number.isFinite(+y) ? [Math.min(W - 1, Math.max(0, Math.round(+x))), Math.min(H - 1, Math.max(0, Math.round(+y)))] : null);

export async function click({ x, y, button = 1, double = false } = {}) {
  const xy = clampXY(x, y); if (!xy) return { ok: false, error: "x and y must be numbers inside the 1280x800 screen" };
  const b = [1, 2, 3].includes(+button) ? String(+button) : "1";
  const m = await run("xdotool", ["mousemove", String(xy[0]), String(xy[1])]); if (!m.ok) return { ok: false, error: "mouse move failed: " + m.stderr.slice(0, 120) };
  const c = await run("xdotool", ["click", ...(double ? ["--repeat", "2", "--delay", "80"] : []), b]); return c.ok ? { ok: true, at: xy } : { ok: false, error: "click failed: " + c.stderr.slice(0, 120) };
}
export async function typeText({ text } = {}) {
  const t = String(text ?? ""); if (!t) return { ok: false, error: "text is empty" }; if (t.length > 2000) return { ok: false, error: "type at most 2000 characters at a time" };
  const r = await run("xdotool", ["type", "--delay", "12", "--clearmodifiers", "--", t], { timeout: 30000 }); return r.ok ? { ok: true, typed: t.length } : { ok: false, error: "typing failed: " + r.stderr.slice(0, 120) };
}
export async function pressKey({ key } = {}) {
  const k = cleanKey(key); if (!k) return { ok: false, error: "unknown key. Use e.g. Return, Tab, Escape, ctrl+l, ctrl+a, Page_Down, F5" };
  const r = await run("xdotool", ["key", "--clearmodifiers", k]); return r.ok ? { ok: true, key: k } : { ok: false, error: "key failed: " + r.stderr.slice(0, 120) };
}
export async function scroll({ direction = "down", amount = 5 } = {}) {
  const n = Math.min(Math.max(Math.round(+amount) || 5, 1), 30), btn = direction === "up" ? "4" : direction === "down" ? "5" : null; if (!btn) return { ok: false, error: "direction is up or down" };
  const r = await run("xdotool", ["click", "--repeat", String(n), "--delay", "30", btn]); return r.ok ? { ok: true } : { ok: false, error: "scroll failed" };
}

// ---- the browser, through CDP (local only) ----
async function cdpTab() {
  const r = await fetch(CDP + "/json/list", { signal: AbortSignal.timeout(3000) }); const tabs = await r.json();
  return tabs.find((t) => t.type === "page") ?? null;
}
// Evaluates one expression in the page. ws is opened per call: simple and robust.
export async function cdpEval(expression, { timeout = 5000 } = {}) {
  const tab = await cdpTab(); if (!tab) throw new Error("no browser tab");
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(tab.webSocketDebuggerUrl); const t = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("page did not answer")); }, timeout);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: false } }));
    ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id === 1) { clearTimeout(t); try { ws.close(); } catch {} j.result?.exceptionDetails ? reject(new Error("page script error")) : resolve(j.result?.result?.value); } };
    ws.onerror = () => { clearTimeout(t); reject(new Error("browser connection failed")); };
  });
}
// What the page really says right now, for the privacy check. Returns {url,title,text,has_password_field} or {unreadable:true}.
export async function pageInfo() {
  try {
    const tab = await cdpTab(); if (!tab) return { unreadable: true };
    const v = await cdpEval(`(()=>{const t=(document.body&&document.body.innerText)||'';return {text:t.slice(0,60000),pw:!!document.querySelector('input[type=password]'),
      forms:[...document.querySelectorAll('input')].some(i=>/pass|secret|token|otp|cvv|card|ssn/i.test((i.name||'')+(i.id||'')+(i.autocomplete||'')+(i.placeholder||''))),url:location.href,title:document.title}})()`);
    if (!v || typeof v.text !== "string") return { unreadable: true };
    return { url: v.url, title: v.title, text: v.text, has_password_field: !!(v.pw || v.forms) };
  } catch { return { unreadable: true }; }
}
export async function openUrl({ url } = {}) {
  let u; try { u = new URL(String(url ?? "")); } catch { return { ok: false, error: "that is not a web address" }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "only http and https addresses can be opened" };
  const k = await run("xdotool", ["key", "--clearmodifiers", "ctrl+l"]); if (!k.ok) return { ok: false, error: "could not focus the address bar" };
  const t = await typeText({ text: u.href }); if (!t.ok) return t; const e = await pressKey({ key: "Return" }); return e.ok ? { ok: true, opening: u.href } : e;
}

// ---- a picture of the screen ----
export async function shot({ quality = 60 } = {}) {
  const q = Math.min(Math.max(Math.round(+quality) || 60, 20), 90), path = `/tmp/screen-${process.pid}.jpg`;
  const r = await run("import", ["-window", "root", "-quality", String(q), path]); if (!r.ok) return { ok: false, error: "could not capture the screen: " + r.stderr.slice(0, 120) };
  const buf = await readFile(path); if (buf.length < 2000) return { ok: false, error: "the screen capture came out empty" };
  return { ok: true, bytes: buf, base64: buf.toString("base64") };
}
// Picture + what the page says, taken together, in one go. This pair is exactly what the server needs.
export async function frame({ typed = "", activity = "" } = {}) {
  const info = await pageInfo(); const s = await shot();
  if (!s.ok) return { ok: false, error: s.error };
  return { ok: true, payload: { image: s.base64, url: info.url, title: info.title, text: info.text, has_password_field: info.has_password_field, typed, activity, ...(info.unreadable ? { url: undefined, text: undefined } : {}) } };
}
