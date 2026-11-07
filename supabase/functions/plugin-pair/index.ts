import { admin, handle, json, randToken, sha256 } from "../_shared/lib.ts";
// Plugin: exchange the pairing code for a per-session token. Code is single-use.
Deno.serve(handle(async (req) => {
  const { code } = await req.json();
  const db = admin();
  const { data: s } = await db.from("sessions").select("*").eq("pairing_code", String(code).toUpperCase()).maybeSingle();
  if (!s || Date.now() - new Date(s.created_at).getTime() > 600_000) return json({ error: "invalid or expired code" }, 400);
  const token = randToken(32);
  await db.from("sessions").update({ pairing_code: null, plugin_token_hash: await sha256(token), plugin_connected_at: new Date().toISOString(), plugin_last_seen_at: new Date().toISOString() }).eq("id", s.id);
  return json({ token, session_id: s.id, run_lua_enabled: s.run_lua_enabled });
}));
