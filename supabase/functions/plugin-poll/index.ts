import { authPlugin, handle, json } from "../_shared/lib.ts";
// Plugin long-polls for the next command. The claim is ONE SQL function (claim_command): it locks the row (FOR UPDATE SKIP LOCKED),
// sets a 30s lease and hands it to exactly one poller. The plugin must ACK (plugin-ack) and keep heartbeating, or the lease expires
// and the command is re-queued (at most 2 times) and then marked expired. See migrations/0008_reliable_queue.sql.
Deno.serve(handle(async (req) => {
  const { db, session } = await authPlugin(req);
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    await db.from("sessions").update({ plugin_last_seen_at: new Date().toISOString() }).eq("id", session.id);
    const { data, error } = await db.rpc("claim_command", { p_session: session.id, p_lease_s: 30, p_max_requeues: 2 });
    if (error) return json({ error: error.message }, 500);
    const c = Array.isArray(data) ? data[0] : data;
    if (c) {
      // run_lua stays blocked unless the user enabled it: fail it right away instead of leaving it claimed.
      if (c.type === "run_lua" && !session.run_lua_enabled) {
        await db.rpc("finish_command", { p_session: session.id, p_id: c.id, p_ok: false, p_result: null, p_error: "run_lua disabled" });
        continue;
      }
      return json({ commands: [{ id: c.id, type: c.type, payload: c.payload, idempotency_key: c.idempotency_key, timeout_s: c.timeout_s, attempt: c.attempts, risk: c.risk }] });
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return json({ commands: [] });
}));
