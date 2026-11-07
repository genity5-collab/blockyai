import { test } from "node:test";
import assert from "node:assert/strict";
import { handleUserMessage, finishGate, clampIterations, HARD_FAILURE, MAX_GATE_REJECTIONS, DEFAULT_BUILD_ITERATIONS, HARD_ITERATION_CAP } from "../src/loop.js";
import { countSpec, splitSpec, resolveRefs, batchRefs, buildModel, SECTION_LIMIT } from "../src/tools-build.js";

const mkSay = (posted) => async (r, c, tc, st, em) => { posted.push({ c, st, em }); return { id: "m" }; };
const script = (...replies) => { let i = 0; return async () => ({ content: replies[Math.min(i++, replies.length - 1)] }); };
const T = (name) => `<tool>{"name":"${name}","args":{}}</tool>`;

test("iteration defaults: 40 for builds, user adjustable, hard cap 80", () => {
  assert.equal(DEFAULT_BUILD_ITERATIONS, 40); assert.equal(HARD_ITERATION_CAP, 80);
  assert.equal(clampIterations(undefined), 40); assert.equal(clampIterations(25), 25); assert.equal(clampIterations(9999), 80); assert.equal(clampIterations(-3), 40); assert.equal(clampIterations(1), 4);
});

test("finishGate(): no plan = chat answer allowed; plan service error never traps the agent", async () => {
  assert.deepEqual(await finishGate({ api: { plan: async () => ({ plan: null }) }, tools: {} }), { ok: true, reasons: [] });
  assert.equal((await finishGate({ api: { plan: async () => { throw new Error("down"); } }, tools: {} })).ok, true);
});
test("finishGate(): counts descendants of the target through roblox_find and passes them to the server", async () => {
  const calls = [];
  const api = { plan: async (a, b) => { calls.push([a, b]); return a === "get" ? { plan: { target_path: "Workspace.Yacht" } } : { ok: false, reasons: ["only 1 descendants"] }; } };
  const g = await finishGate({ api, tools: { roblox_find: { fn: async (x) => { assert.equal(x.under, "Workspace.Yacht"); return { ok: true, result: ["Workspace.Yacht.Hull"] }; } } } });
  assert.equal(g.ok, false); assert.equal(calls.at(-1)[1].target_descendants, 1);
});
test("finishGate(): unreadable target sends null (does not fake a count)", async () => {
  let sent; const api = { plan: async (a, b) => { if (a === "get") return { plan: { target_path: "W.X" } }; sent = b; return { ok: true, reasons: [] }; } };
  await finishGate({ api, tools: { roblox_find: { fn: async () => ({ ok: false, error: "plugin offline" }) } } });
  assert.equal(sent.target_descendants, null);
});

// Drive the real loop with a fake api object injected through the module's api import is not possible, so patch api.plan
import { api } from "../src/api.js";
test("LOOP: 'I'm done' is rejected until the server agrees, then it finishes", async () => {
  const realPlan = api.plan; const posted = []; const prompts = []; let canFinishCalls = 0;
  api.plan = async (action) => { if (action === "get") return { plan: { target_path: null } }; if (action !== "can_finish") return { ok: true }; canFinishCalls++; return canFinishCalls < 3 ? { ok: false, reasons: ["1 checklist item(s) are not done: #4 verify"] } : { ok: true, reasons: [] }; };
  try {
    let n = 0;
    await handleUserMessage([], "build", { llm: async (m) => { prompts.push(m.at(-1).content); n++; return { content: "I am done." }; }, tools: {}, say: mkSay(posted), update: async () => {}, log: () => {}, maxIterations: 10 });
    assert.equal(n, 3, "two rejections then the accepted finish");
    assert.match(prompts[1], /FINISH REJECTED/); assert.match(prompts[1], /#4 verify/);
    assert.equal(posted.at(-1).c, "I am done."); assert.equal(posted.at(-1).st, "idle");
  } finally { api.plan = realPlan; }
});
test("LOOP: after the max rejections it stops and states the unfinished reasons (no pretending)", async () => {
  const realPlan = api.plan; const posted = [];
  api.plan = async (action) => action === "get" ? { plan: {} } : { ok: false, reasons: ["target has only 1 descendants"] };
  try {
    let n = 0;
    await handleUserMessage([], "build", { llm: async () => { n++; return { content: "finished" }; }, tools: {}, say: mkSay(posted), update: async () => {}, log: () => {}, maxIterations: 30 });
    assert.equal(n, MAX_GATE_REJECTIONS + 1);
    assert.match(posted.at(-1).c, /could not finish this properly/); assert.match(posted.at(-1).c, /only 1 descendants/); assert.equal(posted.at(-1).em[0].title, "Unfinished");
  } finally { api.plan = realPlan; }
});
test("LOOP: a recoverable tool failure goes back to the model and the build continues", async () => {
  // Item 6: a turn that changed the game needs a plan to finish. The fixture supplies one the server accepts; the assertions below are unchanged.
  const realPlan = api.plan; api.plan = async (action) => (action === "get" ? { plan: { id: "p", items: [], target_path: null } } : action === "can_finish" ? { ok: true, reasons: [] } : { ok: true }); const posted = []; const prompts = []; let k = 0;
  try {
    const tools = { roblox_write_script: { fn: async () => (k++ === 0 ? { ok: false, error: "NOT pushed. Analysis failed: (3,1) SyntaxError" } : { ok: true, result: "pushed" }) } };
    let n = 0;
    await handleUserMessage([], "go", { llm: async (m) => { prompts.push(m.at(-1).content); return { content: n++ < 2 ? '<tool>{"name":"roblox_write_script","args":{"n":' + n + '}}</tool>' : "fixed and done" }; }, tools, say: mkSay(posted), update: async () => {}, log: () => {}, maxIterations: 10 });
    assert.match(prompts[1], /FAILED/); assert.match(prompts[1], /SyntaxError/); assert.equal(posted.at(-1).c, "fixed and done");
  } finally { api.plan = realPlan; }
});
test("LOOP: a HARD failure (plugin offline) stops immediately with the raw error", async () => {
  const realPlan = api.plan; api.plan = async () => ({ plan: null }); const posted = []; let n = 0;
  try {
    await handleUserMessage([], "go", { llm: async () => { n++; return { content: T("roblox_get_tree") }; }, tools: { roblox_get_tree: { fn: async () => ({ ok: false, error: "plugin did not respond (is Studio open and paired?)" }) } }, say: mkSay(posted), update: async () => {}, log: () => {}, maxIterations: 10 });
    assert.equal(n, 1); assert.match(posted.at(-1).c, /plugin did not respond/);
  } finally { api.plan = realPlan; }
});
test("LOOP: a run of failing calls always stops (no endless loop)", async () => {
  // Item 9: the stop rule is now per CALL and per tool budget instead of "4 errors in a row". Every call here differs (new args, new error),
  // so only the per-tool budget (6) can end it. The contract that matters is unchanged: it stops, with the raw error shown.
  const realPlan = api.plan; api.plan = async () => ({ plan: null }); const posted = []; let n = 0, e = 0;
  try {
    await handleUserMessage([], "go", { llm: async () => { n++; return { content: `<tool>{"name":"t","args":{"i":${n}}}</tool>` }; }, tools: { t: { fn: async () => ({ ok: false, error: "different error " + e++ }) } }, say: mkSay(posted), update: async () => {}, log: () => {}, maxIterations: 40 });
    assert.ok(n <= 8, "bounded: stopped after " + n + " model calls"); assert.match(posted.at(-1).c, /A tool failed, so I stopped/); assert.match(posted.at(-1).c, /different error/);
  } finally { api.plan = realPlan; }
});
test("HARD_FAILURE matches the real unrecoverable errors only", () => {
  for (const s of ["plugin did not respond (is Studio open and paired?)", "waiting for user confirmation (timed out)", "http 401"]) assert.ok(HARD_FAILURE.test(s), s);
  for (const s of ["NOT pushed. Analysis failed", "path not found", "build failed: size must be positive"]) assert.ok(!HARD_FAILURE.test(s), s);
});

// ---- build helpers ----
const part = (n) => ({ name: "P" + n, class: "Part" });
const group = (name, n) => ({ name, class: "Model", children: Array.from({ length: n }, (_, i) => part(i)) });
test("countSpec counts the root and every descendant", () => { assert.equal(countSpec({ name: "a", children: [{ name: "b", children: [{ name: "c" }] }, { name: "d" }] }), 4); assert.equal(countSpec(null), 0); });
test("splitSpec leaves small specs alone and splits big ones by top-level group", () => {
  assert.equal(splitSpec(group("Small", 10)).length, 1);
  const big = { name: "City", class: "Model", children: [group("A", 300), group("B", 300), group("C", 100)] };
  const parts = splitSpec(big); assert.ok(parts.length >= 2);
  assert.equal(parts.reduce((n, p) => n + p.children.length, 0), 3, "no child lost or duplicated");
  for (const p of parts) assert.ok(countSpec(p) <= SECTION_LIMIT + 1, "section within limit: " + countSpec(p));
});
test("splitSpec reports a single child that is too big to split instead of silently failing", () => {
  const parts = splitSpec({ name: "X", children: [group("Huge", 600), group("Ok", 10)] }); assert.deepEqual(parts.tooBig, ["Huge"]);
});
test("buildModel: sections are built in order, counts summed, errors collected, failure names the section", async () => {
  const sent = []; const exec = async (type, p) => { sent.push(p.spec.name); return { ok: true, result: { instances: countSpec(p.spec), parts: 3, path: "Workspace." + p.spec.name, errors: p.spec.name === "City" ? ["A.x: bad color"] : [], primary_part: "Hull", bounding_box: { size: [1, 1, 1] } } }; };
  const r = await buildModel({ spec: { name: "City", class: "Model", children: [group("A", 300), group("B", 300)] } }, exec);
  assert.equal(r.ok, true); assert.equal(r.result.sections, 2); assert.deepEqual(sent, ["City", "City_part2"]); assert.equal(r.result.error_count, 1);
  const fail = await buildModel({ spec: { name: "City", class: "Model", children: [group("A", 300), group("B", 300)] } }, async (t, p) => (p.spec.name === "City" ? { ok: true, result: { instances: 301, parts: 1, path: "W.City" } } : { ok: false, error: "boom" }));
  assert.equal(fail.ok, false); assert.match(fail.error, /section 2\/2 failed: boom/);
});
test("buildModel refuses to invent a count when the plugin answer has none (old plugin)", async () => {
  const r = await buildModel({ spec: group("M", 3) }, async () => ({ ok: true, result: "done" })); assert.equal(r.ok, false); assert.match(r.error, /no instance count/);
});
test("buildModel validates input", async () => { assert.equal((await buildModel({})).ok, false); assert.equal((await buildModel({ spec: { class: "Model" } })).ok, false); });

// ---- $n references ----
test("resolveRefs: whole-value refs keep their type, embedded refs interpolate, nesting works", () => {
  const res = [{ ok: true, result: { path: "Workspace.Yacht", instances: 12, bounding_box: { size: [12, 6, 48] } } }];
  assert.equal(resolveRefs("$1.path", res), "Workspace.Yacht"); assert.equal(resolveRefs("$1.instances", res), 12);
  assert.deepEqual(resolveRefs("$1.bounding_box.size", res), [12, 6, 48]);
  assert.equal(resolveRefs("under $1.path now", res), "under Workspace.Yacht now");
  assert.deepEqual(resolveRefs({ a: ["$1.path", { b: "$1.instances" }] }, res), { a: ["Workspace.Yacht", { b: 12 }] });
  assert.equal(resolveRefs("plain $text", res), "plain $text");
});
test("resolveRefs: a reference to a missing step, a failed step, or a missing field is an error (never silently empty)", () => {
  assert.throws(() => resolveRefs("$2.path", [{ ok: true, result: {} }]), /has not run/);
  assert.throws(() => resolveRefs("$1.path", [{ ok: false, error: "x" }]), /failed/);
  assert.throws(() => resolveRefs("$1.nope", [{ ok: true, result: { path: "a" } }]), /does not exist/);
});
test("batchRefs: later steps use earlier results; stops at the first failure and says which step", async () => {
  const log = []; const exec = async (type, p) => { log.push([type, p]); return type === "build_model" ? { ok: true, result: { path: "Workspace.Door" } } : type === "write_script" ? { ok: false, error: "lint failed" } : { ok: true, result: "ok" }; };
  const r = await batchRefs({ steps: [{ type: "build_model", payload: {} }, { type: "get_bounding_box", payload: { path: "$1.path" } }, { type: "write_script", payload: { path: "$1.path" } }, { type: "never", payload: {} }] }, exec);
  assert.equal(log[1][1].path, "Workspace.Door"); assert.equal(r.ok, false); assert.match(r.error, /step 3 \(write_script\) failed: lint failed/); assert.equal(r.completed, 2); assert.equal(log.length, 3);
});
test("batchRefs: bad reference fails BEFORE sending, and input is validated", async () => {
  let sent = 0; const exec = async () => { sent++; return { ok: true, result: {} }; };
  const r = await batchRefs({ steps: [{ type: "a", payload: { path: "$5.path" } }] }, exec); assert.equal(r.ok, false); assert.equal(sent, 0); assert.match(r.error, /step 1/);
  assert.equal((await batchRefs({}, exec)).ok, false); assert.equal((await batchRefs({ steps: Array(41).fill({ type: "a" }) }, exec)).ok, false);
});

// ---- guides + registry ----
import { SYSTEM, BUILDING_GUIDE, GAME_GUIDE, loadGuide } from "../src/loop.js";
import { TOOLS } from "../src/tools.js";
import { ALLOWED_PLUGIN_COMMANDS } from "./allowed.js";
test("guides are inside the system prompt and a malformed guide fails loudly", () => {
  assert.ok(SYSTEM.includes(BUILDING_GUIDE) && SYSTEM.includes(GAME_GUIDE));
  assert.throws(() => loadGuide("does-not-exist.md", []));
  assert.throws(() => loadGuide("building-guide.md", ["this phrase is not in the guide"]), /empty or malformed/);
});
test("every tool the guides mention exists in the registry (no instructions for tools that are not there)", () => {
  const mentioned = new Set([...(BUILDING_GUIDE + GAME_GUIDE).matchAll(/`((?:roblox_|vm_)[a-z_]+|plan_create|plan_update|build_model|build_from_template|template_save|template_load|screenshot_multi|snap_to_ground|terrain_fill|terrain_heightmap|lighting_set|ui_build|insert_asset|duplicate_[a-z_]+|find_empty_space|get_bounding_box|measure_distance|sync_mirror|push_changed|mirror|batch_refs)[ `]/g)].map((m) => m[1]));
  const missing = [...mentioned].filter((n) => !TOOLS[n]);
  assert.deepEqual(missing, [], "guide mentions tools that do not exist: " + missing);
});
test("every plugin-bound build tool maps to a command the SERVER allowlist accepts", () => {
  const sent = ["build_model","build_from_template","template_save","template_load","duplicate_array","duplicate_grid","duplicate_along_path","mirror","scale_model","align","distribute","snap_to_ground","get_bounding_box","get_pivot","raycast","find_empty_space","measure_distance","camera_set","screenshot_multi","terrain_fill","terrain_heightmap","lighting_set","ui_build","insert_asset"];
  const notAllowed = sent.filter((c) => !ALLOWED_PLUGIN_COMMANDS.has(c));
  assert.deepEqual(notAllowed, [], "server would reject: " + notAllowed);
});
