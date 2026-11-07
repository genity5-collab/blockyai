import { authAgent, handle, json, ALLOWED, DESTRUCTIVE } from "../_shared/lib.ts";
import { timeoutFor, classify } from "../_shared/policy.js";
// The agent enqueues a command. Everything that must be decided SERVER-side happens here:
//  - idempotency: the same idempotency_key in a session returns the existing command instead of creating a second one
//  - per-type timeout and risk tier; HIGH actions that the policy says need approval are held until the user confirms in the plugin
//  - the safety snapshot is inserted FIRST (lower seq), so it always runs before the destructive command it protects
Deno.serve(handle(async (req) => {
  const { db, session } = await authAgent(req);
  const { type, payload = {}, auto_snapshot = true, idempotency_key } = await req.json();
  if (!ALLOWED.has(type)) return json({ error: `command type not allowed: ${type}` }, 400);
  if (type === "run_lua" && !session.run_lua_enabled) return json({ error: "run_lua is disabled by the user" }, 403);
  if (type === "batch" && (payload.commands?.length ?? 0) > session.max_batch_size) return json({ error: `batch too large (max ${session.max_batch_size})` }, 400);
  const key = idempotency_key ? String(idempotency_key).slice(0, 120) : null;
  if (key) {
    const { data: prior } = await db.from("commands").select("id,status,needs_confirm,risk").eq("session_id", session.id).eq("idempotency_key", key).maybeSingle();
    if (prior) return json({ id: prior.id, status: prior.status, needs_confirm: prior.needs_confirm, risk: prior.risk, duplicate: true });
  }
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db.from("commands").select("id", { count: "exact", head: true }).eq("session_id", session.id).gte("created_at", since);
  if ((count ?? 0) >= session.max_commands_per_min) return json({ error: "rate limit: too many commands per minute" }, 429);

  const verdict = classify(type, payload, { tainted: !!session.tainted, restoreVerified: Deno.env.get("RESTORE_VERIFIED") === "1" });
  if (DESTRUCTIVE.has(type) && auto_snapshot && type !== "snapshot_restore") {
    await db.from("commands").insert({ session_id: session.id, type: "snapshot_save", payload: { label: `auto before ${type}` }, timeout_s: timeoutFor("snapshot_save"), risk: "low" });
  }
  const { data, error } = await db.from("commands").insert({
    session_id: session.id, type, payload, idempotency_key: key, timeout_s: timeoutFor(type), risk: verdict.tier,
    needs_confirm: verdict.needsApproval, approval_reasons: verdict.reasons.length ? verdict.reasons : null,
  }).select().single();
  if (error) return json({ error: error.message }, error.code === "23505" ? 409 : 500);
  await db.from("sessions").update({ last_active_at: new Date().toISOString(), agent_state: "working" }).eq("id", session.id);
  return json({ id: data.id, status: data.status, needs_confirm: data.needs_confirm, risk: data.risk, reasons: verdict.reasons });
}));
