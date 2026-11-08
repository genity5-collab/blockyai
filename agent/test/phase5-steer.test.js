// "It barely listens": the user types again while the agent works. The agent must read it between steps, put it in front of the model as the
// NEWEST instruction, never run it twice, and never act on a message the token gate refused. Stubbed model and tools: this proves the wiring.
import test from "node:test"; import assert from "node:assert/strict";
import { makeRunWatcher } from "../src/context.js";
import { handleUserMessage, steerPrompt } from "../src/loop.js";

const ok = (result = {}) => ({ ok: true, result });
const T = (n, a = {}) => `<tool>${JSON.stringify({ name: n, args: a })}</tool>`;
const mkSay = (posted) => async (r, c, tc, st, em, outcome) => { posted.push({ c, st, outcome }); return { id: "m" }; };

test("watcher: a new user message is handed over exactly once and marked handled", async () => {
  const handled = new Set(); let t = 0; const calls = [];
  const w = makeRunWatcher({ fetchAfter: async (since) => { calls.push(since); return [{ id: "a", role: "user", content: "also add a pool" }]; }, since: "S", handled, now: () => (t += 5000) });
  const first = await w.takeFresh(); assert.deepEqual(first.map((m) => m.id), ["a"]); assert.ok(handled.has("a"));
  assert.deepEqual(await w.takeFresh(), [], "the same message is never handed over twice");
  assert.deepEqual(w.taken.map((m) => m.id), ["a"]); assert.equal(calls[0], "S");
});
test("watcher: blocked (out-of-tokens) messages, assistant messages and already-handled ones are ignored", async () => {
  const handled = new Set(["old"]); let t = 0;
  const w = makeRunWatcher({ fetchAfter: async () => [{ id: "old", role: "user", content: "x" }, { id: "b", role: "user", content: "no tokens", blocked: true }, { id: "c", role: "assistant", content: "hi" }], since: "S", handled, now: () => (t += 5000) });
  assert.deepEqual(await w.takeFresh(), []);
});
test("watcher: Stop is remembered; one query serves both checks; the query is throttled; a failing query changes nothing", async () => {
  let now = 0, n = 0, fail = false; const w = makeRunWatcher({ fetchAfter: async () => { n++; if (fail) throw new Error("net"); return n >= 2 ? [{ id: "s", role: "system", content: "__STOP__" }] : []; }, since: "S", handled: new Set(), now: () => now, minIntervalMs: 1500 });
  assert.equal(await w.shouldStop(), false); assert.equal(n, 1);
  now = 100; await w.takeFresh(); assert.equal(n, 1, "within the interval: no second query");
  now = 2000; fail = true; assert.equal(await w.shouldStop(), false, "a failed query is not a Stop"); fail = false;
  now = 4000; assert.equal(await w.shouldStop(), true); now = 99999; fail = true; assert.equal(await w.shouldStop(), true, "once stopped, stays stopped");
});

function harness(replies, tools, queue) {
  const seen = []; let i = 0; const posted = [];
  const llm = async (m) => { seen.push(m.map((x) => x.content)); return { content: replies[Math.min(i++, replies.length - 1)] }; };
  const pollNew = async () => queue.splice(0).map((text, k) => ({ id: "n" + k, text }));
  const run = () => handleUserMessage([], "build a yacht", { llm, tools, say: mkSay(posted), update: async () => {}, log: () => {}, logLlm: () => {}, pollNew, planApi: async (a) => (a === "get" ? { plan: null } : { ok: true, reasons: [] }) });
  return { seen, posted, run };
}
test("loop: a message typed while a tool runs reaches the model at its NEXT step, after the tool result, as the newest instruction", async () => {
  const queue = []; const tools = { vm_run_luau: { fn: async () => { queue.push("actually, build a HOUSE instead"); return ok({ exit_code: 0 }); } } };
  const h = harness([T("vm_run_luau", { source: "print(1)" }), "Switching to the house.", "done"], tools, queue); await h.run();
  const second = h.seen[1]; const last = second.at(-1);
  assert.match(last, /NEW MESSAGE FROM THE USER/); assert.match(last, /actually, build a HOUSE instead/); assert.match(last, /OVERRIDES the earlier request/);
  assert.match(second.at(-2), /Tool result for vm_run_luau/, "the real tool result comes first, then the new message");
  assert.equal(h.seen.flat().filter((c) => /NEW MESSAGE FROM THE USER/.test(c)).length, 1, "shown to the model once, not repeated on every later step");
});
test("loop: if the user types in the middle of a batch of calls, the remaining calls are NOT run and the model is told why", async () => {
  const queue = []; const ran = [];
  const mk = (n) => ({ fn: async () => { ran.push(n); if (n === "vm_run_luau") queue.push("stop that, do something else"); return ok({}); } });
  const tools = { vm_run_luau: mk("vm_run_luau"), vm_web_fetch: mk("vm_web_fetch"), vm_web_search: mk("vm_web_search") };
  const h = harness([T("vm_run_luau", { source: "x" }) + T("vm_web_fetch", { url: "https://a.com" }) + T("vm_web_search", { query: "q" }), "ok, new plan"], tools, queue); await h.run();
  assert.deepEqual(ran, ["vm_run_luau"], "calls 2 and 3 must not run against an outdated request");
  const msg = h.seen[1].at(-2); assert.match(msg, /SKIPPED: 2 remaining tool call\(s\)/); assert.match(h.seen[1].at(-1), /stop that, do something else/);
});
test("loop: with nothing new, no extra messages are added (no false steering)", async () => {
  const h = harness([T("vm_run_luau", { source: "x" }), "all done"], { vm_run_luau: { fn: async () => ok({ exit_code: 0 }) } }, []); await h.run();
  assert.equal(h.seen.flat().some((c) => /NEW MESSAGE FROM THE USER/.test(c)), false);
});
test("loop: a pollNew that throws never breaks the run", async () => {
  const posted = []; let i = 0;
  await handleUserMessage([], "hi", { llm: async () => ({ content: i++ ? "fine" : T("vm_run_luau", { source: "x" }) }), tools: { vm_run_luau: { fn: async () => ok({ exit_code: 0 }) } }, say: mkSay(posted), update: async () => {}, log: () => {}, logLlm: () => {}, pollNew: async () => { throw new Error("db down"); }, planApi: async (a) => (a === "get" ? { plan: null } : { ok: true, reasons: [] }) });
  assert.equal(posted.at(-1).outcome, "complete");
});
test("steerPrompt tells the model how to choose between changing the goal, adding a task, and just answering", () => {
  const p = steerPrompt(["one", "two"]); assert.match(p, /plan_create/); assert.match(p, /adds a task/); assert.match(p, /question or a comment/); assert.match(p, /<user_message>one<\/user_message>\n<user_message>two<\/user_message>/);
});
