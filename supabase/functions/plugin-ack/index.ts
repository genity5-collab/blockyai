import { authPlugin, handle, json } from "../_shared/lib.ts";
// The plugin calls this the moment it starts a command (separate from the result), and again every ~10s as a heartbeat.
// ack: claimed -> running and the lease extends to the command's own timeout. heartbeat: renews the lease.
Deno.serve(handle(async (req) => {
  const { db, session } = await authPlugin(req);
  const b = await req.json().catch(() => ({}));
  const id = String(b.command_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "command_id required" }, 400);
  if (b.heartbeat) {
    const { data } = await db.rpc("heartbeat_command", { p_session: session.id, p_id: id, p_lease_s: 30 });
    return json({ ok: !!data, alive: !!data });
  }
  const { data, error } = await db.rpc("ack_command", { p_session: session.id, p_id: id });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: data === "running", state: data });
}));
