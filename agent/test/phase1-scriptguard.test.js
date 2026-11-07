// PHASE 1 item 5. MOCK (fake tools, no Studio). Proves the agent-side guard logic; the real plugin handlers are untouched.
import test from "node:test"; import assert from "node:assert/strict";
import { sha, windowText, ScriptGuard, TRUNC_MARK } from "../src/scriptguard.js";

test("[mock] windowText returns a loud marker with the exact remaining range when it cuts", () => {
  const text = "a".repeat(10000);
  const w = windowText(text, { offset: 0, limit: 6000 });
  assert.equal(w.text.length, 6000); assert.equal(w.truncated, true); assert.equal(w.total, 10000); assert.equal(w.next_offset, 6000);
  assert.match(w.marker, /\[truncated 4000 of 10000 chars/); assert.match(w.marker, /offset=6000/);
});
test("[mock] windowText: no marker when everything fits; offset past the end is an error-free empty window", () => {
  assert.equal(windowText("short", {}).marker, ""); assert.equal(windowText("short", {}).truncated, false);
  const e = windowText("abc", { offset: 99 }); assert.equal(e.text, ""); assert.equal(e.truncated, false); assert.equal(e.total, 3);
});
test("[mock] windowText clamps hostile offset/limit", () => {
  assert.equal(windowText("abcdef", { offset: -5, limit: 2 }).text, "ab"); assert.equal(windowText("abcdef", { offset: "x", limit: "y" }).text, "abcdef");
  assert.equal(windowText("abcdef", { offset: 1, limit: 99999999 }).text, "bcdef"); assert.equal(windowText("abcdef", { limit: 0 }).text, "abcdef");
});
test("[mock] windowing is lossless: concatenating windows rebuilds the original", () => {
  const t = Array.from({ length: 500 }, (_, i) => `line ${i} é日😀\n`).join("");
  let off = 0, out = ""; for (let n = 0; n < 200; n++) { const w = windowText(t, { offset: off, limit: 777 }); out += w.text; if (!w.truncated) break; off = w.next_offset; }
  assert.equal(out, t);
});

const g = () => new ScriptGuard();
test("[mock] overwrite of a script that was never read is refused, with the exact next step", () => {
  const x = g(); const r = x.checkWrite("ServerScriptService.A", { exists: true, base_hash: undefined });
  assert.equal(r.ok, false); assert.match(r.error, /base_hash/); assert.match(r.error, /roblox_read_script/);
});
test("[mock] creating a NEW script needs no base_hash", () => { assert.equal(g().checkWrite("ServerScriptService.New", { exists: false }).ok, true); });
test("[mock] overwrite with the hash from the last FULL read is allowed", () => {
  const x = g(); const h = x.recordRead("S.A", "print(1)\n", { complete: true });
  assert.equal(x.checkWrite("S.A", { exists: true, base_hash: h }).ok, true);
});
test("[mock] a stale hash (script changed since the read) is refused and says so", () => {
  const x = g(); const h = x.recordRead("S.A", "v1", { complete: true }); x.recordRead("S.A", "v2", { complete: true });
  const r = x.checkWrite("S.A", { exists: true, base_hash: h }); assert.equal(r.ok, false); assert.match(r.error, /stale|changed/i);
});
test("[mock] a made-up hash is refused", () => { const x = g(); x.recordRead("S.A", "v1", { complete: true }); assert.equal(x.checkWrite("S.A", { exists: true, base_hash: "deadbeefdeadbeef" }).ok, false); });
test("[mock] a PARTIAL read cannot unlock an overwrite: you must have read the whole script", () => {
  const x = g(); const h = x.recordRead("S.A", "x".repeat(100), { complete: false });
  const r = x.checkWrite("S.A", { exists: true, base_hash: h }); assert.equal(r.ok, false); assert.match(r.error, /whole script|all of it|offset/i);
});
test("[mock] reading windows one after another completes the read", () => {
  const x = g(); const text = "y".repeat(10000);
  x.recordWindow("S.A", text, { offset: 0, next_offset: 6000, truncated: true }); assert.equal(x.checkWrite("S.A", { exists: true, base_hash: sha(text) }).ok, false);
  x.recordWindow("S.A", text, { offset: 6000, next_offset: 10000, truncated: false }); assert.equal(x.checkWrite("S.A", { exists: true, base_hash: sha(text) }).ok, true);
});
test("[mock] after a successful write the new content hash is the base for the next edit", () => {
  const x = g(); const h1 = x.recordRead("S.A", "v1", { complete: true }); assert.equal(x.checkWrite("S.A", { exists: true, base_hash: h1 }).ok, true);
  const h2 = x.recordWrite("S.A", "v2"); assert.equal(x.checkWrite("S.A", { exists: true, base_hash: h2 }).ok, true); assert.equal(x.checkWrite("S.A", { exists: true, base_hash: h1 }).ok, false);
});
test("[mock] paths are matched case-insensitively and Game/game/slash forms map to the same script", () => {
  const x = g(); const h = x.recordRead("game.ServerScriptService.Main", "q", { complete: true });
  assert.equal(x.checkWrite("ServerScriptService/Main", { exists: true, base_hash: h }).ok, true);
  assert.equal(x.checkWrite("Game.serverscriptservice.main", { exists: true, base_hash: h }).ok, true);
});
test("[mock] hash is stable and 16 hex chars", () => { assert.match(sha("x"), /^[0-9a-f]{16}$/); assert.equal(sha("x"), sha("x")); assert.notEqual(sha("x"), sha("y")); });
