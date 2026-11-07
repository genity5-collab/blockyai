import { authAgent, handle, json } from "../_shared/lib.ts";
// The agent long-polls a command's state. It can tell three situations apart, which the old "pending" could not:
//   queued  = nobody has claimed it: the plugin is not polling (offline, not paired, wrong place open)
//   claimed = the plugin took it but has not ACKed yet
//   running = the plugin ACKed and is working on it ("busy", not "dead")
Deno.serve(handle(async (req) => {
  const { db, session } = await authAgent(req);
  const id = new URL(req.url).searchParams.get("id")!;
  const end = Date.now() + 25_000;
  while (Date.now() < end) {
    const { data } = await db.from("commands").select("id,type,status,result,error,attempts,acked_at,claimed_at,result_truncated,result_bytes,timeout_s,needs_confirm,confirmed,created_at").eq("id", id).eq("session_id", session.id).maybeSingle();
    if (!data) return json({ error: "not found" }, 404);
    if (["done", "failed", "cancelled", "expired"].includes(data.status)) return json(data);
    await new Promise((r) => setTimeout(r, 700));
  }
  const { data: d } = await db.from("commands").select("id,type,status,attempts,acked_at,claimed_at,timeout_s,needs_confirm,confirmed,created_at").eq("id", id).eq("session_id", session.id).maybeSingle();
  return json(d ?? { id, status: "queued" });
}));
