import { authAgent, handle, json } from "../_shared/lib.ts";

// Reusable named templates. Built-ins (session_id null) are readable by everyone; user templates are scoped to this session.
const NAME = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_BYTES = 400_000;
Deno.serve(handle(async (req) => {
  const { db, session } = await authAgent(req);
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "");
  if (b.action === "list") {
    const { data } = await db.from("templates").select("name,kind,description,instance_count,session_id").or(`session_id.is.null,session_id.eq.${session.id}`).order("name").limit(200);
    return json({ templates: (data ?? []).map((t: any) => ({ ...t, builtin: t.session_id === null, session_id: undefined })) });
  }
  if (!NAME.test(name)) return json({ error: "template name must be letters, digits, _ or -" }, 400);
  if (b.action === "load") {
    // the session's own template wins over a built-in with the same name
    const { data } = await db.from("templates").select("name,spec,description,instance_count,session_id").eq("name", name).or(`session_id.is.null,session_id.eq.${session.id}`);
    const t = (data ?? []).sort((a: any, c: any) => (c.session_id ? 1 : 0) - (a.session_id ? 1 : 0))[0];
    return json(t ? { name: t.name, spec: t.spec, description: t.description, instance_count: t.instance_count } : { error: "not found" }, t ? 200 : 404);
  }
  if (b.action === "save") {
    if (typeof b.spec !== "object" || !b.spec) return json({ error: "spec must be an object" }, 400);
    const text = JSON.stringify(b.spec);
    if (text.length > MAX_BYTES) return json({ error: `template too large (${text.length} bytes, limit ${MAX_BYTES})` }, 400);
    const { data: existing } = await db.from("templates").select("id").eq("session_id", session.id).eq("name", name).maybeSingle();
    const row = { session_id: session.id, name, spec: b.spec, description: String(b.description ?? "").slice(0, 200), instance_count: Math.max(0, Math.min(Number(b.instance_count) || 0, 100000)), kind: b.kind === "game" ? "game" : "model" };
    const { error } = existing ? await db.from("templates").update(row).eq("id", existing.id) : await db.from("templates").insert(row);
    return error ? json({ error: error.message }, 500) : json({ ok: true, name });
  }
  return json({ error: "unknown action" }, 400);
}));
