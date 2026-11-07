import { authAgent, handle, json } from "../_shared/lib.ts";
import { llmRow } from "../_shared/llmrow.js";
// The VM reports each model call (finish_reason + token counts, never any text). Scoped to the agent token's own session.
Deno.serve(handle(async (req) => {
  const { db, session } = await authAgent(req);
  const b = await req.json().catch(() => ({}));
  const { error } = await db.from("llm_calls").insert(llmRow(b, session.id));
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}));
