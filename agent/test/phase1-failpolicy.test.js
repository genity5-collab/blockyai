// PHASE 1 item 9. Pure policy tests (no I/O). Error strings are the REAL ones the plugin, edge functions and agent produce.
import test from "node:test"; import assert from "node:assert/strict";
import { classifyError, FailureTracker } from "../src/failpolicy.js";

test("classify: things only the user can fix are FATAL", () => {
  for (const e of ["plugin did not respond (is Studio open and paired?)", "plugin not responding", "waiting for user confirmation", "rejected by user", "rejected in Studio", "cancelled by the user", "stopped by user", "run_lua is disabled by the user", "run_lua is OFF in the plugin settings", "LLM error: http 500", "http 401", "invalid or expired token", "VM is not running", "This session has no VM yet (vm_id is empty). Open the chat so it starts.", "refused: non self-hosted model", "Pair Studio first. These tests build in a real game."])
    assert.equal(classifyError(e).kind, "fatal", e);
});
test("classify: transient trouble is RETRYABLE (same call again)", () => {
  for (const e of ["rate limit: too many commands per minute", "command timed out after 60s (state running)", "storage: temporary failure", "Blocky is still working. Wait or press Stop."])
    assert.equal(classifyError(e).kind, "retry", e);
});
test("classify: mistakes in the call are FIX_INPUT (the model must change something)", () => {
  for (const e of ["path not found: Workspace.Hous", "parent not found: Workspace.Map", "not a script: Workspace.Part", "text to replace not found in ServerScriptService.Main", "path or new_parent not found", "NOT pushed to Studio. Analysis failed (raw):\n(3,1) SyntaxError", "REFUSED: ServerScriptService.Main already exists and no base_hash was given", "source is empty", "bad name", "spec must be an object", "no active plan. Call plan_create first.", "snapshot not found (snapshots live only while Studio stays open): x"])
    assert.equal(classifyError(e).kind, "fix", e);
});
test("classify: an unknown error is treated as FIX_INPUT, never silently fatal or retried forever", () => { assert.equal(classifyError("something strange").kind, "fix"); assert.equal(classifyError(undefined).kind, "fix"); assert.equal(classifyError("").kind, "fix"); });
test("classify: a fatal phrase hidden in a longer message is still fatal", () => { assert.equal(classifyError("batch partly failed (1/3 applied):\n- plugin did not respond").kind, "fatal"); });

const call = (name, args) => ({ name, args });
test("tracker: a recoverable miss followed by a DIFFERENT call does not stop the run", () => {
  const t = new FailureTracker();
  assert.equal(t.record(call("roblox_set_properties", { path: "A" }), "path not found: A").action, "continue");
  t.recordSuccess(call("roblox_find", {})); 
  assert.equal(t.record(call("roblox_set_properties", { path: "B" }), "path not found: B").action, "continue", "same ERROR TYPE but a different call is fine");
});
test("tracker: the SAME call failing the same way twice in a row is a loop and stops", () => {
  const t = new FailureTracker(); const c = call("roblox_create", { class: "Part", parent: "Workspace.Nope" });
  assert.equal(t.record(c, "parent not found: Workspace.Nope").action, "continue");
  const r = t.record(c, "parent not found: Workspace.Nope"); assert.equal(r.action, "stop"); assert.match(r.reason, /same call|repeat/i);
});
test("tracker: key order in the arguments does not hide a repeated call", () => {
  const t = new FailureTracker(); t.record(call("x", { a: 1, b: 2 }), "bad name"); assert.equal(t.record(call("x", { b: 2, a: 1 }), "bad name").action, "stop");
});
test("tracker: a success resets the repeat memory", () => {
  const t = new FailureTracker(); const c = call("roblox_create", { p: 1 }); t.record(c, "parent not found"); t.recordSuccess(call("roblox_find", {}));
  assert.equal(t.record(c, "parent not found").action, "continue");
});
test("tracker: fatal errors stop at once", () => { assert.equal(new FailureTracker().record(call("roblox_create", {}), "plugin did not respond").action, "stop"); });
test("tracker: retryable errors get a bounded number of retries per call, then stop", () => {
  const t = new FailureTracker({ maxRetries: 2 }); const c = call("roblox_build_model", { n: 1 });
  assert.equal(t.record(c, "command timed out after 60s").action, "retry"); assert.equal(t.record(c, "command timed out after 60s").action, "retry");
  assert.equal(t.record(c, "command timed out after 60s").action, "stop");
});
test("tracker: a per-tool budget stops one tool from burning the run", () => {
  const t = new FailureTracker({ perToolBudget: 5 }); let last;
  for (let i = 0; i < 6; i++) { last = t.record(call("roblox_set_properties", { path: "P" + i }), "path not found: P" + i); t.recordSuccess(call("roblox_find", {})); }
  assert.equal(last.action, "stop"); assert.match(last.reason, /roblox_set_properties/);
});
test("tracker: a per-run budget stops a run that fails everywhere", () => {
  const t = new FailureTracker({ perToolBudget: 99, perRunBudget: 6 }); let last;
  for (let i = 0; i < 7; i++) { last = t.record(call("tool" + i, { i }), "bad name"); t.recordSuccess(call("ok", {})); }
  assert.equal(last.action, "stop"); assert.match(last.reason, /failures this run|budget/i);
});
test("tracker: successes do NOT refund the budgets", () => {
  const t = new FailureTracker({ perToolBudget: 3 }); let last;
  for (let i = 0; i < 4; i++) { t.recordSuccess(call("roblox_set_properties", { i })); last = t.record(call("roblox_set_properties", { path: "x" + i }), "path not found"); }
  assert.equal(last.action, "stop");
});
test("tracker: the stop reason keeps the raw error text", () => { const r = new FailureTracker().record(call("a", {}), "plugin did not respond (is Studio open and paired?)"); assert.match(r.reason, /plugin did not respond/); });

test("the system prompt describes the real failure policy (fix and retry), not 'a failed tool ends the run'", async () => {
  const { SYSTEM } = await import("../src/loop.js");
  assert.doesNotMatch(SYSTEM, /If a tool FAILS the run ends/);
  assert.match(SYSTEM, /CHANGE the call/);
  assert.match(SYSTEM, /Repeating the exact same failing call stops the run/);
});
