import { authOwner, handle, json } from "../_shared/lib.ts";
import { fs } from "../_shared/freestyle.ts";
Deno.serve(handle(async (req) => {
  const sid = new URL(req.url).searchParams.get("session_id")!;
  const { session: s } = await authOwner(req, sid);
  let live: string | null = null;
  if (s.vm_id) { try { live = (await fs().vms.ref(s.vm_id).data() as any).state; } catch { live = "unknown"; } }
  const { id, vm_status, agent_state, last_active_at, plugin_last_seen_at } = s;
  return json({ id, vm_status, agent_state, last_active_at, plugin_last_seen_at, freestyle_state: live, plugin_online: !!s.plugin_last_seen_at && Date.now() - new Date(s.plugin_last_seen_at).getTime() < 30_000 });
}));
