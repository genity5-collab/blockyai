import test from "node:test"; import assert from "node:assert/strict";
import { llmRow } from "../../supabase/functions/_shared/llmrow.js";
const SID = "11111111-1111-1111-1111-111111111111";
test("[mock] llmRow keeps good fields and the session id comes from the server, not the client", () => {
  const r = llmRow({ session_id: "evil", run_id: "abc-123", iteration: 3, finish_reason: "length", prompt_tokens: 100, completion_tokens: 50, chars: 900 }, SID);
  assert.equal(r.session_id, SID); assert.equal(r.finish_reason, "length"); assert.equal(r.iteration, 3); assert.equal(r.prompt_tokens, 100);
});
test("[mock] llmRow clamps hostile values and stores NO text", () => {
  const r = llmRow({ run_id: "<script>x</script>".repeat(50), iteration: -4, finish_reason: "DROP TABLE", prompt_tokens: 1e99, completion_tokens: "x", chars: -1, content: "secret reply text", message_id: "not-a-uuid" }, SID);
  assert.ok(!/[<>]/.test(r.run_id) && r.run_id.length <= 60); assert.equal(r.iteration, 0); assert.equal(r.finish_reason, "unknown"); assert.equal(r.prompt_tokens, 10_000_000); assert.equal(r.completion_tokens, null); assert.equal(r.chars, null); assert.equal(r.message_id, null);
  assert.ok(!("content" in r), "no model text is ever stored");
});
test("[mock] llmRow tolerates null/garbage bodies", () => { for (const b of [null, undefined, 5, "x", []]) assert.doesNotThrow(() => llmRow(b, SID)); });
