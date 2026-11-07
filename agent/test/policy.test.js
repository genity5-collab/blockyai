import test from "node:test"; import assert from "node:assert/strict";
import { timeoutFor, capResult, byteLength, RESULT_CAP_BYTES, expandCommands, classify, risk, isMutating, ALLOWED_DURING_PLAYTEST } from "../../supabase/functions/_shared/policy.js";

test("timeouts: builders and terrain are longer than get_tree; unknown types get the default", () => {
  assert.ok(timeoutFor("build_model") > timeoutFor("get_tree")); assert.ok(timeoutFor("terrain_heightmap") > timeoutFor("get_tree"));
  assert.ok(timeoutFor("terrain_heightmap") >= timeoutFor("build_model")); assert.equal(timeoutFor("nope"), 60);
});
test("result cap: small passes through untouched", () => { const r = capResult({ a: 1 }); assert.equal(r.truncated, false); assert.deepEqual(r.value, { a: 1 }); });
test("result cap: a big array is cut at an element boundary, stays under 64 KB, and gives next_cursor", () => {
  const big = Array.from({ length: 5000 }, (_, i) => ({ path: "Workspace.Model.Part" + i, class: "Part", size: [1, 2, 3] }));
  assert.ok(byteLength(big) > RESULT_CAP_BYTES);
  const r = capResult(big); assert.equal(r.truncated, true); assert.ok(byteLength(r.value) <= RESULT_CAP_BYTES);
  assert.equal(r.value.length, r.next_cursor, "cursor = index of the first element NOT returned"); assert.deepEqual(r.value[0], big[0]); assert.equal(r.bytes, byteLength(big));
});
test("result cap: paging through next_cursor returns every element exactly once", () => {
  const big = Array.from({ length: 3000 }, (_, i) => ({ i, pad: "x".repeat(60) })); const seen = []; let cur = 0, pages = 0;
  while (cur !== null && pages++ < 100) { const r = capResult(big.slice(cur), 20_000, cur); seen.push(...r.value); cur = r.truncated ? r.next_cursor : null; }
  assert.equal(seen.length, 3000); assert.deepEqual(seen.map((x) => x.i), big.map((x) => x.i));
});
test("result cap: a huge string and a huge object are reduced and flagged, never thrown", () => {
  const s = capResult("y".repeat(300_000)); assert.equal(s.truncated, true); assert.ok(byteLength(s.value) <= RESULT_CAP_BYTES);
  const o = capResult({ ok: true, source: "z".repeat(200_000), items: Array.from({ length: 4000 }, (_, i) => ({ i, p: "q".repeat(40) })) }); assert.equal(o.truncated, true); assert.ok(byteLength(o.value) <= RESULT_CAP_BYTES); assert.equal(o.value.ok, true);
});
test("batch is expanded before classifying: a HIGH step inside a batch makes the batch HIGH", () => {
  const c = classify("batch", { commands: [{ type: "create", payload: {} }, { type: "delete", payload: { paths: ["Workspace.Wall"] } }] });
  assert.equal(c.tier, "high"); assert.deepEqual(c.steps, ["create", "delete"]);
});
test("batch_refs and nested batches are expanded too; absurd nesting is treated as HIGH", () => {
  assert.equal(classify("batch_refs", { steps: [{ name: "run_lua", args: {} }] }).needsApproval, true);
  assert.equal(classify("batch", { commands: [{ type: "batch", payload: { commands: [{ type: "delete", payload: { count: 50 } }] } }] }).needsApproval, true);
  let deep = { type: "move", payload: {} }; for (let i = 0; i < 6; i++) deep = { type: "batch", payload: { commands: [deep] } };
  assert.equal(classify("batch", deep.payload).needsApproval, true);
});
test("approval rules: delete >10, delete of a script, delete of a service child, any run_lua", () => {
  assert.equal(classify("delete", { paths: ["Workspace.A"] }).needsApproval, false, "one ordinary part: no approval");
  assert.equal(classify("delete", { paths: Array.from({ length: 11 }, (_, i) => "Workspace.P" + i) }).needsApproval, true);
  assert.equal(classify("delete", { paths: Array.from({ length: 10 }, (_, i) => "Workspace.P" + i) }).needsApproval, false, "exactly 10 is allowed");
  assert.equal(classify("delete", { paths: ["ServerScriptService.Main"], class: "Script" }).needsApproval, true);
  assert.equal(classify("delete", { paths: ["Workspace"] }).needsApproval, true);
  assert.equal(classify("delete", { paths: ["Game.Lighting"] }).needsApproval, true);
  assert.equal(classify("run_lua", { code: "print(1)" }).needsApproval, true);
  assert.equal(classify("delete", {}).needsApproval, true, "unclear target is never auto-approved");
});
test("snapshot_restore needs approval until a real restore test has passed", () => {
  assert.equal(classify("snapshot_restore", { id: "x" }).needsApproval, true);
  assert.equal(classify("snapshot_restore", { id: "x" }, { restoreVerified: true }).needsApproval, false);
});
test("TAINT: once tainted, EVERY high action needs approval, even a 1-part delete; low/medium are unaffected", () => {
  assert.equal(classify("delete", { paths: ["Workspace.A"] }, { tainted: true }).needsApproval, true);
  assert.equal(classify("batch", { commands: [{ type: "delete", payload: { paths: ["Workspace.A"] } }] }, { tainted: true }).needsApproval, true);
  assert.equal(classify("set_properties", {}, { tainted: true }).needsApproval, false);
  assert.equal(classify("write_script", {}, { tainted: true }).needsApproval, false);
});
test("risk tiers: property edits LOW, create/scripts MEDIUM, delete/restore/run_lua HIGH", () => {
  assert.equal(risk("set_properties"), "low"); assert.equal(risk("create"), "medium"); assert.equal(risk("write_script"), "medium"); assert.equal(risk("delete"), "high"); assert.equal(risk("get_tree"), "low");
});
test("playtest guard: reads and playtest control are allowed during a playtest; mutations are not", () => {
  for (const t of ["get_tree", "get_playtest_logs", "screenshot", "playtest_stop"]) assert.ok(ALLOWED_DURING_PLAYTEST.has(t), t);
  for (const t of ["create", "delete", "write_script", "build_model", "set_properties", "terrain_fill"]) { assert.ok(!ALLOWED_DURING_PLAYTEST.has(t), t); assert.ok(isMutating(t), t); }
});
test("result cap is a GUARANTEE: 300 random shapes never exceed 64 KB, never throw, scalar fields survive", () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let n = 0; n < 300; n++) {
    const o = { ok: rnd() > 0.5, count: Math.floor(rnd() * 1e6), name: "n" + n };
    for (let k = 0; k < 1 + Math.floor(rnd() * 5); k++) {
      const kind = Math.floor(rnd() * 4);
      o["f" + k] = kind === 0 ? "s".repeat(Math.floor(rnd() * 250000)) : kind === 1 ? Array.from({ length: Math.floor(rnd() * 6000) }, (_, i) => ({ i, p: "q".repeat(Math.floor(rnd() * 80)) })) : kind === 2 ? { a: "x".repeat(Math.floor(rnd() * 90000)), b: [1, 2, 3] } : Math.floor(rnd() * 1000);
    }
    const r = capResult(o); assert.ok(byteLength(r.value) <= RESULT_CAP_BYTES, `case ${n}: ${byteLength(r.value)} bytes`);
    if (byteLength(o) > RESULT_CAP_BYTES) assert.equal(r.truncated, true); else assert.equal(r.truncated, false);
    assert.equal(r.value.count, o.count, "small scalar fields survive truncation");
  }
});
