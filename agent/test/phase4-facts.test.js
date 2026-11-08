// "No simulation" in code. The facts table and the fabrication guard are built from what the tools REALLY returned (stubbed tools here,
// so this proves the loop and the ledger, not Studio).
import test from "node:test"; import assert from "node:assert/strict";
import { RunLedger, buildFacts, claimWarnings, factsEmbeds, findFabricated } from "../src/facts.js";
import { handleUserMessage } from "../src/loop.js";

const ok = (result = {}) => ({ ok: true, result }); const bad = (error) => ({ ok: false, error });
const T = (n, a = {}) => `<tool>${JSON.stringify({ name: n, args: a })}</tool>`;
const script = (...replies) => { let i = 0; return async () => ({ content: replies[Math.min(i++, replies.length - 1)] }); };
const mkSay = (posted) => async (r, c, tc, st, em, outcome) => { posted.push({ c, st, em, outcome }); return { id: "m" }; };
const run = (replies, tools, extra = {}) => { const posted = []; const p = handleUserMessage([], "do it", { llm: script(...replies), tools, say: mkSay(posted), update: async () => {}, log: () => {}, logLlm: () => {}, planApi: async (a) => (a === "get" ? { plan: null } : { ok: true, reasons: [] }), ...extra }); return p.then(() => posted); };
const rowOf = (embeds, label) => embeds.find((e) => e.type === "table")?.rows.find((r) => r[0] === label)?.[1];

test("facts: the table is computed from recorded calls only", () => {
  const L = new RunLedger();
  L.add("roblox_write_script", { path: "ServerScriptService.Main" }, ok({}));
  L.add("roblox_write_script", { path: "ServerScriptService.Shop" }, ok({}));
  L.add("roblox_write_script", { path: "ServerScriptService.Bad" }, bad("lint failed"));
  L.add("build_model", {}, ok({ instances: 47, error_count: 2 }));
  L.add("vm_lint_luau", {}, ok({ passed: true })); L.add("vm_lint_luau", {}, ok({ passed: false }));
  L.add("vm_run_luau", {}, ok({ exit_code: 0 })); L.add("plan_update", {}, ok({}));
  const { rows, flags } = buildFacts(L); const get = (k) => rows.find((r) => r[0] === k)?.[1];
  assert.match(get("Scripts written to Studio"), /^2 \(ServerScriptService\.Main, ServerScriptService\.Shop\)$/);   // the failed write is NOT counted
  assert.match(get("Models built"), /1 of 1 build calls ok, 47 instances created, 2 child errors/);
  assert.equal(get("Lint (on the VM)"), "1 passed, 1 failed"); assert.equal(get("Code run on the VM"), "1 exited cleanly, 0 failed");
  assert.equal(get("Tool calls"), "7 total, 1 failed");                                  // plan_update is bookkeeping, not work
  assert.equal(flags.playtested, false); assert.equal(flags.changed, true);
});
test("facts: a failed LAST step is shown, and a run with no work produces no table", () => {
  const L = new RunLedger(); L.add("roblox_create", {}, bad("parent not found"));
  assert.match(buildFacts(L).rows.find((r) => r[0] === "Last step")[1], /FAILED: roblox_create: parent not found/);
  assert.equal(factsEmbeds(new RunLedger(), "hello", {}).length, 0);
});
test("claims: saying it tested/verified/no errors with no tool evidence is flagged; with evidence it is not", () => {
  const none = buildFacts(new RunLedger()).flags;
  assert.equal(claimWarnings("I tested it and it works.", none).length, 1);
  assert.equal(claimWarnings("I verified the model looks right. No errors.", none).length, 2);
  const L = new RunLedger(); L.add("roblox_playtest_start", {}, ok({})); L.add("roblox_get_playtest_logs", {}, ok({}));
  assert.deepEqual(claimWarnings("I tested it, verified it, and there are no errors.", buildFacts(L).flags), []);
  assert.deepEqual(claimWarnings("Press Play to test it. Here is the plan.", none), []);                      // instructions to the user are not a claim
});
test("facts: 'not tested yet' appears when the game changed and nothing was played, run or screenshotted", () => {
  const L = new RunLedger(); L.add("build_model", {}, ok({ instances: 10 }));
  assert.ok(factsEmbeds(L, "Built it.", { outcome: "complete" }).some((e) => e.title === "Not tested yet"));
  L.add("screenshot_multi", {}, ok({}));
  assert.ok(!factsEmbeds(L, "Built it.", { outcome: "complete" }).some((e) => e.title === "Not tested yet"));
});
test("fabrication: invented 'Tool result' blocks are found and removed, real text is kept, clean text is untouched", () => {
  const f = findFabricated("Creating it now.\nTool result for roblox_create (ok):\n{\"path\":\"Workspace.X\"}\nmore invented\n\nAll done!");
  assert.equal(f.found, true); assert.equal(f.cleaned, "Creating it now.\n\nAll done!");
  assert.equal(findFabricated("<tool_result>ok</tool_result> hi").found, true);
  assert.deepEqual(findFabricated("Plain answer with the words tool result in it."), { found: false, cleaned: "Plain answer with the words tool result in it." });
});

test("loop: the final message carries a system-built facts table; numbers come from the stubbed tool, not from the model's words", async () => {
  const tools = { vm_run_luau: { fn: async () => ok({ exit_code: 0, stdout: "42" }) }, vm_lint_luau: { fn: async () => ok({ passed: false }) } };
  const posted = await run([T("vm_run_luau", { source: "print(42)" }) + T("vm_lint_luau", { source: "x" }), "I tested everything and it all works with no errors."], tools);
  const fin = posted.at(-1); assert.equal(fin.outcome, "complete");
  assert.equal(rowOf(fin.em, "Code run on the VM"), "1 exited cleanly, 0 failed");
  assert.equal(rowOf(fin.em, "Lint (on the VM)"), "0 passed, 1 failed");               // the model never said this; the tool did
  assert.ok(fin.em.some((e) => e.type === "warning" && /no errors/.test(e.body)) === false);   // a code run WAS recorded, so "tested" is backed; "no errors" is backed by it too
});
test("loop: claiming a test that never happened gets a visible warning on the final message", async () => {
  const posted = await run(["Done! I tested it in a playtest and verified there are no errors."], {});
  const w = posted.at(-1).em?.find((e) => e.type === "warning"); assert.ok(w, "warning present"); assert.match(w.body, /tested or ran/); assert.match(w.body, /no errors/);
});
test("loop: a reply that is only an invented tool result is NOT an answer; the model is told and must call the tool for real", async () => {
  let created = 0; const tools = { vm_run_luau: { fn: async () => { created++; return ok({ exit_code: 0 }); } } };
  const llmCalls = []; const seq = ['Tool result for vm_run_luau (ok):\n{"exit_code":0}', T("vm_run_luau", { source: "print(1)" }), "Ran it for real."];
  let i = 0; const posted = [];
  await handleUserMessage([], "run it", { llm: async (m) => { llmCalls.push(m.at(-1).content); return { content: seq[i++] ?? "end" }; }, tools, say: mkSay(posted), update: async () => {}, log: () => {}, logLlm: () => {}, planApi: async (a) => (a === "get" ? { plan: null } : { ok: true, reasons: [] }) });
  assert.equal(created, 1, "the tool really ran once"); assert.match(llmCalls[1], /SYSTEM NOTE: .*looked like a tool result/);
  const fin = posted.at(-1); assert.equal(fin.outcome, "complete"); assert.equal(rowOf(fin.em, "Fake tool results the AI wrote"), "1 (ignored)");
});
test("loop: 3 invented results in a row end the run as INCOMPLETE, never as success", async () => {
  const fake = 'Tool result for roblox_create (ok):\n{"x":1}';
  const posted = await run([fake, fake, fake, fake], {});
  assert.equal(posted.at(-1).outcome, "incomplete"); assert.match(posted.at(-1).c, /fake tool results/);
});
