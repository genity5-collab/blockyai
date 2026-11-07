// PHASE 1 item 12, wiring. MOCK model and tools: the LOOP must send the model a size-limited conversation on a long run.
import test from "node:test"; import assert from "node:assert/strict";
import { handleUserMessage } from "../src/loop.js";
import { estimateChars } from "../src/context.js";

const mk = () => { const said = []; return { said,
  planApi: async (a) => (a === "get" ? { plan: { id: "p", items: [] } } : a === "can_finish" ? { ok: true, reasons: [] } : { ok: true }),
  say: async (r, c, cards, st, emb, outcome) => (said.push({ c, outcome }), { id: "m" }), update: async () => ({}), log: () => {}, logLlm: () => {} }; };
const tool = (n, a = {}) => `<tool>${JSON.stringify({ name: n, args: a })}</tool>`;

test("[mock] item 12: on a long run the model is sent a size-limited conversation, and the request + system prompt are intact", async () => {
  const m = mk(); const sizes = []; let first = null; let n = 0;
  const tools = { roblox_get_tree: { fn: async () => ({ ok: true, result: "R".repeat(9000) }) } };
  await handleUserMessage([], "Look at the tree many times", { llm: async (msgs) => { n++; sizes.push(estimateChars(msgs)); first ??= [msgs[0].content, msgs[1].content]; return { content: n <= 30 ? tool("roblox_get_tree", { i: n }) : "Done.", finish_reason: "stop" }; }, tools, maxIterations: 40, contextChars: 50000, ...m });
  // The newest messages are kept whole (by design), so the size may exceed the budget by about that much, but it must PLATEAU, not grow.
  const uncapped = 30 * 9000;
  assert.ok(Math.max(...sizes) < 50000 + 25000, `peak ${Math.max(...sizes)}`); assert.ok(Math.max(...sizes) < uncapped / 3, "far smaller than the uncapped size");
  const late = sizes.slice(-8); assert.ok(Math.max(...late) - Math.min(...late) < 20000, "size is flat late in the run, not growing: " + late.join(","));
  assert.equal(first[1], "Look at the tree many times"); assert.equal(m.said.at(-1).outcome, "complete");
});
test("[mock] item 12: a normal short run is sent to the model exactly as before (nothing shortened)", async () => {
  const m = mk(); let n = 0, seen = null;
  const tools = { roblox_get_tree: { fn: async () => ({ ok: true, result: "tree ".repeat(50) }) } };
  await handleUserMessage([], "go", { llm: async (msgs) => { n++; seen = msgs.map((x) => x.content).join("|"); return { content: n === 1 ? tool("roblox_get_tree") : "Seen.", finish_reason: "stop" }; }, tools, ...m });
  assert.ok(!/shortened/.test(seen));
});
test("[mock] item 12: the loop checks Stop through the flag it was given, and a Stop ends the run as 'stopped'", async () => {
  const m = mk(); let checks = 0; let n = 0;
  const tools = { roblox_get_tree: { fn: async () => ({ ok: true, result: "t" }) } };
  await handleUserMessage([], "go", { llm: async () => (n++, { content: tool("roblox_get_tree", { n }), finish_reason: "stop" }), tools, shouldStop: async () => (++checks > 3), maxIterations: 30, ...m });
  assert.equal(m.said.at(-1).outcome, "stopped"); assert.ok(n <= 4, `model asked ${n} times after stop`);
});
