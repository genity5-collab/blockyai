import { test } from "node:test"; import assert from "node:assert/strict";
import { compactMessages, estimateChars, makeStopFlag } from "../src/context.js";

const sys = { role: "system", content: "SYSTEM RULES " + "s".repeat(500) };
const big = (tag, n) => `TOOL RESULT ${tag}\n` + "x".repeat(n) + `\nEND ${tag}`;
const turn = (i, n) => [{ role: "assistant", content: `call ${i}` }, { role: "user", content: big(i, n) }];
const build = (turns, n) => [sys, { role: "user", content: "Build me a yacht please" }, ...Array.from({ length: turns }, (_, i) => turn(i, n)).flat()];

test("[mock] item 12: a short conversation is returned untouched", () => {
  const m = build(2, 200); const out = compactMessages(m, { maxChars: 100000 });
  assert.deepEqual(out.messages, m); assert.equal(out.compacted, 0);
});
test("[mock] item 12: a long run is brought under the budget", () => {
  const m = build(40, 6000); assert.ok(estimateChars(m) > 200000);
  const out = compactMessages(m, { maxChars: 60000 });
  assert.ok(estimateChars(out.messages) <= 60000, `still ${estimateChars(out.messages)}`); assert.ok(out.compacted > 0);
});
test("[mock] item 12: the system prompt and the user's original request are NEVER changed", () => {
  const out = compactMessages(build(40, 6000), { maxChars: 40000 }).messages;
  assert.equal(out[0].content, sys.content); assert.equal(out[1].content, "Build me a yacht please");
});
test("[mock] item 12: the most recent tool results stay full size", () => {
  const m = build(40, 6000); const out = compactMessages(m, { maxChars: 60000, keepRecent: 4 }).messages;
  for (let k = 1; k <= 4; k++) assert.equal(out[out.length - k].content, m[m.length - k].content, `recent message ${k} was shortened`);
});
test("[mock] item 12: shortened results say they were shortened and keep their start and end", () => {
  const out = compactMessages(build(40, 6000), { maxChars: 60000 }).messages;
  const old = out[3]; assert.match(old.content, /shortened/i); assert.match(old.content, /TOOL RESULT 0/); assert.match(old.content, /END 0/);
});
test("[mock] item 12: assistant messages (the model's own tool calls) are never rewritten", () => {
  const m = build(40, 6000); const out = compactMessages(m, { maxChars: 40000 }).messages;
  m.forEach((x, i) => { if (x.role === "assistant") assert.equal(out[i].content, x.content); });
});
test("[mock] item 12: same number of messages, same roles, same order (nothing dropped or reordered)", () => {
  const m = build(40, 6000); const out = compactMessages(m, { maxChars: 40000 }).messages;
  assert.equal(out.length, m.length); assert.deepEqual(out.map((x) => x.role), m.map((x) => x.role));
});
test("[mock] item 12: compacting twice gives the same result and the input is not mutated", () => {
  const m = build(40, 6000); const snapshot = JSON.stringify(m);
  const a = compactMessages(m, { maxChars: 60000 }); const b = compactMessages(a.messages, { maxChars: 60000 });
  assert.equal(JSON.stringify(m), snapshot); assert.deepEqual(b.messages, a.messages); assert.equal(b.compacted, 0);
});
test("[mock] item 12: a huge message that is also the newest one is kept (never lose the latest result)", () => {
  const m = [...build(3, 200), { role: "assistant", content: "call" }, { role: "user", content: big("LATEST", 90000) }];
  const out = compactMessages(m, { maxChars: 30000, keepRecent: 2 }).messages; assert.equal(out[out.length - 1].content, m[m.length - 1].content);
});
test("[mock] item 12: gives up honestly when it cannot fit (reports over_budget instead of lying)", () => {
  const m = build(2, 200); m[1] = { role: "user", content: "u".repeat(100000) };
  const out = compactMessages(m, { maxChars: 1000 }); assert.equal(out.over_budget, true);
});
test("[mock] item 12: odd input never throws (non-string content, empty list)", () => {
  assert.doesNotThrow(() => compactMessages([], { maxChars: 10 })); assert.doesNotThrow(() => compactMessages([sys, { role: "user", content: null }, { role: "user" }], { maxChars: 10 }));
});

test("[mock] item 12: the stop flag asks the server at most once per interval, not on every check", async () => {
  let asked = 0, t = 0; const f = makeStopFlag({ ask: async () => (asked++, false), now: () => t, minIntervalMs: 1500 });
  for (let i = 0; i < 50; i++) await f(); assert.equal(asked, 1);
  t = 1600; await f(); assert.equal(asked, 2);
});
test("[mock] item 12: once Stop is seen it stays stopped without asking again", async () => {
  let asked = 0, t = 0, stop = false; const f = makeStopFlag({ ask: async () => (asked++, stop), now: () => t, minIntervalMs: 1500 });
  assert.equal(await f(), false); stop = true; t = 2000; assert.equal(await f(), true);
  t = 9000; assert.equal(await f(), true); assert.equal(asked, 2);
});
test("[mock] item 12: if the stop query fails it does NOT stop the run (and does not hammer the server)", async () => {
  let asked = 0, t = 0; const f = makeStopFlag({ ask: async () => { asked++; throw new Error("network"); }, now: () => t, minIntervalMs: 1500 });
  assert.equal(await f(), false); assert.equal(await f(), false); assert.equal(asked, 1);
});
test("[mock] item 12: a stop that arrives between two checks is seen at the next interval", async () => {
  let t = 0, stop = false; const f = makeStopFlag({ ask: async () => stop, now: () => t, minIntervalMs: 1500 });
  await f(); stop = true; t = 700; assert.equal(await f(), false, "too soon to ask again"); t = 1600; assert.equal(await f(), true);
});
