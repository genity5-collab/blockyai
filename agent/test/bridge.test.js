import test from "node:test"; import assert from "node:assert/strict";
import { api } from "../src/api.js";
import { run, describeWait } from "../src/tools.js";
import { HARD_FAILURE } from "../src/loop.js";

// Replace the network with a scripted sequence of command states. NOTHING here talks to a real server.
function script(states, { enqueue = { id: "11111111-1111-1111-1111-111111111111", status: "queued", needs_confirm: false } } = {}) {
  let i = 0, enqueued = []; 
  api.command = async (type, payload, key) => { enqueued.push({ type, payload, key }); return enqueue; };
  api.result = async () => { const s = states[Math.min(i++, states.length - 1)]; await new Promise((r) => setTimeout(r, 1)); return s; };
  return enqueued;
}
const FAST = (fn) => async () => { const real = Date.now; try { return await fn(); } finally { Date.now = real; } };

test("done: returns the result and the command id", async () => {
  script([{ status: "claimed" }, { status: "running", acked_at: new Date().toISOString(), timeout_s: 60 }, { status: "done", result: { n: 3 } }]);
  const r = await run("get_tree", {}); assert.equal(r.ok, true); assert.deepEqual(r.result, { n: 3 });
});
test("every call carries an idempotency key; a caller-supplied key is passed through unchanged", async () => {
  const sent = script([{ status: "done", result: {} }]); await run("create", { a: 1 }); assert.match(sent[0].key, /^[0-9a-f-]{36}$/);
  const sent2 = script([{ status: "done", result: {} }]); await run("create", { a: 1 }, { idempotency_key: "retry-7" }); assert.equal(sent2[0].key, "retry-7");
});
test("failed: raw plugin error is returned verbatim", async () => {
  script([{ status: "failed", error: "parent not found: Workspace.Nope" }]); const r = await run("create", {}); assert.equal(r.ok, false); assert.equal(r.error, "parent not found: Workspace.Nope");
});
test("EXPIRED is reported as 'plugin not responding' with the attempt count, and is a HARD failure", async () => {
  script([{ status: "expired", error: "lease expired 3 times; the plugin never finished it", attempts: 3 }]);
  const r = await run("build_model", {}); assert.equal(r.ok, false); assert.equal(r.expired, true); assert.match(r.error, /plugin not responding/); assert.match(r.error, /3 attempt/);
  assert.ok(HARD_FAILURE.test(r.error), "the loop must stop on this, not retry forever");
});
test("describeWait: the three situations give three different messages", () => {
  assert.equal(describeWait({ status: "queued" }), "plugin not responding");
  assert.equal(describeWait({ status: "claimed" }), "plugin claimed the command but has not acknowledged it");
  assert.equal(describeWait({ status: "running" }), "plugin busy");
  assert.equal(describeWait({ status: "queued", needs_confirm: true, confirmed: false }), "waiting for user confirmation");
});
test("'plugin busy' is NOT a hard failure (the plugin is alive); 'not responding' and approval waits are", () => {
  assert.equal(HARD_FAILURE.test("plugin busy (command x, state running, waited 90s)"), false);
  assert.ok(HARD_FAILURE.test("plugin not responding (command x, state queued, waited 45s)"));
  assert.ok(HARD_FAILURE.test("waiting for user confirmation (command x, state queued)"));
});
test("acked + running keeps waiting past the no-ack window (busy is not dead)", async () => {
  // time-travel: the no-ack window is 45s, so make Date.now jump while the plugin reports 'running' with a long timeout
  const realNow = Date.now; let t = realNow(); Date.now = () => (t += 20_000);
  try {
    let polls = 0; api.command = async () => ({ id: "22222222-2222-2222-2222-222222222222", status: "queued" });
    api.result = async () => { polls++; if (polls < 8) return { status: "running", acked_at: new Date(t).toISOString(), timeout_s: 240 }; return { status: "done", result: { built: 1 } }; };
    const r = await run("build_model", {}); assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(polls >= 8);
  } finally { Date.now = realNow; }
});
test("never claimed: gives up after the no-ack window with 'plugin not responding' and the state", async () => {
  const realNow = Date.now; let t = realNow(); Date.now = () => (t += 15_000);
  try {
    api.command = async () => ({ id: "33333333-3333-3333-3333-333333333333", status: "queued" }); api.result = async () => ({ status: "queued", needs_confirm: false });
    const r = await run("get_tree", {}); assert.equal(r.ok, false); assert.match(r.error, /^plugin not responding/); assert.match(r.error, /state queued/);
  } finally { Date.now = realNow; }
});
test("waiting for approval is reported as such, not as a dead plugin", async () => {
  const realNow = Date.now; let t = realNow(); Date.now = () => (t += 30_000);
  try {
    api.command = async () => ({ id: "44444444-4444-4444-4444-444444444444", status: "queued", needs_confirm: true }); api.result = async () => ({ status: "queued", needs_confirm: true, confirmed: false });
    const r = await run("delete", { paths: ["Workspace.A"] }); assert.equal(r.ok, false); assert.match(r.error, /^waiting for user confirmation/);
  } finally { Date.now = realNow; }
});
