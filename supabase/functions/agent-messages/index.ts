import { authAgent, handle, json } from "../_shared/lib.ts";

// Embeds are DATA the website renders. Only these shapes are accepted; every string is length-capped.
const KINDS = new Set(["info", "tip", "warning", "success", "steps", "code", "table", "checklist"]);
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
export function cleanEmbeds(raw: unknown) {
  if (!Array.isArray(raw)) return null;
  const out: any[] = [];
  for (const e of raw.slice(0, 6)) {
    if (!e || typeof e !== "object" || !KINDS.has((e as any).type)) continue;
    const x = e as any, base: any = { type: x.type, title: str(x.title, 80) };
    if (x.type === "code") { base.language = str(x.language || "lua", 16); base.code = str(x.code, 6000); }
    else if (x.type === "table") { base.columns = (Array.isArray(x.columns) ? x.columns : []).slice(0, 6).map((c: unknown) => str(c, 40)); base.rows = (Array.isArray(x.rows) ? x.rows : []).slice(0, 30).map((r: unknown) => (Array.isArray(r) ? r : []).slice(0, 6).map((c) => str(c, 120))); }
    else if (x.type === "steps" || x.type === "checklist") { base.items = (Array.isArray(x.items) ? x.items : []).slice(0, 12).map((i: unknown) => str(i, 200)); }
    else { base.body = str(x.body, 800); }
    out.push(base);
  }
  return out.length ? out : null;
}
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
    const { data } = await db.from("messages").update({ content: b.content, tool_calls: b.tool_calls, ...(b.embeds !== undefined ? { embeds: cleanEmbeds(b.embeds) } : {}) }).eq("id", b.id).eq("session_id", session.id).select().single();
    return json(data);
  }
  if (b.content === undefined) return json({ ok: true });
  if (!["assistant","tool","system"].includes(b.role)) return json({ error: "bad role" }, 400);
  const { data } = await db.from("messages").insert({ session_id: session.id, role: b.role, content: b.content, tool_calls: b.tool_calls ?? null, embeds: cleanEmbeds(b.embeds) }).select().single();
  return json(data);
}));
