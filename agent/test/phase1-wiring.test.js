// PHASE 1 item 5, wiring. MOCK: the Studio side (api.command/api.result) is faked, so this proves the agent's tools call the guard, not that Studio accepts the writes.
import test from "node:test"; import assert from "node:assert/strict";
import { wrapUntrusted } from "../src/loop.js";
import { api } from "../src/api.js";

// Fake Studio: a map of path -> source. api.command/result are replaced so run() completes instantly.
const studio = new Map(); const sent = []; let nextId = 0; const results = new Map();
api.command = async (type, payload) => { const id = "c" + ++nextId; sent.push({ type, payload }); let r;
  if (type === "read_script") r = studio.has(payload.path) ? { source: studio.get(payload.path), class: "Script" } : null;
  else if (type === "write_script") { studio.set(payload.path, payload.source); r = { path: payload.path, bytes: payload.source.length }; }
  else if (type === "patch_script") { const s = studio.get(payload.path); studio.set(payload.path, s.replace(payload.find, payload.replace)); r = { patched: true }; }
  else r = {};
  results.set(id, r === null ? { status: "failed", error: "not a script" } : { status: "done", result: r }); return { id, status: "queued" }; };
api.result = async (id) => results.get(id);
const { TOOLS, deps, scriptGuard } = await import("../src/tools.js");
// STUB: luau-lsp/stylua are not installed in this sandbox, so the lint step is faked (always passes). This isolates the guard; it says nothing about lint quality.
deps.lint = async (src) => ({ passed: true, formatted: src, problems: [], errors: [], warnings: [], report: { analyzer: { tool: "STUB" }, file: "stub" }, hash: "stub" });
const T = (n) => TOOLS[n].fn;
const reset = () => { studio.clear(); sent.length = 0; scriptGuard.known.clear(); };

test("[mock] wrapUntrusted never cuts silently: it adds the explicit marker with counts", () => {
  const w = wrapUntrusted("z".repeat(9000));
  assert.match(w, /\[truncated 3000 of 9000 chars/); assert.match(w, /offset/);
});
test("[mock] wrapUntrusted leaves short text alone", () => { assert.ok(!wrapUntrusted("hello").includes("[truncated")); });
test("[mock] roblox_read_script returns a hash of the FULL source and the window it shows", async () => {
  reset(); studio.set("ServerScriptService.Big", "-- line\n".repeat(2000));
  const r = await T("roblox_read_script")({ path: "ServerScriptService.Big", limit: 1000 });
  assert.equal(r.ok, true); assert.equal(r.result.source.length, 1000); assert.equal(r.result.truncated, true); assert.match(r.result.hash, /^[0-9a-f]{16}$/); assert.equal(r.result.total_chars, 16000); assert.equal(r.result.next_offset, 1000);
});
test("[mock] overwriting an existing script without base_hash is refused and NOTHING is sent to Studio", async () => {
  reset(); studio.set("ServerScriptService.Main", "print('old')\n");
  const r = await T("roblox_write_script")({ path: "ServerScriptService.Main", source: "print('new')\n" });
  assert.equal(r.ok, false); assert.match(r.error, /base_hash/); assert.ok(!sent.some((s) => s.type === "write_script"));
  assert.equal(studio.get("ServerScriptService.Main"), "print('old')\n");
});
test("[mock] read all -> write with its hash works; the SAME hash is then stale", async () => {
  reset(); studio.set("ServerScriptService.Main", "print('old')\n");
  const rd = await T("roblox_read_script")({ path: "ServerScriptService.Main" });
  const w = await T("roblox_write_script")({ path: "ServerScriptService.Main", source: "print('new')\n", base_hash: rd.result.hash });
  assert.equal(w.ok, true, JSON.stringify(w)); assert.equal(studio.get("ServerScriptService.Main"), "print('new')\n");
  const again = await T("roblox_write_script")({ path: "ServerScriptService.Main", source: "print('third')\n", base_hash: rd.result.hash });
  assert.equal(again.ok, false);
});
test("[mock] a truncated read cannot be used to overwrite", async () => {
  reset(); studio.set("ServerScriptService.Big", "-- line\n".repeat(2000));
  const rd = await T("roblox_read_script")({ path: "ServerScriptService.Big", limit: 1000 });
  const w = await T("roblox_write_script")({ path: "ServerScriptService.Big", source: "print(1)\n", base_hash: rd.result.hash });
  assert.equal(w.ok, false); assert.match(w.error, /part|whole|offset/i); assert.ok(!sent.some((s) => s.type === "write_script"));
});
test("[mock] reading the rest with offset completes the read and unlocks the overwrite", async () => {
  reset(); const big = "-- line\n".repeat(2000); studio.set("ServerScriptService.Big", big);
  let off = 0, last; for (let i = 0; i < 40; i++) { last = await T("roblox_read_script")({ path: "ServerScriptService.Big", offset: off, limit: 7000 }); if (!last.result.truncated) break; off = last.result.next_offset; }
  const w = await T("roblox_write_script")({ path: "ServerScriptService.Big", source: "print(1)\n", base_hash: last.result.hash });
  assert.equal(w.ok, true, JSON.stringify(w));
});
test("[mock] creating a script that does not exist needs no hash", async () => {
  reset(); const w = await T("roblox_write_script")({ path: "ServerScriptService.Fresh", source: "print(1)\n", class: "Script" });
  assert.equal(w.ok, true, JSON.stringify(w));
});
test("[mock] patch_script on a script that was never read is refused", async () => {
  reset(); studio.set("ServerScriptService.Main", "print('old')\n");
  const r = await T("roblox_patch_script")({ path: "ServerScriptService.Main", find: "old", replace: "new" });
  assert.equal(r.ok, false); assert.match(r.error, /read/i); assert.equal(studio.get("ServerScriptService.Main"), "print('old')\n");
});
test("[mock] vm_read_file supports offset/limit and reports the marker instead of silently clipping", async () => {
  const { writeFile, mkdir } = await import("node:fs/promises"); const { WORK } = await import("../src/tools.js");
  await mkdir(WORK, { recursive: true }).catch(() => {});
  const p = `${WORK}/_p1_big.txt`; try { await writeFile(p, "k".repeat(25000)); } catch { return; }
  const r = await T("vm_read_file")({ path: "_p1_big.txt", limit: 4000 });
  assert.equal(r.ok, true); assert.equal(r.result.content.length, 4000); assert.equal(r.result.truncated, true); assert.match(r.result.marker, /\[truncated 21000 of 25000 chars/); assert.equal(r.result.next_offset, 4000);
});
