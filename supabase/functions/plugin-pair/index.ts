import { admin, handle, json, randToken, sha256 } from "../_shared/lib.ts";
// Feature flags come from the plugin, so treat them as untrusted: keep only short names mapped to booleans, at most 30.
function sanitizeFeatures(f: any) {
  const out: Record<string, boolean> = {};
  if (f && typeof f === "object") for (const [k, v] of Object.entries(f).slice(0, 30)) if (/^[A-Za-z0-9_.]{1,40}$/.test(k) && typeof v === "boolean") out[k] = v;
  return out;
}
// Plugin: exchange the pairing code for a per-session token. Code is single-use.
Deno.serve(handle(async (req) => {
  const { code, place_name, studio_version, features, plugin_version } = await req.json();
  const db = admin();
  const { data: s } = await db.from("sessions").select("*").eq("pairing_code", String(code).toUpperCase()).maybeSingle();
  if (!s || !s.pairing_expires_at || new Date(s.pairing_expires_at) < new Date()) return json({ error: "invalid or expired code" }, 400);
  const token = randToken(32);
  await db.from("sessions").update({ pairing_code: null, plugin_token_hash: await sha256(token), plugin_connected_at: new Date().toISOString(), pairing_expires_at: null, place_name: String(place_name ?? "").slice(0, 80) || null, plugin_last_seen_at: new Date().toISOString() , studio_version: String(studio_version ?? "unknown").replace(/[^A-Za-z0-9 ._()-]/g, "").slice(0, 60) || "unknown", studio_features: sanitizeFeatures(features), plugin_version: Number.isFinite(Number(plugin_version)) ? Math.floor(Number(plugin_version)) : null}).eq("id", s.id);
  return json({ token, session_id: s.id, run_lua_enabled: s.run_lua_enabled });
}));
