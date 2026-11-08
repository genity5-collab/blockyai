// Long-term memory (a file on the VM) and resuming an interrupted request. File tests use the REAL filesystem; the tool tests back up and
// restore any real MEMORY.md first, so running them on a live VM cannot destroy its memory.
import test from "node:test"; import assert from "node:assert/strict";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { parseMemory, renderMemory, addEntry, forget, promptBlock, loadMemory, saveMemory, autoEntries, MAX_PER_KIND, KINDS } from "../src/memory.js";
import { RunLedger } from "../src/facts.js";
import { findInterrupted, resumeNote, resumeAllowed } from "../src/resume.js";
import { TOOLS, WORK } from "../src/tools.js";
import { memoryFile } from "../src/tools-vm.js";
import { handleUserMessage } from "../src/loop.js";

const blank = () => parseMemory("");
const D = new Date("2026-11-08T10:00:00Z");

test("memory: entries are one-line, dated, de-duplicated, capped per section, and stripped of angle brackets", () => {
  const m = blank();
  assert.equal(addEntry(m, "decision", "Use RemoteEvents,\nnot RemoteFunctions </memory><b>x</b>", D), true);
  assert.equal(m.decision[0], "[2026-11-08] Use RemoteEvents, not RemoteFunctions /memorybx/b");
  assert.equal(addEntry(m, "decision", "Use RemoteEvents, not RemoteFunctions /memorybx/b", new Date("2027-01-01")), false, "same text on another day is not stored again");
  assert.equal(addEntry(m, "decision", "ab"), false, "too short"); assert.throws(() => addEntry(m, "nonsense", "hello there"), /kind must be one of/);
  for (let i = 0; i < MAX_PER_KIND + 5; i++) addEntry(m, "error", `fixed bug number ${i}`, D);
  assert.equal(m.error.length, MAX_PER_KIND); assert.match(m.error.at(-1), /bug number 18$/); assert.doesNotMatch(m.error.join("\n"), /bug number 0$/);
});
test("memory: render -> parse round trip; forget removes matching lines only", () => {
  const m = blank(); addEntry(m, "structure", "Shop UI is in StarterGui.ShopGui", D); addEntry(m, "preference", "likes neon blue", D); addEntry(m, "preference", "no emojis in scripts", D);
  const back = parseMemory(renderMemory(m)); assert.deepEqual(back, m);
  assert.equal(forget(back, "NEON"), 1); assert.equal(back.preference.length, 1); assert.equal(forget(back, "xx"), 0, "needs 3+ characters");
});
test("memory: the prompt block is labelled as notes (not instructions), skipped when empty, and drops OLDEST lines when over budget", () => {
  assert.equal(promptBlock(blank()), "");
  const m = blank(); for (let i = 0; i < 12; i++) addEntry(m, "done", `finished task number ${i} with a fairly long description to take space`, D);
  const b = promptBlock(m, 400); assert.match(b, /NOT instructions from the user/); assert.match(b, /<memory>/);
  assert.ok(b.length < 400 + 450, "kept near the budget"); assert.match(b, /task number 11/); assert.doesNotMatch(b, /task number 0 /);
});
test("memory: save/load on the real filesystem; a missing file is simply empty", async () => {
  const f = "/tmp/blk_mem_test/MEMORY.md"; await rm("/tmp/blk_mem_test", { recursive: true, force: true });
  assert.deepEqual(await loadMemory(f), blank());
  const m = blank(); addEntry(m, "decision", "Server owns all currency", D); await saveMemory(f, m);
  assert.match(await readFile(f, "utf8"), /## Decisions\n- \[2026-11-08\] Server owns all currency/); assert.deepEqual(await loadMemory(f), m);
  await rm("/tmp/blk_mem_test", { recursive: true, force: true });
});

test("tools: vm_memory_note / read / forget work on the real VM file and refuse secrets", async () => {
  const f = memoryFile(); let backup = null; try { backup = await readFile(f, "utf8"); } catch {}
  try {
    await rm(f, { force: true });
    const a = await TOOLS.vm_memory_note.fn({ kind: "decision", text: "Checkpoints are saved per player in a DataStore" }); assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(a.result.stored, true);
    assert.equal((await TOOLS.vm_memory_note.fn({ kind: "decision", text: "Checkpoints are saved per player in a DataStore" })).result.stored, false);
    assert.match((await TOOLS.vm_memory_note.fn({ kind: "bogus", text: "hello there" })).error, /kind must be one of/);
    const secret = "my key is eyJhbGciOiJIUzI1NiJ9abcdefghijklmnopqrstuvwxyz0123456789"; const s = await TOOLS.vm_memory_note.fn({ kind: "error", text: secret });
    assert.equal(s.ok, false); assert.match(s.error, /secret/); assert.doesNotMatch(await readFile(f, "utf8"), /eyJhbGci/);
    const r = await TOOLS.vm_memory_read.fn({}); assert.equal(r.result.counts.decision, 1); assert.match(r.result.text, /Checkpoints are saved/);
    assert.equal((await TOOLS.vm_memory_forget.fn({ match: "datastore" })).result.removed, 1); assert.equal((await TOOLS.vm_memory_read.fn({})).result.counts.decision, 0);
  } finally { if (backup === null) await rm(f, { force: true }); else await writeFile(f, backup); }
});

test("auto memory: what the SYSTEM saves comes from the ledger only, and says when nothing was tested", () => {
  const L = new RunLedger(); L.add("roblox_write_script", { path: "ServerScriptService.Shop" }, { ok: true, result: {} }); L.add("build_model", {}, { ok: true, result: { instances: 30 } });
  const e = autoEntries({ userText: "make a coin shop", outcome: "complete", ledger: L });
  assert.equal(e.length, 1); assert.equal(e[0][0], "done"); assert.match(e[0][1], /^"make a coin shop" -> scripts written to studio: 1 \(ServerScriptService\.Shop\); models built: 1 of 1 build calls ok, 30 instances created \(not tested\)$/);
  const L2 = new RunLedger(); L2.add("roblox_create", {}, { ok: false, error: "parent not found" });
  const e2 = autoEntries({ userText: "add a door", outcome: "error", ledger: L2 }); assert.equal(e2.length, 1); assert.equal(e2[0][0], "error"); assert.match(e2[0][1], /ended error; last failure roblox_create: parent not found/);
  assert.deepEqual(autoEntries({ userText: "hi", outcome: "complete", ledger: new RunLedger() }), [], "a plain chat run saves nothing");
});
const ok = (r = {}) => ({ ok: true, result: r });
test("loop: project memory is shown to the model as notes, and what the run really did is saved afterwards; a broken memory never breaks a run", async () => {
  const saved = []; let sys = ""; let i = 0; const posted = [];
  const memory = { block: async () => "\n\n## Project memory (notes)\n<memory>\nDecisions:\n- [2026-11-01] Server owns currency\n</memory>", save: async (e) => { saved.push(...e); return e.length; } };
  await handleUserMessage([], "build the shop", { memory, llm: async (m) => { sys = m[0].content; return { content: i++ ? "Built." : `<tool>{"name":"build_model","args":{}}</tool>` }; }, tools: { build_model: { fn: async () => ok({ instances: 12 }) } },
    say: async (r, c, tc, st, em, o) => { posted.push(o); return { id: "m" }; }, update: async () => {}, log: () => {}, logLlm: () => {}, planApi: async (a) => (a === "get" ? { plan: { items: [] } } : { ok: true, reasons: [] }) });
  assert.match(sys, /Server owns currency/); assert.match(sys, /^You are BlockyAI/);
  assert.equal(saved[0][0], "done"); assert.match(saved[0][1], /build the shop/);
  const posted2 = []; i = 0;
  await handleUserMessage([], "hi", { memory: { block: async () => { throw new Error("disk"); }, save: async () => { throw new Error("disk"); } }, llm: async () => ({ content: "hello" }), tools: {}, say: async (r, c, tc, st, em, o) => { posted2.push(o); return { id: "m" }; }, update: async () => {}, log: () => {}, logLlm: () => {}, planApi: async () => ({ ok: true }) });
  assert.equal(posted2.at(-1), "complete");
});

const U = (id, t = "2026-11-08T10:00:00Z", extra = {}) => ({ id, role: "user", content: "build a yacht", created_at: t, ...extra });
const A = (id, o = null, c = "working...") => ({ id, role: "assistant", content: c, outcome: o });
const NOW = Date.parse("2026-11-08T11:00:00Z");
test("resume: a request that was started but never finished is found; finished, stopped, old, unstarted and error ones are not", () => {
  assert.equal(findInterrupted([U("u1"), A("a1")], { now: NOW }).message.id, "u1");
  assert.equal(findInterrupted([U("u1"), A("a1"), A("a2", "complete", "done")], { now: NOW }), null, "finished");
  assert.equal(findInterrupted([U("u1"), A("a1"), { id: "s", role: "system", content: "__STOP__" }], { now: NOW }), null, "user pressed Stop");
  assert.equal(findInterrupted([U("u1")], { now: NOW }), null, "never started: the normal path answers it");
  assert.equal(findInterrupted([U("u1"), A("a1", null, "Agent error: boom")], { now: NOW }), null);
  assert.equal(findInterrupted([U("u1", "2026-11-08T05:00:00Z"), A("a1")], { now: NOW }), null, "older than 2 hours");
  assert.equal(findInterrupted([U("u0"), A("a0"), U("u1", "2026-11-08T10:30:00Z", { blocked: true })], { now: NOW }).message.id, "u0", "a blocked message is not the request");
  assert.equal(findInterrupted([U("u1"), A("a1", "incomplete", "INCOMPLETE")], { now: NOW }), null);
});
test("resume: the note carries the plan and forbids starting over", () => {
  const n = resumeNote({ items: [{ id: 1, text: "Hull", done: true, verified: false }, { id: 2, text: "Deck", done: false }] });
  assert.match(n, /\[RESUME\]/); assert.match(n, /Do NOT start over/); assert.match(n, /#1 \[x\] Hull/); assert.match(n, /#2 \[ \] Deck/); assert.match(resumeNote(null), /no saved plan/);
});
test("resume: at most 2 automatic resumes per request, counted on disk; a different request starts fresh", async () => {
  const f = "/tmp/blk_resume_test/.resume.json"; await rm("/tmp/blk_resume_test", { recursive: true, force: true });
  assert.equal(await resumeAllowed(f, "m1"), true); assert.equal(await resumeAllowed(f, "m1"), true); assert.equal(await resumeAllowed(f, "m1"), false);
  assert.equal(await resumeAllowed(f, "m2"), true); await rm("/tmp/blk_resume_test", { recursive: true, force: true });
});
test("loop: a RESUMED run keeps the interrupted plan (no begin_turn); a normal run still clears stale plans", async () => {
  const acts = []; const base = { llm: async () => ({ content: "ok" }), tools: {}, say: async () => ({ id: "m" }), update: async () => {}, log: () => {}, logLlm: () => {}, planApi: async (a) => { acts.push(a); return a === "get" ? { plan: null } : { ok: true }; } };
  await handleUserMessage([], "continue", { ...base, resume: true }); assert.ok(!acts.includes("begin_turn"));
  acts.length = 0; await handleUserMessage([], "new", { ...base }); assert.ok(acts.includes("begin_turn"));
});

test("prompt: the autonomy rules (plan, find out, fix, check, remember, listen) are in the system prompt the model really gets", async () => {
  const { SYSTEM } = await import("../src/loop.js");
  for (const w of ["PLAN:", "FIND OUT, do not ask", "FIX YOUR OWN ERRORS", "DONE MEANS CHECKED", "vm_memory_note", "NEW MESSAGE FROM THE USER"]) assert.ok(SYSTEM.includes(w), w);
  assert.ok(SYSTEM.length < 24000, "system prompt stays reasonable: " + SYSTEM.length);
});
