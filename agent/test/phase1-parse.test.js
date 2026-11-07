// PHASE 1 items 1, 3, 4. All tests here are MOCK: a scripted fake model and fake tools. They prove the loop's logic, not Roblox or model behaviour.
import test from "node:test"; import assert from "node:assert/strict";
import { parseTools, handleUserMessage } from "../src/loop.js";

const said = []; const mkApi = () => { said.length = 0; return {
  say: async (role, content, cards, state, embeds, outcome) => { said.push({ role, content, state, embeds, outcome }); return { id: "m" + said.length }; },
  update: async () => ({}), log: () => {},
}; };
const scripted = (replies) => { let i = 0; const seen = []; const f = async (msgs) => { seen.push(msgs.map((m) => m.content)); return { content: replies[Math.min(i++, replies.length - 1)] }; }; f.seen = seen; f.calls = () => i; return f; };
const tools = (extra = {}) => ({ roblox_get_tree: { args: "", fn: async () => ({ ok: true, result: "tree" }) }, roblox_write_script: { args: "", fn: async (a) => ({ ok: true, result: { got: a } }) }, plan_create: { args: "", fn: async () => ({ ok: true, result: "p" }) }, ...extra });
const run = (replies, opts = {}) => { const m = mkApi(); const llm = scripted(replies); return handleUserMessage([], "build it", { llm, tools: tools(opts.tools), say: m.say, update: m.update, log: m.log, maxIterations: opts.max ?? 12, shouldStop: async () => false }).then(() => ({ llm, said: [...said] })); };

// ---------- item 1: a broken tool call must never be a final answer ----------
test("[mock] item 1: unparseable <tool> is NOT posted as the answer; the model is told the error and can resend", async () => {
  const { llm, said } = await run(['Building.\n<tool>{"name":"roblox_get_tree","args":{"path":"Workspace"</tool>', '<tool>{"name":"roblox_get_tree","args":{"path":"Workspace"}}</tool>', "Done."]);
  assert.ok(!said.some((s) => /<tool/.test(s.content) && s.state === "idle"), "broken tool text must not be shown to the user as a final answer");
  const second = llm.seen[1].join("\n"); assert.match(second, /could not be parsed|parse/i, "the model must be told the call failed to parse"); assert.match(second, /position|char|column|line/i, "the error must say where");
});
test("[mock] item 1: a ```json block naming a tool that fails to parse is also caught", async () => {
  const { llm } = await run(['```json\n{"name":"roblox_get_tree","args":{"path":"Workspace",,}}\n```', "Done."]);
  assert.match(llm.seen[1]?.join("\n") ?? "", /parse/i);
});
test("[mock] item 1: 3 consecutive parse failures end the run as INCOMPLETE, never as success", async () => {
  const bad = '<tool>{"name":"roblox_get_tree","args":{';
  const { said, llm } = await run([bad, bad, bad, bad, bad]);
  assert.equal(llm.calls(), 3, "must stop after exactly 3 consecutive parse failures");
  const last = said[said.length - 1]; assert.equal(last.outcome, "incomplete"); assert.equal(last.state, "idle", "the session busy-lock must still release"); assert.match(last.content, /INCOMPLETE|could not|parse/i);
});
test("[mock] item 1: parse failures do NOT count toward the tool-failure limit", async () => {
  const bad = '<tool>{"name":"roblox_get_tree","args":{';
  const good = '<tool>{"name":"roblox_get_tree","args":{}}</tool>';
  const { said } = await run([bad, bad, good, "All done."]);
  assert.equal(said[said.length - 1].state, "idle"); assert.match(said[said.length - 1].content, /All done/);
});
test("[mock] item 1: a parse failure followed by a good call resets the counter", async () => {
  const bad = '<tool>{"name":"roblox_get_tree","args":{', good = '<tool>{"name":"roblox_get_tree","args":{}}</tool>';
  const { said } = await run([bad, bad, good, bad, bad, good, "ok finished"]);
  assert.equal(said[said.length - 1].state, "idle");
});

// ---------- item 3: raw-body form ----------
test("[mock] item 3: raw-body write_script keeps awkward Lua byte-for-byte", () => {
  const lua = 'local s = "a \\ b \\n"\nlocal l = [[ x ]] .. [==[ y ]==]\nprint("<tool>{\\"name\\":\\"roblox_delete\\"}</tool>")\nreturn \'é日😀\'';
  const c = parseTools(`go\n<tool name="roblox_write_script" path="ServerScriptService.A" class="Script"><source>\n${lua}\n</source></tool>`);
  assert.equal(c.length, 1); assert.equal(c[0].name, "roblox_write_script"); assert.equal(c[0].args.path, "ServerScriptService.A"); assert.equal(c[0].args.class, "Script"); assert.equal(c[0].args.source, lua);
});
test("[mock] item 3: raw-body build_model puts the JSON spec in args.spec", () => {
  const c = parseTools('<tool name="build_model" parent="Workspace"><spec>{"name":"Hut","parts":[{"size":{"x":1,"y":1,"z":1}}]}</spec></tool>');
  assert.equal(c[0].name, "build_model"); assert.equal(c[0].args.parent, "Workspace"); assert.deepEqual(c[0].args.spec, { name: "Hut", parts: [{ size: { x: 1, y: 1, z: 1 } }] });
});
test("[mock] item 3: a missing closing tag at the end of output is tolerated", () => {
  const c = parseTools('<tool name="roblox_write_script" path="A.B"><source>\nprint(1)\nprint(2)');
  assert.equal(c.length, 1); assert.equal(c[0].args.source, "print(1)\nprint(2)");
});
test("[mock] item 3: the JSON form still works as a fallback", () => { assert.equal(parseTools('<tool>{"name":"roblox_get_tree","args":{"path":"W"}}</tool>')[0].args.path, "W"); });
test("[mock] item 3: tool-call text INSIDE a raw source is data, not a second call", () => {
  const c = parseTools('<tool name="roblox_write_script" path="A.B"><source>\nprint("<tool>{\\"name\\":\\"roblox_get_tree\\",\\"args\\":{}}</tool>")\n</source></tool>');
  assert.equal(c.length, 1);
});

// ---------- item 4: cap and families ----------
test("[mock] item 4: parseTools returns at most 6 calls", () => {
  const one = '<tool>{"name":"roblox_get_tree","args":{}}</tool>\n';
  assert.equal(parseTools(one.repeat(9)).length, 6);
});
test("[mock] item 4: the bare-fence fallback recognises vm_* and plan_* names, not only roblox_*", () => {
  assert.equal(parseTools('```json\n{"name":"vm_exec","args":{"command":"ls"}}\n```')[0]?.name, "vm_exec");
  assert.equal(parseTools('```json\n{"name":"plan_create","args":{"title":"t","items":["a","b"]}}\n```')[0]?.name, "plan_create");
});
