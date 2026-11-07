import { authUser, handle, json } from "../_shared/lib.ts";
import { fs } from "../_shared/freestyle.ts";
Deno.serve(handle(async (req) => {
  const { db, user } = await authUser(req);
  const sid = new URL(req.url).searchParams.get("session_id")!;
  const { data: s } = await db.from("sessions").select("id,vm_id,vm_status,agent_state,last_active_at,plugin_last_seen_at").eq("id", sid).eq("user_id", user.id).maybeSingle();
  if (!s) return json({ error: "not found" }, 404);
  let live: string | null = null;
  if (s.vm_id) { try { live = (await fs().vms.ref(s.vm_id).data() as any).state; } catch { live = "unknown"; } }
  return json({ ...s, freestyle_state: live, plugin_online: !!s.plugin_last_seen_at && Date.now() - new Date(s.plugin_last_seen_at).getTime() < 30_000 });
}));
