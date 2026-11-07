import { authPlugin, handle, json } from "../_shared/lib.ts";
// Plugin long-polls for the next command(s). Confirm-gated commands wait for user approval.
Deno.serve(handle(async (req) => {
  const { db, session } = await authPlugin(req);
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    await db.from("sessions").update({ plugin_last_seen_at: new Date().toISOString() }).eq("id", session.id);
    const { data } = await db.from("commands").select("*").eq("session_id", session.id).eq("status", "pending")
      .or("needs_confirm.eq.false,confirmed.eq.true").order("created_at").limit(1);
    if (data?.length) {
      const c = data[0];
      if (c.type === "run_lua" && !session.run_lua_enabled) {
        await db.from("commands").update({ status: "failed", error: "run_lua disabled", finished_at: new Date().toISOString() }).eq("id", c.id);
        continue;
      }
      await db.from("commands").update({ status: "running" }).eq("id", c.id);
      return json({ commands: [{ id: c.id, type: c.type, payload: c.payload }] });
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return json({ commands: [] });
}));
