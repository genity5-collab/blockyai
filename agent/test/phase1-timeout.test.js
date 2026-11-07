// PHASE 1 item 10 (agent side). MOCK API: a fake queue. Proves what the agent does about a command it gave up on.
import test from "node:test"; import assert from "node:assert/strict";
import { api } from "../src/api.js";
import { run, NO_ACK_WAIT_MS } from "../src/tools.js";

// Fake server queue: commands by id; api.result reports their state; api.cancel records cancels (and only succeeds for queued ones, like the real server).
const mkQueue = (behaviour) => { const cmds = new Map(), cancels = [], created = []; let n = 0;
  api.command = async (type, payload, key) => { const prior = [...cmds.values()].find((c) => c.key === key); if (prior) return { id: prior.id, status: prior.status, deduped: true };
    const c = { id: "c" + ++n, key, type, status: "queued", polls: 0 }; cmds.set(c.id, c); created.push(c); return { id: c.id, status: "queued" }; };
  api.result = async (id) => { const c = cmds.get(id); c.polls++; behaviour(c); return { ...c }; };
  api.cancel = async (id) => { cancels.push(id); const c = cmds.get(id); const wasQueued = c.status === "queued"; if (wasQueued) c.status = "cancelled"; return { ok: true, cancelled: wasQueued, status: c.status }; };
  return { cmds, cancels, created }; };

test("[mock] item 10: when a QUEUED command is given up on, the agent cancels it so it can never run later", async () => {
  const q = mkQueue(() => {});                       // the plugin never claims anything
  const r = await run("create", { class: "Part" }, { noAckWaitMs: 60, pollMs: 5 });
  assert.equal(r.ok, false); assert.deepEqual(q.cancels, ["c1"], "the abandoned command was cancelled");
  assert.equal(q.cmds.get("c1").status, "cancelled"); assert.equal(r.cancelled, true);
});
test("[mock] item 10: a command the plugin is already RUNNING cannot be recalled; the agent says so honestly", async () => {
  const q = mkQueue((c) => { c.status = "running"; c.acked_at ??= new Date().toISOString(); c.timeout_s = 0; });   // ACKed once, like the real plugin
  const r = await run("build_model", {}, { noAckWaitMs: 60, pollMs: 5, graceMs: 20 });
  assert.equal(r.ok, false); assert.equal(r.state, "running"); assert.equal(r.cancelled, false, "a running command was NOT cancelled");
  assert.match(r.error, /may still (be running|finish)|still running in Studio/i, "the error must warn the game may still change");
});
test("[mock] item 10: a given-up READ is cancelled too (no stray commands pile up)", async () => {
  const q = mkQueue(() => {}); await run("get_tree", {}, { noAckWaitMs: 40, pollMs: 5 }); assert.equal(q.cancels.length, 1);
});
test("[mock] item 10: a finished command is never cancelled", async () => {
  const q = mkQueue((c) => { c.status = "done"; c.result = { ok: 1 }; }); const r = await run("get_tree", {}, { noAckWaitMs: 200, pollMs: 5 });
  assert.equal(r.ok, true); assert.equal(q.cancels.length, 0);
});
test("[mock] item 10: the SAME idempotency key reuses the command instead of creating a duplicate", async () => {
  const q = mkQueue((c) => { c.status = "done"; c.result = 1; });
  await run("create", { a: 1 }, { idempotency_key: "K1", pollMs: 5 }); await run("create", { a: 1 }, { idempotency_key: "K1", pollMs: 5 });
  assert.equal(q.created.length, 1, "one command created, not two");
});
test("[mock] item 10: a failed/expired command is not cancelled", async () => {
  const q = mkQueue((c) => { c.status = "failed"; c.error = "boom"; }); await run("create", {}, { pollMs: 5 }); assert.equal(q.cancels.length, 0);
});
