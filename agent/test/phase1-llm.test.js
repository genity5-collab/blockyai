// PHASE 1 item 2. MOCK for the loop; the response shape in the fixture was captured from a REAL Free.ai call (see commit message).
import test from "node:test"; import assert from "node:assert/strict";
import { shapeCompletion, clampMaxTokens, HARD_MAX_TOKENS, DEFAULT_MAX_TOKENS } from "../../supabase/functions/_shared/llmshape.js";
import { handleUserMessage } from "../src/loop.js";

const REAL_STOP = { choices: [{ finish_reason: "stop", message: { content: "1 2 3" } }], usage: { prompt_tokens: 1625, completion_tokens: 111, total_tokens: 1736 }, free_ai_usage: { tokens_charged: 1736, source: "self_hosted", model: "qwen-coder" } };
const REAL_LEN = { choices: [{ finish_reason: "length", message: { content: "1 2 3" } }], usage: { prompt_tokens: 1625, completion_tokens: 5, total_tokens: 1630 }, free_ai_usage: { tokens_charged: 1630, source: "self_hosted", model: "qwen-coder" } };
test("[mock] shapeCompletion exposes finish_reason, truncated and usage from a real response shape", () => {
  const a = shapeCompletion(REAL_STOP); assert.equal(a.finish_reason, "stop"); assert.equal(a.truncated, false); assert.equal(a.usage.prompt_tokens, 1625); assert.equal(a.usage.completion_tokens, 111); assert.equal(a.source, "self_hosted");
  const b = shapeCompletion(REAL_LEN); assert.equal(b.finish_reason, "length"); assert.equal(b.truncated, true);
});
test("[mock] shapeCompletion never throws on junk and reports finish_reason 'unknown'", () => {
  for (const j of [null, {}, { choices: [] }, { choices: [{}] }, "x", 5]) { const s = shapeCompletion(j); assert.equal(s.finish_reason, "unknown"); assert.equal(s.truncated, false); assert.equal(s.content, ""); }
});
test("[mock] max_tokens: configurable, clamped to a hard ceiling, default when invalid", () => {
  assert.equal(clampMaxTokens(8000), 8000); assert.equal(clampMaxTokens(999999), HARD_MAX_TOKENS); assert.equal(clampMaxTokens(undefined), DEFAULT_MAX_TOKENS); assert.equal(clampMaxTokens(-5), DEFAULT_MAX_TOKENS); assert.equal(clampMaxTokens("abc"), DEFAULT_MAX_TOKENS);
});
const said = []; const API = { say: async (r, c, cards, st) => (said.push({ c, st }), { id: "m" }), update: async () => ({}), log: () => {} };
test("[mock] a reply cut off by the length limit is NOT treated as a finished answer; the model is told and can split the work", async () => {
  said.length = 0; const seen = []; let i = 0;
  const replies = [{ content: 'Writing.\n<tool name="roblox_write_script" path="A.B"><source>\nlocal x = 1\nlocal y = ', finish_reason: "length" }, { content: "All done.", finish_reason: "stop" }];
  await handleUserMessage([], "build", { llm: async (m) => { seen.push(m.map((x) => x.content).join("\n")); return replies[Math.min(i++, 1)]; }, tools: { roblox_write_script: { args: "", fn: async () => ({ ok: true, result: "WROTE" }) } }, ...API, shouldStop: async () => false });
  assert.match(seen[1], /cut off|truncat|length limit/i, "the model must be told its output was cut off");
  assert.match(seen[1], /split|smaller|raw-body|<source>/i, "and told how to recover");
  assert.ok(!seen[1].includes("WROTE"), "the half-written script must NOT have been executed");
});
test("[mock] a truncated reply that contains a COMPLETE call still runs nothing from the cut-off tail", async () => {
  said.length = 0; let ran = 0; let i = 0;
  const replies = [{ content: '<tool>{"name":"a","args":{}}</tool>\n<tool>{"name":"b","args":{"x":"unfin', finish_reason: "length" }, { content: "ok", finish_reason: "stop" }];
  await handleUserMessage([], "go", { llm: async () => replies[Math.min(i++, 1)], tools: { a: { args: "", fn: async () => (ran++, { ok: true, result: 1 }) }, b: { args: "", fn: async () => (ran += 100, { ok: true, result: 1 }) } }, ...API, shouldStop: async () => false });
  assert.equal(ran, 1, "the complete first call may run; the cut-off second call must not");
});
test("[mock] finish_reason and token usage are passed to the audit log", async () => {
  const logged = []; let i = 0;
  await handleUserMessage([], "go", { llm: async () => [{ content: '<tool>{"name":"a","args":{}}</tool>', finish_reason: "stop", usage: { prompt_tokens: 10, completion_tokens: 5 } }, { content: "bye", finish_reason: "stop", usage: { prompt_tokens: 12, completion_tokens: 3 } }][Math.min(i++, 1)], tools: { a: { args: "", fn: async () => ({ ok: true, result: 1 }) } }, ...API, log: (r) => logged.push(r), logLlm: (r) => logged.push({ llm: true, ...r }), shouldStop: async () => false });
  const l = logged.filter((x) => x.llm); assert.equal(l.length, 2); assert.equal(l[0].finish_reason, "stop"); assert.equal(l[0].prompt_tokens, 10); assert.equal(l[1].completion_tokens, 3);
});

test("[mock] when the reply was cut off, the LAST call is dropped even if it parses (the cut may be inside it)", async () => {
  let ran = []; let i = 0;
  // the second call is balanced JSON, but the reply hit the length limit right after it, so we cannot know it was complete
  const replies = [{ content: '<tool>{"name":"a","args":{}}</tool>\n<tool>{"name":"b","args":{"path":"Workspace.Short"}}</tool>', finish_reason: "length" }, { content: "ok", finish_reason: "stop" }];
  await handleUserMessage([], "go", { llm: async () => replies[Math.min(i++, 1)], tools: { a: { args: "", fn: async () => (ran.push("a"), { ok: true, result: 1 }) }, b: { args: "", fn: async () => (ran.push("b"), { ok: true, result: 1 }) } }, ...API, shouldStop: async () => false });
  assert.deepEqual(ran, ["a"], "only calls that are followed by more text/another call are known to be complete");
});
test("[mock] a call that ends the reply but was properly closed AND finish_reason is 'stop' is run normally", async () => {
  let ran = []; let i = 0;
  await handleUserMessage([], "go", { llm: async () => [{ content: '<tool>{"name":"a","args":{}}</tool>', finish_reason: "stop" }, { content: "ok", finish_reason: "stop" }][Math.min(i++, 1)], tools: { a: { args: "", fn: async () => (ran.push("a"), { ok: true, result: 1 }) } }, ...API, shouldStop: async () => false });
  assert.deepEqual(ran, ["a"]);
});
test("[mock] 3 truncations in a row that produce nothing runnable end as INCOMPLETE", async () => {
  said.length = 0; let i = 0;
  await handleUserMessage([], "go", { llm: async () => (i++, { content: '<tool name="roblox_write_script" path="A"><source>\nlocal a =', finish_reason: "length" }), tools: {}, ...API, shouldStop: async () => false });
  assert.equal(i, 3); assert.equal(said[said.length - 1].st, "incomplete");
});
