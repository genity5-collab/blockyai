import { test } from "node:test";
import assert from "node:assert/strict";
// Import the REAL .ts file (Node strips the types natively), so the test judges the exact code the server runs.
let mod; try { mod = await import("../../supabase/functions/_shared/acceptance.ts"); } catch (e) { mod = { error: e }; }

const C = (name, ok = true, rs = null, a = "") => ({ name, ok, result_summary: rs, args_summary: a });
const plan = (n, done = n, ver = 1) => ({ status: "complete", items: Array.from({ length: n }, (_, i) => ({ done: i < done, verified: i < ver })) });
const good = { yacht: [C("build_model", true, { instances: 52, error_count: 0 }), C("screenshot_multi", true, { captured: 4 })] };

test("acceptance module loads", () => { assert.ok(!mod.error, String(mod.error)); assert.equal(Object.keys(mod.TESTS).length, 5); });
test("no recorded calls = not run, never a pass", () => { const v = mod.evaluate("yacht", [], null); assert.equal(v.pass, false); assert.equal(v.ran, false); });
test("yacht: passes only with 40+ instances, 0 errors, plan done, verified and looked at", () => {
  assert.equal(mod.evaluate("yacht", good.yacht, plan(6)).pass, true);
  const fail = (calls, p, why) => { const v = mod.evaluate("yacht", calls, p); assert.equal(v.pass, false, why); return v; };
  fail([C("build_model", true, { instances: 12, error_count: 0 }), C("screenshot_multi")], plan(6), "12 instances");
  fail([C("build_model", true, { instances: 52, error_count: 3 }), C("screenshot_multi")], plan(6), "build errors");
  fail(good.yacht, plan(6, 4), "unfinished plan");
  fail(good.yacht, plan(6, 6, 0), "nothing verified");
  fail(good.yacht, null, "no plan at all");
  fail([C("build_model", true, { instances: 52, error_count: 0 })], plan(6), "never looked at it");
  fail([C("build_model", false, { instances: 52, error_count: 0 }), C("screenshot_multi")], plan(6), "failed build call does not count");
});
test("yacht: instances add up across sections and failed calls are ignored", () => {
  const v = mod.evaluate("yacht", [C("build_model", true, { instances: 30, error_count: 0 }), C("build_model", true, { instances: 20, error_count: 0 }), C("build_model", false, { instances: 999 }), C("roblox_screenshot")], plan(4));
  assert.equal(v.pass, true); assert.match(v.rules.find((r) => r.id === "built").evidence, /50 instances across 2/);
});
test("obby: needs scripts, lint, a playtest and its logs", () => {
  const base = [C("build_model", true, { instances: 80, error_count: 0 }), C("screenshot_multi"), C("vm_lint_luau"), C("roblox_write_script"), C("roblox_write_script"), C("roblox_playtest_start"), C("roblox_get_playtest_logs")];
  assert.equal(mod.evaluate("obby", base, plan(8)).pass, true);
  for (const drop of ["vm_lint_luau", "roblox_playtest_start", "roblox_get_playtest_logs"]) assert.equal(mod.evaluate("obby", base.filter((c) => c.name !== drop), plan(8)).pass, false, "missing " + drop);
  assert.equal(mod.evaluate("obby", base.filter((c, i) => c.name !== "roblox_write_script" || i === 3), plan(8)).pass, false, "only one script");
});
test("shop: needs ui_build, a pushed + linted server script, and a playtest with logs", () => {
  const base = [C("ui_build"), C("vm_lint_luau"), C("roblox_write_script"), C("roblox_playtest_start"), C("roblox_get_playtest_logs")];
  assert.equal(mod.evaluate("shop", base, plan(5)).pass, true);
  for (const drop of ["ui_build", "vm_lint_luau", "roblox_write_script", "roblox_playtest_start"]) assert.equal(mod.evaluate("shop", base.filter((c) => c.name !== drop), plan(5)).pass, false, "missing " + drop);
});
test("terrain: heightmap computed in the VM, lighting, trees snapped, then looked at", () => {
  const base = [C("vm_exec"), C("terrain_heightmap"), C("lighting_set"), C("snap_to_ground"), C("screenshot_multi")];
  assert.equal(mod.evaluate("terrain", base, plan(5)).pass, true);
  assert.equal(mod.evaluate("terrain", [C("vm_exec"), C("terrain_fill"), C("lighting_set"), C("snap_to_ground"), C("roblox_screenshot")], plan(5)).pass, true, "terrain_fill also counts");
  for (const drop of ["vm_exec", "lighting_set", "snap_to_ground", "screenshot_multi"]) assert.equal(mod.evaluate("terrain", base.filter((c) => c.name !== drop), plan(5)).pass, false, "missing " + drop);
  assert.equal(mod.evaluate("terrain", [C("terrain_heightmap", false), ...base.slice(2)], plan(5)).pass, false, "a failed heightmap is not terrain");
});
test("every failing rule names its evidence (so the page can show WHY)", () => {
  const v = mod.evaluate("yacht", [C("build_model", true, { instances: 5, error_count: 2 })], plan(3, 1, 0));
  const failed = v.rules.filter((r) => !r.pass); assert.ok(failed.length >= 4); for (const r of failed) assert.ok(r.evidence.length > 0, r.id);
});
test("the house test cannot pass on a lint alone", () => {
  const v = mod.evaluate("house", [C("build_model", true, { instances: 35, error_count: 0 }, ""), C("screenshot_multi"), C("vm_lint_luau")], plan(5));
  assert.equal(v.rules.find((r) => r.id === "script").pass, false, "no script was written or pushed"); assert.equal(v.pass, false);
});

test("house: a keyword in build_model args can no longer stand in for a pushed script", () => {
  const v = mod.evaluate("house", [C("build_model", true, { instances: 35, error_count: 0 }, '{"spec":"{...} Script DoorScript"}'), C("screenshot_multi"), C("vm_lint_luau")], plan(5));
  assert.equal(v.rules.find((r) => r.id === "script").pass, false); assert.equal(v.pass, false);
  const ok = mod.evaluate("house", [C("build_model", true, { instances: 35, error_count: 0 }), C("screenshot_multi"), C("vm_lint_luau"), C("roblox_write_script")], plan(5));
  assert.equal(ok.pass, true);
});
