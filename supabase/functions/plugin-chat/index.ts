import { authPlugin, handle, json } from "../_shared/lib.ts";

// The plugin shows the website chat inside Studio. GET-style read: returns the last messages, state and the active plan.
// POST {content}: sends a user message (blocked while the agent is busy, same rule as the website).
const SECRET = /(eyJ[A-Za-z0-9_-]{20,}|sbp_[A-Za-z0-9]{20,}|fs_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g;
Deno.serve(handle(async (req) => {
  const { db, session } = await authPlugin(req);
  const b = await req.json().catch(() => ({}));
  if (b.send != null) {
    const content = String(b.send).slice(0, 4000).trim();
    if (!content) return json({ error: "empty message" }, 400);
    if (["thinking", "working"].includes(session.agent_state)) return json({ error: "Blocky is still working. Wait or press Stop.", busy: true }, 409);
    const { data, error } = await db.from("messages").insert({ session_id: session.id, role: "user", content }).select().single();
    if (error) return json({ error: error.message }, 500);
    await db.from("sessions").update({ agent_state: "thinking", last_active_at: new Date().toISOString() }).eq("id", session.id);
    return json({ ok: true, id: data.id });
  }
  if (b.confirm) {
    // Same effect as the website's confirm_command, but only for THIS session's own pending, unconfirmed command.
    const id = String(b.confirm.id ?? ""); if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad command id" }, 400);
    const q = b.confirm.allow === true
      ? db.from("commands").update({ confirmed: true }).eq("id", id).eq("session_id", session.id).eq("needs_confirm", true).eq("status", "queued")
      : db.from("commands").update({ status: "cancelled", error: "rejected in Studio", finished_at: new Date().toISOString() }).eq("id", id).eq("session_id", session.id).eq("status", "queued");
    const { error } = await q;
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }
  if (b.stop) {
    // Same mechanism as the website's Stop button: a __STOP__ marker the agent loop watches, cancel queued work, abandon the plan.
    const now = new Date().toISOString();
    await db.from("sessions").update({ agent_state: "idle", last_active_at: now }).eq("id", session.id);
    await db.from("messages").insert({ session_id: session.id, role: "system", content: "__STOP__" });
    await db.from("commands").update({ status: "cancelled", error: "stopped by user", finished_at: now }).eq("session_id", session.id).in("status", ["queued", "claimed", "running"]);
    await db.from("agent_plans").update({ status: "abandoned", updated_at: now }).eq("session_id", session.id).eq("status", "active");
    return json({ ok: true });
  }
  const [msgs, plan, pending] = await Promise.all([
    db.from("messages").select("id,role,content,created_at").eq("session_id", session.id).in("role", ["user", "assistant"]).order("created_at", { ascending: false }).limit(30),
    db.from("agent_plans").select("title,items,status").eq("session_id", session.id).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("commands").select("id,type,payload,risk,approval_reasons").eq("session_id", session.id).eq("status", "queued").eq("needs_confirm", true).eq("confirmed", false).limit(10),
  ]);
  return json({
    state: session.agent_state, place_name: session.place_name ?? null, vm_status: session.vm_status,
    messages: (msgs.data ?? []).reverse().map((m: any) => ({ id: m.id, role: m.role, content: String(m.content).replace(SECRET, "[redacted]").slice(0, 1500) })),
    plan: plan.data ?? null, pending_confirmations: (pending.data ?? []).map((c: any) => ({ id: c.id, type: c.type, risk: c.risk, reasons: c.approval_reasons ?? [] })),
  });
}));
