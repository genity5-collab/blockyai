// The site must not believe "running" for a computer that no longer exists. A clear "not found" from the provider means it is gone;
// a network blip or any other error means we do not know, and we must NOT declare it gone.
import test from "node:test"; import assert from "node:assert/strict";
import { liveStateOf } from "../functions/_shared/vmlive.js";

test("a running computer is reported as running", () => { assert.deepEqual(liveStateOf({ data: { state: "running" } }), { live: "running", gone: false }); });
test("a suspended or stopped computer is reported as it is, not as gone", () => {
  assert.deepEqual(liveStateOf({ data: { state: "suspended" } }), { live: "suspended", gone: false });
  assert.deepEqual(liveStateOf({ data: { state: "stopped" } }), { live: "stopped", gone: false });
});
test("a 'not found' from the provider means the computer is gone", () => {
  for (const e of [new Error("not found: vm vm-1c44"), { status: 404, message: "x" }, { statusCode: 404 }, new Error("VM_NOT_FOUND"), { code: "VM_NOT_FOUND" }]) {
    const r = liveStateOf({ error: e }); assert.equal(r.gone, true, JSON.stringify(e)); assert.equal(r.live, "gone");
  }
});
test("a network error or server error is NOT proof the computer is gone", () => {
  for (const e of [new Error("fetch failed"), new Error("timeout"), { status: 500, message: "x" }, { status: 503 }, { status: 429, message: "slow down" }, new Error("ECONNRESET")]) {
    const r = liveStateOf({ error: e }); assert.equal(r.gone, false, String(e.message ?? e.status)); assert.equal(r.live, "unknown");
  }
});
test("a deleted-looking state is gone", () => { for (const s of ["deleted", "destroyed", "terminated"]) assert.equal(liveStateOf({ data: { state: s } }).gone, true, s); });
test("no data and no error is unknown, never gone", () => { for (const x of [{}, null, undefined, { data: null }, { data: {} }]) assert.deepEqual(liveStateOf(x), { live: "unknown", gone: false }); });
test("the state text is cleaned: only a short lowercase word is passed on", () => { assert.equal(liveStateOf({ data: { state: "RUNNING" } }).live, "running"); assert.equal(liveStateOf({ data: { state: "<b>x</b>".repeat(20) } }).live, "unknown"); });
