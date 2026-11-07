// PHASE 1 item 9, wiring. MOCK tools and model. Proves the LOOP applies the policy.
import test from "node:test"; import assert from "node:assert/strict";
import { handleUserMessage } from "../src/loop.js";

const mk = () => { const said = [], calls = []; return { said, calls,
  planApi: async (a) => (a === "get" ? { plan: { id: "p", items: [] } } : a === "can_finish" ? { ok: true, reasons: [] } : { ok: true }),
  say: async (r, c, cards, st, emb, outcome) => (said.push({ c, st, outcome, emb }), { id: "m" }), update: async () => ({}), log: () => {}, logLlm: () => {} }; };
const tool = (n, a = {}) => `<tool>${JSON.stringify({ name: n, args: a })}</tool>`;
const run = (m, replies, tools, extra = {}) => { let i = 0; const seen = []; return handleUserMessage([], "go", { llm: async (msgs) => { seen.push(msgs.at(-1).content); return { content: replies[Math.min(i++, replies.length - 1)], finish_reason: "stop" }; }, tools, say: m.say, update: m.update, log: m.log, logLlm: m.logLlm, planApi: m.planApi, shouldStop: async () => false, maxIterations: 30, ...extra }).then(() => seen); };

test("[mock] a 'path not found' followed by a DIFFERENT call lets the build continue (old rule killed it on the 2nd identical error text)", async () => {
  const m = mk(); const tools = { roblox_set_properties: { fn: async (a) => (a.path === "Good" ? { ok: true, result: "ok" } : { ok: false, error: "path not found: " + a.path }) } };
  await run(m, [tool("roblox_set_properties", { path: "A" }), tool("roblox_set_properties", { path: "B" }), tool("roblox_set_properties", { path: "Good" }), "Done."], tools);
  assert.equal(m.said.at(-1).outcome, "complete"); assert.equal(m.said.at(-1).c, "Done.");
});
test("[mock] the exact same failing call twice in a row stops the run, with the raw error", async () => {
  const m = mk(); const tools = { roblox_create: { fn: async () => ({ ok: false, error: "parent not found: Workspace.Nope" }) } };
  await run(m, [tool("roblox_create", { parent: "Workspace.Nope" })], tools);
  const last = m.said.at(-1); assert.equal(last.outcome, "error"); assert.match(last.c, /parent not found: Workspace\.Nope/); assert.match(last.c, /same call/i);
});
test("[mock] a fatal error (plugin offline) stops on the first failure", async () => {
  const m = mk(); let n = 0; const tools = { roblox_get_tree: { fn: async () => (n++, { ok: false, error: "plugin did not respond (is Studio open and paired?)" }) } };
  await run(m, [tool("roblox_get_tree")], tools); assert.equal(n, 1); assert.match(m.said.at(-1).c, /plugin did not respond/); assert.equal(m.said.at(-1).outcome, "error");
});
test("[mock] a transient timeout on a READ is RETRIED automatically (the same call runs again without asking the model)", async () => {
  // Read-only tool on purpose: only reads are auto-retried (a repeated build could be applied twice).
  const m = mk(); let n = 0; const tools = { roblox_get_tree: { fn: async () => (++n < 3 ? { ok: false, error: "command timed out after 60s" } : { ok: true, result: "tree" }) } };
  let modelCalls = 0; await handleUserMessage([], "go", { llm: async () => { modelCalls++; return { content: modelCalls === 1 ? tool("roblox_get_tree") : "Seen.", finish_reason: "stop" }; }, tools, say: m.say, update: m.update, log: m.log, logLlm: m.logLlm, planApi: m.planApi, shouldStop: async () => false, maxIterations: 10 });
  assert.equal(n, 3, "ran 3 times: 2 retries"); assert.equal(modelCalls, 2, "the model was only asked twice, not per retry"); assert.equal(m.said.at(-1).outcome, "complete");
});
test("[mock] a READ timeout that never recovers stops after the retry limit", async () => {
  const m = mk(); let n = 0; const tools = { roblox_get_tree: { fn: async () => (n++, { ok: false, error: "command timed out after 60s" }) } };
  await run(m, [tool("roblox_get_tree")], tools); assert.equal(n, 3, "1 try + 2 retries"); assert.equal(m.said.at(-1).outcome, "error"); assert.match(m.said.at(-1).c, /timed out/);
});
test("[mock] one tool failing again and again with changing arguments hits its budget", async () => {
  const m = mk(); let i = 0; const tools = { roblox_set_properties: { fn: async (a) => ({ ok: false, error: "path not found: " + a.path }) } };
  const replies = Array.from({ length: 12 }, (_, k) => tool("roblox_set_properties", { path: "P" + k }));
  await run(m, replies, tools); const last = m.said.at(-1); assert.equal(last.outcome, "error"); assert.match(last.c, /roblox_set_properties has failed more than/);
});
test("[mock] the model is told the raw error and to change its call (fix kind)", async () => {
  const m = mk(); const tools = { roblox_create: { fn: async (a) => (a.parent === "Workspace" ? { ok: true, result: "ok" } : { ok: false, error: "parent not found: " + a.parent }) } };
  const seen = await run(m, [tool("roblox_create", { parent: "Workspace.X" }), tool("roblox_create", { parent: "Workspace" }), "ok"], tools);
  assert.match(seen[1], /parent not found: Workspace\.X/); assert.match(seen[1], /FAILED/);
});
test("[mock] failures are logged with their kind so the audit trail shows why a run stopped", async () => {
  const m = mk(); const logged = []; const tools = { roblox_get_tree: { fn: async () => ({ ok: false, error: "plugin did not respond" }) } };
  await run(m, [tool("roblox_get_tree")], tools, { log: (r) => logged.push(r) });
  assert.equal(logged.at(-1).error_kind ?? logged.at(-1).kind, "fatal");
});

test("[mock] item 9/10: a timed-out MUTATING call is NEVER auto-retried (it could build twice); the model is told to check the game first", async () => {
  const m = mk(); let n = 0; const tools = { build_model: { fn: async () => (n++, { ok: false, error: "plugin busy (command c1, state running, waited 75s). It could NOT be cancelled: Studio may still be running it, so the game may still change. command timed out" }) } };
  const seen = await run(m, [tool("build_model", { n: 1 }), "ok"], tools);
  assert.equal(n, 1, "ran once, no automatic repeat of a build"); assert.match(seen[1], /may still change|check/i);
});
test("[mock] item 9: a timed-out READ-ONLY call is still retried automatically", async () => {
  const m = mk(); let n = 0; const tools = { roblox_get_tree: { fn: async () => (++n < 3 ? { ok: false, error: "command timed out after 20s" } : { ok: true, result: "tree" }) } };
  await run(m, [tool("roblox_get_tree"), "Seen."], tools); assert.equal(n, 3);
});
