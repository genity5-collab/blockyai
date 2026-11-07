import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYSTEM, POLICY, loadPolicy, toolFamily, summarizeArgs, handleUserMessage } from "../src/loop.js";
import { hashSource, countLines, parseDiagnostics, mirrorFile, instFromMirrorFile, lintLedger, LINT_LINE_THRESHOLD, TOOLS } from "../src/tools.js";

test("policy file is loaded and is part of the system prompt", () => {
  assert.ok(POLICY.includes("roblox_* tools change the live game") || POLICY.includes("roblox_\\* tools change the live game"));
  assert.ok(SYSTEM.includes(POLICY), "full policy text must be in SYSTEM");
  for (const must of ["vm_lint_luau", "sync_mirror", "push_changed", "Never claim a change is live because a file was written in the VM", "untrusted"]) assert.ok(SYSTEM.includes(must), "missing: " + must);
});
test("a missing or empty policy file FAILS LOUDLY instead of starting without rules", () => {
  assert.throws(() => loadPolicy("/nonexistent/vm-policy.md"));
  const d = mkdtempSync(join(tmpdir(), "pol-")); const f = join(d, "p.md"); writeFileSync(f, "short");
  assert.throws(() => loadPolicy(f), /empty or malformed/);
});
test("every registered tool is classed vm / roblox / local, and the new tools exist", () => {
  for (const n of ["vm_exec", "vm_read_file", "vm_write_file", "vm_lint_luau", "sync_mirror", "push_changed"]) { assert.ok(TOOLS[n], n + " missing"); assert.equal(toolFamily(n), "vm", n); }
  for (const n of Object.keys(TOOLS).filter((x) => x.startsWith("roblox_"))) assert.equal(toolFamily(n), "roblox", n);
});
test("line counting ignores the trailing newline", () => { assert.equal(countLines("a\nb\n"), 2); assert.equal(countLines("a\nb"), 2); assert.equal(countLines(Array(31).fill("x").join("\n")), 31); });
test("hash is stable and content-sensitive", () => { assert.equal(hashSource("abc"), hashSource("abc")); assert.notEqual(hashSource("abc"), hashSource("abd")); });
test("parseDiagnostics splits errors from warnings and keeps line numbers", () => {
  const out = "[INFO] x\n/f.luau(3,1): TypeError: Key 'Sizee' not found in external type 'Part'\n/f.luau(1,11): SyntaxError: bad\n/f.luau(2,7): LocalUnused: unused\n";
  const d = parseDiagnostics(out, "/f.luau");
  assert.deepEqual(d.errors.map((e) => [e.line, e.kind]), [[3, "TypeError"], [1, "SyntaxError"]]); assert.equal(d.warnings[0].kind, "LocalUnused");
});
test("mirror paths preserve the instance path as folders and round trip", () => {
  const f = mirrorFile("ServerScriptService.Game.Main", "Script");
  assert.equal(f, "/home/ubuntu/project/mirror/ServerScriptService/Game/Main.Script.luau");
  assert.deepEqual(instFromMirrorFile(f), { path: "ServerScriptService.Game.Main", cls: "Script" });
  assert.ok(!mirrorFile("A.B.C", "ModuleScript").includes(".."));
});

// ---- the 30-line guard on roblox_write_script ----
const big = (n) => Array.from({ length: n }, (_, i) => `print(${i})`).join("\n") + "\n";
test("GUARD: a script over 30 lines with NO prior lint is refused, with a message that names vm_lint_luau", async () => {
  lintLedger.clear();
  const r = await TOOLS.roblox_write_script.fn({ path: "ServerScriptService.Big", source: big(31) });
  assert.equal(r.ok, false); assert.match(r.error, /REFUSED/); assert.match(r.error, /vm_lint_luau/); assert.ok(r.error.includes(hashSource(big(31))));
});
test("GUARD: the limit is 30 lines (31 refused)", () => assert.equal(LINT_LINE_THRESHOLD, 30));
test("GUARD: a ledger entry for DIFFERENT content does not unlock a script", async () => {
  lintLedger.clear(); lintLedger.set(hashSource(big(40)), { passed: true });
  const r = await TOOLS.roblox_write_script.fn({ path: "X.Y", source: big(35) });
  assert.equal(r.ok, false); assert.match(r.error, /REFUSED/);
});
test("GUARD: a FAILED lint entry does not unlock a script", async () => {
  lintLedger.clear(); lintLedger.set(hashSource(big(35)), { passed: false });
  const r = await TOOLS.roblox_write_script.fn({ path: "X.Y", source: big(35) });
  assert.equal(r.ok, false); assert.match(r.error, /REFUSED/);
});
test("empty source is rejected before anything else", async () => assert.equal((await TOOLS.roblox_write_script.fn({ path: "A.B", source: "  " })).ok, false));

// ---- audit log ----
test("every tool call is logged with name, args summary, duration and ok/error", async () => {
  const logged = []; let n = 0;
  const llm = async () => ({ content: n++ === 0 ? '<tool>{"name":"vm_exec","args":{"command":"ls"}}</tool><tool>{"name":"roblox_get_tree","args":{}}</tool>' : "done" });
  const tools = { vm_exec: { fn: async () => ({ ok: true, result: "x" }) }, roblox_get_tree: { fn: async () => ({ ok: true, result: "y" }) } };
  await handleUserMessage([], "go", { llm, tools, messageId: "11111111-1111-1111-1111-111111111111", log: (r) => logged.push(r), say: async () => ({ id: "m" }), update: async () => {} });
  assert.deepEqual(logged.map((l) => l.name), ["vm_exec", "roblox_get_tree"]); assert.deepEqual(logged.map((l) => l.seq), [0, 1]);
  assert.ok(logged.every((l) => typeof l.duration_ms === "number" && l.ok === true && l.run_id && l.message_id));
  assert.equal(JSON.parse(logged[0].args_summary).command, "ls");
});
test("a FAILED call is logged with its raw error", async () => {
  const logged = [];
  await handleUserMessage([], "go", { llm: async () => ({ content: '<tool>{"name":"roblox_get_tree","args":{}}</tool>' }), tools: { roblox_get_tree: { fn: async () => ({ ok: false, error: "plugin did not respond" }) } }, log: (r) => logged.push(r), say: async () => ({ id: "m" }), update: async () => {} });
  assert.equal(logged[0].ok, false); assert.equal(logged[0].error, "plugin did not respond");
});
test("a throwing logger can never break or fake a run", async () => {
  const posted = []; let n = 0;
  await handleUserMessage([], "go", { llm: async () => ({ content: n++ === 0 ? '<tool>{"name":"vm_exec","args":{}}</tool>' : "finished" }), tools: { vm_exec: { fn: async () => ({ ok: true, result: "" }) } }, log: () => { throw new Error("db down"); }, say: async (r, c) => { posted.push(c); return { id: "m" }; }, update: async () => {} });
  assert.equal(posted.at(-1), "finished");
});
test("command cards carry the family so the UI can badge them", async () => {
  const seen = []; let n = 0;
  await handleUserMessage([], "go", { llm: async () => ({ content: n++ === 0 ? '<tool>{"name":"vm_exec","args":{}}</tool><tool>{"name":"roblox_get_tree","args":{}}</tool>' : "ok" }), tools: { vm_exec: { fn: async () => ({ ok: true }) }, roblox_get_tree: { fn: async () => ({ ok: true }) } }, log: () => {}, say: async (r, c, tc) => { if (tc) seen.push(...tc.map((x) => [x.name, x.family])); return { id: "m" }; }, update: async (id, c, tc) => { if (tc) seen.push(...tc.map((x) => [x.name, x.family])); } });
  assert.ok(seen.some(([n, f]) => n === "vm_exec" && f === "vm") && seen.some(([n, f]) => n === "roblox_get_tree" && f === "roblox"));
});
test("long script source is never stored in the audit log", () => {
  const s = summarizeArgs({ path: "A.B", source: "x".repeat(5000) }); assert.ok(s.length < 300); assert.ok(!s.includes("x".repeat(100)));
});
