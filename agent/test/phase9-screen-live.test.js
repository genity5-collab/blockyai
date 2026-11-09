// The live screen, round 2. Real code, fake browser: what is proven is the AGENT's and SERVER's decisions (picture/text consistency, error frames,
// self-restart, the background stream, the visible note). The real browser is proven only by the bake self-check on the VM.
import test from "node:test"; import assert from "node:assert/strict";
import { TOOLS } from "../src/tools.js";            // must load first (same order as production)
import { SCREEN, vmBrowserOpen, vmScreenClick, vmScreenKey, vmScreenLook, stopStream } from "../src/tools-screen.js";
import { currentTurn, screenNote } from "../src/lifecycle.js";
import { frame } from "../../screen/screen.js";
import { planFrame, ERROR_NOTE } from "../../supabase/functions/_shared/screenflow.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 100;
function setup({ failFirst = null, noRestart = false } = {}) {
  const calls = [], sent = []; let broken = !!failFirst; let imageN = 0;
  const lib = {
    calls,
    openUrl: async ({ url }) => { calls.push("open"); if (broken) return { ok: false, error: failFirst }; return { ok: true, opening: url }; },
    click: async () => { calls.push("click"); if (broken) return { ok: false, error: failFirst }; return { ok: true, at: [1, 2] }; },
    pressKey: async ({ key }) => { calls.push("key"); return { ok: true, key }; },
    pageMap: async () => { calls.push("map"); if (broken) return { ok: false, error: failFirst }; return { ok: true, url: "https://create.roblox.com/docs", title: "Docs", text: "hello", items: [], total_chars: 5 }; },
    frame: async ({ activity }) => ({ ok: true, payload: { image: "IMG" + (lib.same ? 0 : ++imageN) + "A".repeat(200), url: "https://create.roblox.com/docs", title: "Docs", text: "x", has_password_field: false, typed: "", activity } }),
    same: false,
  };
  if (!noRestart) lib.restart = async () => { calls.push("restart"); broken = false; return { ok: true }; };
  SCREEN.lib = lib; SCREEN.settleMs = 0; SCREEN.healWaitMs = 0; SCREEN.streamMs = 0; SCREEN.recoveriesPerTurn = 2;
  SCREEN.send = async (p) => { sent.push(p); return p.status === "error" ? { ok: true, shown: false, why: p.why } : { ok: true, shown: true, seq: sent.length }; };
  currentTurn.messageId = "t" + (++n); stopStream();
  return { lib, calls, sent };
}

// ---- 1. the picture and the text that judges it must be from the same moment ----
const info = (o = {}) => ({ url: "https://a.com/", title: "A", text: "page text", has_password_field: false, ...o });
const shotOk = async () => ({ ok: true, base64: "B".repeat(3000) });
test("frame: when the page is the same before and after the capture, its text is sent with the picture", async () => {
  const f = await frame({ activity: "x" }, { pageInfo: async () => info(), shot: shotOk });
  assert.equal(f.ok, true); assert.equal(f.payload.text, "page text"); assert.equal(f.payload.url, "https://a.com/");
});
test("frame: if the page navigated or grew a password field WHILE the picture was taken, the frame is sent as unreadable (the server hides it)", async () => {
  let k = 0; const navigated = await frame({}, { pageInfo: async () => (k++ ? info({ url: "https://a.com/login" }) : info()), shot: shotOk });
  assert.equal(navigated.payload.url, undefined); assert.equal(navigated.payload.text, undefined);
  assert.equal(planFrame(navigated.payload, null, Date.now()).action, "hide", "unreadable -> hidden, never shown");
  k = 0; const pw = await frame({}, { pageInfo: async () => (k++ ? info({ has_password_field: true }) : info()), shot: shotOk });
  assert.equal(pw.payload.text, undefined);
  k = 0; const unread = await frame({}, { pageInfo: async () => (k++ ? { unreadable: true } : info()), shot: shotOk }); assert.equal(unread.payload.text, undefined);
  assert.equal((await frame({}, { pageInfo: async () => info(), shot: async () => ({ ok: false, error: "no display" }) })).ok, false);
});

// ---- 2. the server turns "my browser broke" into a black error frame, immediately ----
test("server: an error frame replaces the picture with a black 'error' frame, is never rate-limited, and carries no page text", () => {
  const prev = { updated_at: new Date().toISOString() };                            // a frame was stored a moment ago
  const p = planFrame({ status: "error", why: "the browser stopped", activity: "Fixing the browser" }, prev, Date.now());
  assert.equal(p.action, "hide"); assert.equal(p.row.shown, false); assert.equal(p.row.hidden_kind, "error"); assert.equal(p.row.storage_path, null); assert.equal(p.row.title, null);
  assert.equal(p.row.hidden_why, "the browser stopped"); assert.equal(p.row.activity, "Fixing the browser");
  const leak = planFrame({ status: "error", why: "token eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop.qrstuvwxyz0123", activity: "<b>x</b>" }, null, Date.now());
  assert.equal(leak.row.hidden_why, "the browser stopped", "a secret-shaped reason is never stored"); assert.doesNotMatch(leak.row.activity, /[<>]/);
  assert.match(ERROR_NOTE, /restarting the browser by itself/);
  assert.equal(planFrame({ status: "error" }, null, Date.now()).row.activity, "Fixing the browser");
});

// ---- 3. self-healing ----
test("heal: when the browser is gone, the user's view goes black FIRST, the browser restarts, and opening a page is retried on the fresh browser", async () => {
  const { calls, sent } = setup({ failFirst: "the page could not be read (is the browser open?)" });
  const r = await vmBrowserOpen({ url: "https://create.roblox.com/docs" });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.result.healed, true);
  assert.deepEqual(calls.slice(0, 3), ["open", "restart", "open"]);
  assert.equal(sent[0].status, "error", "the black frame is the very first thing sent"); assert.equal(sent[0].activity, "Fixing the browser");
});
test("heal: a click is NOT retried after a restart (the page is gone); the AI is told exactly what to do", async () => {
  const { calls } = setup({ failFirst: "the browser connection failed" });
  const r = await vmScreenClick({ x: 10, y: 10 });
  assert.equal(r.ok, false); assert.match(r.error, /restarted automatically/); assert.match(r.error, /vm_browser_open/);
  assert.deepEqual(calls, ["click", "restart"], "no second click on a blank page");
});
test("heal: wrong input is not a browser problem (no restart); no restart function means a plain error; the budget limits restarts per request", async () => {
  let s = setup(); const bad = await vmScreenKey({ key: "x" }); assert.equal(bad.ok, true);
  s = setup({ failFirst: "x and y must be numbers inside the 1280x800 screen" }); const r1 = await vmScreenClick({ x: "a", y: 1 }); assert.equal(r1.ok, false); assert.ok(!s.calls.includes("restart"));
  s = setup({ failFirst: "the page could not be read (is the browser open?)", noRestart: true }); const r2 = await vmScreenLook({}); assert.equal(r2.ok, false); assert.doesNotMatch(r2.error, /restarted/);
  s = setup({ failFirst: "no browser tab" }); s.lib.restart = async () => { s.calls.push("restart"); return { ok: true }; };      // restart "works" but the browser stays broken
  await vmScreenClick({ x: 1, y: 1 }); await vmScreenClick({ x: 1, y: 1 }); await vmScreenClick({ x: 1, y: 1 });
  assert.equal(s.calls.filter((c) => c === "restart").length, 2, "at most 2 automatic restarts per request");
});
test("heal: a failing restart is reported, not hidden", async () => {
  const s = setup({ failFirst: "the page could not be read (is the browser open?)" }); s.lib.restart = async () => ({ ok: false, error: "no display" });
  const r = await vmBrowserOpen({ url: "https://a.com" }); assert.equal(r.ok, false); assert.match(r.error, /automatic restart failed: no display/);
});

// ---- 4. the live stream ----
test("stream: while the screen is in use new frames are sent by themselves, identical ones are not repeated, and it stops after the idle time", async () => {
  const s = setup(); SCREEN.streamMs = 25; SCREEN.streamIdleMs = 400;
  await vmScreenKey({ key: "Down" }); const afterTool = s.sent.length;
  await wait(220); const streamed = s.sent.length - afterTool;
  assert.ok(streamed >= 3, "frames arrived with no tool call: " + streamed);
  s.lib.same = true; await wait(120); const a = s.sent.length; await wait(150); assert.ok(s.sent.length - a <= 1, "an unchanged screen is not sent again");
  await wait(600); const b = s.sent.length; await wait(200); assert.equal(s.sent.length, b, "after the idle time the stream stopped");
  SCREEN.streamMs = 0; stopStream();
});
test("stream: frames sent by the stream go through the SAME hidden/shown logic (a hidden answer is remembered and told to the AI)", async () => {
  const s = setup(); SCREEN.streamMs = 25; SCREEN.streamIdleMs = 400;
  SCREEN.send = async (p) => { s.sent.push(p); return { ok: true, shown: false, why: "a sign-in form" }; };
  await vmScreenKey({ key: "Down" }); await wait(100);
  const r = await vmScreenKey({ key: "Up" }); assert.equal(r.result.user_can_see, false); assert.match(r.result.warning, /BLACK/);
  SCREEN.streamMs = 0; stopStream();
});

// ---- 5. note-taking is visible ----
test("note: what the AI saves to memory shows once in the screen's activity line", async () => {
  const s = setup(); screenNote.text = "Noted (decision): shop prices live on the server";
  await vmScreenKey({ key: "Down" }); assert.match(s.sent.at(-1).activity, /^Noted \(decision\): shop prices/);
  await vmScreenKey({ key: "Up" }); assert.doesNotMatch(s.sent.at(-1).activity, /Noted/, "shown once, not forever");
});
