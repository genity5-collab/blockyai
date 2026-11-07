import { authAgent, handle, json } from "../_shared/lib.ts";
// The agent gave up waiting for a command. Cancel it ONLY if nobody has claimed it yet, so it can never run later behind the agent's back.
// A command the plugin already claimed or is running cannot be recalled from here: the plugin has it. We report that honestly
// (cancelled:false + the real status) so the agent can warn the user that the game may still change.
Deno.serve(handle(async (req) => {
  const { db, session } = await authAgent(req);
  const b = await req.json().catch(() => ({}));
  const id = String(b.id ?? ""); if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad command id" }, 400);
  const { data: hit } = await db.from("commands").update({ status: "cancelled", error: "agent gave up waiting; cancelled before the plugin claimed it", finished_at: new Date().toISOString() })
    .eq("id", id).eq("session_id", session.id).eq("status", "queued").select("id").maybeSingle();
  if (hit) return json({ ok: true, cancelled: true, status: "cancelled" });
  const { data: c } = await db.from("commands").select("status").eq("id", id).eq("session_id", session.id).maybeSingle();
  if (!c) return json({ error: "not found" }, 404);
  return json({ ok: true, cancelled: false, status: c.status });     // claimed / running / already finished: nothing was cancelled
}));
