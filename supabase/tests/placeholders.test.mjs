// The "Working..." line the agent shows while it works must never be handed back to the model as something it said before:
// the model copies it and ends its turn with just "Working...", so the user never gets an answer.
import test from "node:test"; import assert from "node:assert/strict";
import { dropPlaceholders, isPlaceholder } from "../functions/_shared/placeholders.js";

test("the working line is a placeholder, with any dots, case or spacing", () => {
  for (const s of ["Working...", "working...", "  Working…  ", "Working", "Working.", "WORKING ...", "Thinking...", "Thinking…"]) assert.equal(isPlaceholder({ role: "assistant", content: s }), true, s);
});
test("a real answer is never a placeholder, even if it starts with the word", () => {
  for (const s of ["Working on it: I added the spawn pad.", "Done. Working again now?", "Here is the plan", "", "Working... then I found 3 problems"]) {
    const p = isPlaceholder({ role: "assistant", content: s }); assert.equal(p, s === "", JSON.stringify(s));   // an empty assistant row is also dropped
  }
});
test("only assistant rows can be placeholders: a user who types 'Working...' is still heard", () => {
  assert.equal(isPlaceholder({ role: "user", content: "Working..." }), false);
  assert.equal(isPlaceholder({ role: "tool", content: "Working..." }), false);
});
test("a row that is still streaming with cards is kept when it has tool cards (it is real work)", () => {
  assert.equal(isPlaceholder({ role: "assistant", content: "Working...", tool_calls: [{ name: "roblox_create" }] }), false);
});
test("dropPlaceholders keeps order and everything else", () => {
  const rows = [{ id: 1, role: "user", content: "hi" }, { id: 2, role: "assistant", content: "Working..." }, { id: 3, role: "user", content: "Search tools" }, { id: 4, role: "assistant", content: "Found 3." }];
  assert.deepEqual(dropPlaceholders(rows).map((r) => r.id), [1, 3, 4]);
});
test("bad input is safe", () => {
  assert.deepEqual(dropPlaceholders(null), []); assert.deepEqual(dropPlaceholders(undefined), []); assert.deepEqual(dropPlaceholders([null, undefined, { role: "user", content: "x" }]).length, 1);
  assert.equal(isPlaceholder(null), false); assert.equal(isPlaceholder({ role: "assistant" }), true);
});
