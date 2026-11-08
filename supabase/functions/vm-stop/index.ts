import { authOwner, handle, json, admin } from "../_shared/lib.ts";
import { fs, IDLE_SUSPEND_MIN } from "../_shared/freestyle.ts";
import { clearScreen } from "../_shared/clearscreen.js";

// mode: "suspend" | "destroy". With no auth header + cron secret it sweeps idle / expired sessions.
Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({}));
  const f = fs();
  const db = admin();
  const kill = async (s: any, mode: string) => {
    if (!s.vm_id) return;
    const vm = f.vms.ref(s.vm_id);
    const cs = await clearScreen(db, s.id); if (!cs.ok) console.error("clearScreen:", cs.error);   // paused or destroyed: nobody is looking at a screen any more, so its last picture must not stay
    if (mode === "destroy") { await vm.delete().catch(() => {}); await db.from("sessions").update({ vm_id: null, vm_status: "stopped", agent_token_hash: null, agent_token_expires_at: null }).eq("id", s.id); }
    else { await vm.pause().catch(() => {}); await db.from("sessions").update({ vm_status: "suspended", agent_state: "idle" }).eq("id", s.id); }
  };
  if (body.sweep && req.headers.get("x-cron-secret") === Deno.env.get("CRON_SECRET")) {
    const idleBefore = new Date(Date.now() - IDLE_SUSPEND_MIN * 60_000).toISOString();
    const { data: idle } = await db.from("sessions").select("*").eq("vm_status", "running").lt("last_active_at", idleBefore);
    for (const s of idle ?? []) await kill(s, "suspend");
    const { data: old } = await db.from("sessions").select("*").in("vm_status", ["running","suspended"]).lt("vm_started_at", new Date(Date.now() - 4 * 3600_000).toISOString());
    for (const s of old ?? []) await kill(s, "destroy");
    return json({ suspended: idle?.length ?? 0, destroyed: old?.length ?? 0 });
  }
  const { session: s } = await authOwner(req, body.session_id);
  if (!s) return json({ error: "session not found" }, 404);
  await kill(s, body.mode === "destroy" ? "destroy" : "suspend");
  return json({ ok: true });
}));
