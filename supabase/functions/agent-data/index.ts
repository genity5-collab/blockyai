import { authAgent, handle, json } from "../_shared/lib.ts";
// kind: edit_log | playtest_logs | screenshots | scripts | session
Deno.serve(handle(async (req) => {
  const { db, session } = await authAgent(req);
  const u = new URL(req.url); const kind = u.searchParams.get("kind");
  const limit = Math.min(Number(u.searchParams.get("limit") ?? 100), 500);
  if (kind === "edit_log") return json((await db.from("edit_log").select("*").eq("session_id", session.id).order("created_at",{ascending:false}).limit(limit)).data);
  if (kind === "playtest_logs") return json((await db.from("playtest_logs").select("*").eq("session_id", session.id).order("id",{ascending:false}).limit(limit)).data);
  if (kind === "scripts") return json((await db.from("script_mirror").select("*").eq("session_id", session.id)).data);
  if (kind === "screenshots") {
    const { data } = await db.from("screenshots").select("*").eq("session_id", session.id).order("created_at",{ascending:false}).limit(5);
    const out = [];
    for (const s of data ?? []) { const { data: sig } = await db.storage.from("screenshots").createSignedUrl(s.storage_path, 300); out.push({ ...s, url: sig?.signedUrl }); }
    return json(out);
  }
  if (kind === "session") return json({ id: session.id, max_iterations: session.max_iterations, run_lua_enabled: session.run_lua_enabled, plugin_last_seen_at: session.plugin_last_seen_at });
  return json({ error: "unknown kind" }, 400);
}));
