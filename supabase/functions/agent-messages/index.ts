import { authAgent, handle, json } from "../_shared/lib.ts";
// GET ?after=<iso> -> new user messages. POST -> write assistant/tool message, or PATCH-style update with id.
Deno.serve(handle(async (req) => {
  const { db, session } = await authAgent(req);
  if (req.method === "GET") {
    const after = new URL(req.url).searchParams.get("after") ?? "1970-01-01";
    const { data } = await db.from("messages").select("*").eq("session_id", session.id).gt("created_at", after).order("created_at");
    return json(data);
  }
  const b = await req.json();
  if (b.state) await db.from("sessions").update({ agent_state: b.state, last_active_at: new Date().toISOString() }).eq("id", session.id);
  if (b.id) { // streaming update of an existing message
    const { data } = await db.from("messages").update({ content: b.content, tool_calls: b.tool_calls }).eq("id", b.id).eq("session_id", session.id).select().single();
    return json(data);
  }
  if (b.content === undefined) return json({ ok: true });
  if (!["assistant","tool","system"].includes(b.role)) return json({ error: "bad role" }, 400);
  const { data } = await db.from("messages").insert({ session_id: session.id, role: b.role, content: b.content, tool_calls: b.tool_calls ?? null }).select().single();
  return json(data);
}));
