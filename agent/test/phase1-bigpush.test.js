// Reproduces a REAL data-loss bug found while wiring item 5: lintLuau() re-reads the formatted file through vmRead(), which clips at 20,000 chars,
// and roblox_write_script then pushes THAT text. A longer script passes lint and is pushed truncated, with no error.
// MOCK for the lint tools (not installed in this sandbox); the clipping is real code under test.
import test from "node:test"; import assert from "node:assert/strict";
import { vmRead, vmWrite, WORK } from "../src/tools.js";

test("[mock] vmRead of a 30,000-char file used by the lint/push path returns ALL of it (raw read)", async () => {
  const body = "local x = 1 -- padding padding padding\n".repeat(800);   // ~31k chars
  assert.ok(body.length > 25000);
  await vmWrite("lint/_p1_big.luau", body);
  const r = await vmRead("lint/_p1_big.luau", { raw: true });
  assert.equal(r.ok, true); assert.equal(r.result.content.length, body.length, "a push path must never receive a clipped file");
  assert.equal(r.result.content, body);
});
