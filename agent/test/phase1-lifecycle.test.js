// PHASE 1 items 6, 7, 8. MOCK: fake plan API and fake tools. Proves the loop's decisions, not the server's SQL (that part is tested live separately).
import test from "node:test"; import assert from "node:assert/strict";
import { isMutatingTool } from "../src/lifecycle.js";
import { handleUserMessage } from "../src/loop.js";

test("[mock] isMutatingTool: reads are not mutating; edits, scripts, builds, deletes are", () => {
  for (const n of ["roblox_get_tree", "roblox_find", "roblox_read_script", "roblox_screenshot", "roblox_get_playtest_logs", "roblox_get_selection", "roblox_get_edit_log", "get_bounding_box", "raycast", "measure_distance", "screenshot_multi", "camera_set", "vm_exec", "vm_read_file", "vm_lint_luau", "local_grep", "plan_create", "plan_update", "sync_mirror", "template_load", "roblox_snapshot_save", "roblox_playtest_stop", "roblox_playtest_start"]) assert.equal(isMutatingTool(n), false, n);
  for (const n of ["roblox_create", "roblox_delete", "roblox_move", "roblox_set_properties", "roblox_write_script", "roblox_patch_script", "roblox_batch", "roblox_snapshot_restore", "build_model", "build_from_template", "terrain_fill", "terrain_heightmap", "lighting_set", "ui_build", "insert_asset", "duplicate_grid", "mirror", "scale_model", "align", "push_changed", "batch_refs"]) assert.equal(isMutatingTool(n), true, n);
});
test("[mock] an UNKNOWN tool name counts as mutating (fail safe: the gate applies)", () => { assert.equal(isMutatingTool("something_new"), true); });

const mk = (planState) => {
  const said = [], calls = []; const plan = { current: planState };
  const planApi = async (action, body = {}) => { calls.push({ action, body });
    if (action === "get") return { plan: plan.current };
    if (action === "can_finish") return plan.current ? { ok: false, reasons: ["1 checklist item(s) are not done"] } : { ok: true, reasons: [] };
    if (action === "abandon") { plan.current = null; return { ok: true }; }
    if (action === "begin_turn") { plan.current = null; return { ok: true }; }
    return { ok: true }; };
  return { said, calls, plan, planApi, api: { plan: planApi }, say: async (r, c, cards, st, emb, outcome) => (said.push({ c, st, outcome }), { id: "m" }), update: async () => ({}), log: () => {}, logLlm: () => {} };
};
const T = { roblox_create: { args: "", fn: async () => ({ ok: true, result: "made" }) }, roblox_get_tree: { args: "", fn: async () => ({ ok: true, result: "t" }) }, plan_create: { args: "", fn: async () => ({ ok: true, result: "p" }) } };
const llmOf = (arr) => { let i = 0; return async () => ({ content: arr[Math.min(i++, arr.length - 1)], finish_reason: "stop" }); };
const go = (m, replies, extra = {}) => handleUserMessage([], "build a house", { llm: llmOf(replies), tools: T, say: m.say, update: m.update, log: m.log, logLlm: m.logLlm, planApi: m.planApi, shouldStop: async () => false, maxIterations: 14, ...extra });

// ---- item 6: the gate is not opt-in ----
test("[mock] item 6: a turn that mutated Studio but made NO plan cannot finish; the model is told to plan_create", async () => {
  const m = mk(null); const seen = [];
  await handleUserMessage([], "build a house", { llm: async (msgs) => { seen.push(msgs.map((x) => x.content).join("\n")); return { content: seen.length === 1 ? '<tool>{"name":"roblox_create","args":{}}</tool>' : "All done!", finish_reason: "stop" }; }, tools: T, say: m.say, update: m.update, log: m.log, logLlm: m.logLlm, planApi: m.planApi, shouldStop: async () => false, maxIterations: 6 });
  assert.match(seen.slice(1).join("\n"), /plan_create/, "must demand a plan");
  assert.ok(!m.said.some((s) => s.c === "All done!" && s.outcome === "complete"), "an unplanned build must not be reported as complete");
});
test("[mock] item 6: a pure chat turn (no mutating tool) skips the gate and finishes normally", async () => {
  const m = mk(null); await go(m, ["Hello! Roblox parts are blocks."]);
  assert.equal(m.said.at(-1).c, "Hello! Roblox parts are blocks."); assert.equal(m.said.at(-1).outcome, "complete");
});
test("[mock] item 6: a read-only turn (only get_tree) is still a chat turn", async () => {
  const m = mk(null); await go(m, ['<tool>{"name":"roblox_get_tree","args":{}}</tool>', "The tree has 3 services."]);
  assert.equal(m.said.at(-1).outcome, "complete");
});

// ---- item 8: end states ----
test("[mock] item 8: 6 gate rejections end as INCOMPLETE listing the unmet conditions, never as success", async () => {
  const m = mk(null);
  // begin_turn clears stale plans (item 7), so the model creates its own plan DURING the run; the plan then has an open item that never gets done.
  const T2 = { ...T, plan_create: { args: "", fn: async () => { m.plan.current = { id: "p", items: [{ id: 1, text: "x", done: false }] }; return { ok: true, result: "p" }; } } };
  await go(m, ['<tool>{"name":"roblox_create","args":{}}</tool>', '<tool>{"name":"plan_create","args":{}}</tool>', ...Array(12).fill("I am done.")], { tools: T2 });
  const last = m.said.at(-1); assert.equal(last.outcome, "incomplete"); assert.match(last.c, /INCOMPLETE/); assert.match(last.c, /checklist item/);
  assert.equal(m.said.filter((s) => s.outcome === "complete").length, 0);
  assert.ok(m.calls.some((c) => c.action === "abandon"), "an unfinished plan is closed");
});
test("[mock] item 8: gate exhaustion with NO plan also lists the unmet condition", async () => {
  const m = mk(null); await go(m, ['<tool>{"name":"roblox_create","args":{}}</tool>', ...Array(12).fill("I am done.")]);
  const last = m.said.at(-1); assert.equal(last.outcome, "incomplete"); assert.match(last.c, /made no plan/);
});
test("[mock] item 8: hitting the iteration cap is INCOMPLETE, not success", async () => {
  const m = mk(null); await go(m, Array(30).fill('<tool>{"name":"roblox_create","args":{}}</tool>'), { maxIterations: 4 });
  assert.equal(m.said.at(-1).outcome, "incomplete"); assert.match(m.said.at(-1).c, /4 steps|limit/i);
});
test("[mock] item 8: Stop is reported as 'stopped', distinct from complete and incomplete", async () => {
  const m = mk(null); let n = 0; await go(m, ['<tool>{"name":"roblox_create","args":{}}</tool>'], { shouldStop: async () => ++n > 1 });
  assert.equal(m.said.at(-1).outcome, "stopped");
});
test("[mock] item 8: a normal finish with a satisfied gate is 'complete'", async () => {
  const m = mk(null); m.planApi = async (a) => (a === "get" ? { plan: { id: "p", items: [] } } : a === "can_finish" ? { ok: true, reasons: [] } : { ok: true });
  await go(m, ['<tool>{"name":"roblox_create","args":{}}</tool>', "Built it."], { planApi: m.planApi });
  assert.equal(m.said.at(-1).outcome, "complete");
});

// ---- item 7: plan lifecycle ----
test("[mock] item 7: every new user turn begins by abandoning any plan left from an earlier message", async () => {
  const m = mk({ id: "old", items: [{ id: 1, text: "stale", done: false }] }); await go(m, ["Just chatting."]);
  assert.equal(m.calls[0].action, "begin_turn"); assert.equal(m.said.at(-1).outcome, "complete", "a stale plan must not gate an unrelated message");
});
test("[mock] item 7: the plan is abandoned when the run ends INCOMPLETE and when it is stopped", async () => {
  const a = mk({ id: "p", items: [{ id: 1, text: "x", done: false }] }); await go(a, ['<tool>{"name":"roblox_create","args":{}}</tool>', ...Array(12).fill("done")]);
  assert.ok(a.calls.some((c) => c.action === "abandon"), "abandon on INCOMPLETE");
  const b = mk(null); let n = 0; await go(b, ['<tool>{"name":"roblox_create","args":{}}</tool>'], { shouldStop: async () => ++n > 1 });
  assert.ok(b.calls.some((c) => c.action === "abandon"), "abandon on Stop");
});
test("[mock] item 7: plan_create carries the message_id of the user turn", async () => {
  const { TOOLS } = await import("../src/tools.js"); const { api } = await import("../src/api.js");
  let sent; api.plan = async (action, body) => { sent = { action, body }; return { plan: { id: "p", items: [{ id: 1, text: "a" }, { id: 2, text: "b" }] } }; };
  const { currentTurn } = await import("../src/lifecycle.js"); currentTurn.messageId = "11111111-1111-1111-1111-111111111111";
  await TOOLS.plan_create.fn({ title: "t", items: ["a", "b"] });
  assert.equal(sent.body.message_id, "11111111-1111-1111-1111-111111111111");
});
