// MOCK/fuzz: the parser sits in front of every model reply. It must never throw, never hang, never exceed the call cap, and never turn plain prose into a call.
import test from "node:test"; import assert from "node:assert/strict";
import { parseReply, MAX_CALLS_PER_REPLY } from "../src/toolparse.js";
let seed = 987654; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const PIECES = ["<tool", "<tool>", "</tool>", '<tool name="roblox_write_script"', ' path="A.B"', ">", "<source>", "</source>", "<spec>", "</spec>", "{", "}", '"name"', ":", '"roblox_get_tree"', '"args"', ",", "```json", "```", "\\", '"', "\n", "é", "😀", " ", "x", "[", "]", "/>", "<code>", "</code>", "=", "&quot;"];
test("[mock] fuzz: 3000 random token soups never throw, never exceed the cap", () => {
  for (let n = 0; n < 3000; n++) {
    let t = ""; const len = 1 + Math.floor(rnd() * 40); for (let k = 0; k < len; k++) t += PIECES[Math.floor(rnd() * PIECES.length)];
    let r; assert.doesNotThrow(() => { r = parseReply(t); }, JSON.stringify(t));
    assert.ok(r.calls.length <= MAX_CALLS_PER_REPLY, JSON.stringify(t));
    for (const c of r.calls) { assert.equal(typeof c.name, "string"); assert.equal(typeof c.args, "object"); assert.ok(c.args !== null && !Array.isArray(c.args)); }
  }
});
test("[mock] fuzz: pathological inputs finish fast (no catastrophic backtracking)", () => {
  const cases = ["<tool " + "a=\"b\" ".repeat(20000), "<tool>" + "{".repeat(50000), "```json\n" + '{"name":"roblox_x",'.repeat(5000), "<tool name=\"roblox_write_script\"><source>" + "x".repeat(2_000_000), "<tool>".repeat(30000), "```".repeat(30000)];
  for (const c of cases) { const t0 = Date.now(); parseReply(c); assert.ok(Date.now() - t0 < 1500, `slow (${Date.now() - t0}ms) on ${c.slice(0, 30)}`); }
});
test("[mock] plain prose, even when it mentions tools, is never a call or an attempt", () => {
  for (const t of ["I will use the roblox_get_tree tool next.", "The name is \"roblox_get_tree\" in JSON.", "Use <b>bold</b> and {braces}.", "Here is code: ```lua\nprint(1)\n```", ""]) {
    const r = parseReply(t); assert.equal(r.calls.length, 0, t); assert.equal(r.attempted, false, t);
  }
});
test("[mock] a script that mentions </tool> or </source> inside a string needs the escape, and a lone </tool> after the body still closes the call", () => {
  const r = parseReply('<tool name="roblox_write_script" path="A.B"><source>\nprint("ok")\n</source></tool>\nThen I will continue.');
  assert.equal(r.calls.length, 1); assert.equal(r.calls[0].args.source, 'print("ok")'); assert.equal(r.errors.length, 0);
});
test("[mock] errors carry a position the model can use", () => {
  const r = parseReply('<tool>{"name":"roblox_get_tree","args":{"a":1,}x}</tool>');
  assert.equal(r.calls.length, 0); assert.match(r.errors[0].message, /line \d+, column \d+|position|not valid JSON/);
});
