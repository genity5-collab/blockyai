import { authAgent, handle, json, ALLOWED, DESTRUCTIVE } from "../_shared/lib.ts";
Deno.serve(handle(async (req) => {
  const { db, session } = await authAgent(req);
  const { type, payload = {}, auto_snapshot = true } = await req.json();
  if (!ALLOWED.has(type)) return json({ error: `command type not allowed: ${type}` }, 400);
  if (type === "run_lua" && !session.run_lua_enabled) return json({ error: "run_lua is disabled by the user" }, 403);
  if (type === "batch" && (payload.commands?.length ?? 0) > session.max_batch_size)
    return json({ error: `batch too large (max ${session.max_batch_size})` }, 400);
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db.from("commands").select("id", { count: "exact", head: true }).eq("session_id", session.id).gte("created_at", since);
  if ((count ?? 0) >= session.max_commands_per_min) return json({ error: "rate limit: too many commands per minute" }, 429);

  const destructive = DESTRUCTIVE.has(type);
  // Destructive: auto-snapshot first so the user can always undo.
  if (destructive && auto_snapshot && type !== "snapshot_restore") {
    await db.from("commands").insert({ session_id: session.id, type: "snapshot_save", payload: { label: `auto before ${type}` } });
  }
  const { data, error } = await db.from("commands").insert({
    session_id: session.id, type, payload,
    needs_confirm: type === "run_lua" || type === "snapshot_restore",
  }).select().single();
  if (error) return json({ error: error.message }, 500);
  await db.from("sessions").update({ last_active_at: new Date().toISOString(), agent_state: "working" }).eq("id", session.id);
  return json({ id: data.id, status: data.status, needs_confirm: data.needs_confirm });
}));
