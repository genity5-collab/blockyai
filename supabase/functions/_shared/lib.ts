import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-token, x-plugin-token, x-client-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

export async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const randToken = (n = 32) =>
  [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

// Allowlisted command types: the ONLY ways the agent can touch Studio.
export const ALLOWED = new Set([
  "get_tree","find","set_properties","create","delete","move","read_script","write_script","patch_script",
  "batch","playtest_start","playtest_stop","get_playtest_logs","screenshot","snapshot_save","snapshot_restore",
  "get_selection","run_lua",
]);
export const DESTRUCTIVE = new Set(["delete","snapshot_restore","batch","run_lua"]);

// Auth for the VM: scoped, short-lived, bound to ONE session.
export async function authAgent(req: Request) {
  const tok = req.headers.get("x-agent-token");
  if (!tok) throw new Response("missing token", { status: 401 });
  const db = admin();
  const { data: s } = await db.from("sessions").select("*").eq("agent_token_hash", await sha256(tok)).maybeSingle();
  if (!s || !s.agent_token_expires_at || new Date(s.agent_token_expires_at) < new Date())
    throw new Response("invalid or expired token", { status: 401 });
  return { db, session: s };
}
// Auth for the Roblox plugin: per-session token issued at pairing.
export async function authPlugin(req: Request) {
  const tok = req.headers.get("x-plugin-token");
  if (!tok) throw new Response("missing token", { status: 401 });
  const db = admin();
  const { data: s } = await db.from("sessions").select("*").eq("plugin_token_hash", await sha256(tok)).maybeSingle();
  if (!s) throw new Response("invalid token", { status: 401 });
  return { db, session: s };
}
// Auth for the web user (JWT).
export async function authUser(req: Request) {
  const db = admin();
  const jwt = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  const { data } = await db.auth.getUser(jwt);
  if (!data.user) throw new Response("unauthorized", { status: 401 });
  return { db, user: data.user };
}
export const handle = (fn: (req: Request) => Promise<Response>) => async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try { return await fn(req); }
  catch (e) { if (e instanceof Response) return new Response(await e.text(), { status: e.status, headers: cors });
    return json({ error: String((e as Error).message ?? e) }, 500); }
};

// ---- Anonymous owner auth (swap point for real auth later: accept a JWT here and map it to an owner id) ----
export async function ownerHash(req: Request) {
  const key = req.headers.get("x-client-key") ?? "";
  if (key.length < 24 || key.length > 128) throw new Response("missing client key", { status: 401 });
  return await sha256("ck:" + key);
}
export async function authOwner(req: Request, sessionId?: string | null) {
  const db = admin(); const oh = await ownerHash(req);
  if (!sessionId) return { db, oh, session: null as any };
  const { data: s } = await db.from("sessions").select("*").eq("id", sessionId).eq("owner_key_hash", oh).maybeSingle();
  if (!s) throw new Response("session not found", { status: 404 });
  return { db, oh, session: s };
}
// Never return secrets to the browser.
export const publicSession = (s: any) => {
  const { plugin_token_hash, agent_token_hash, agent_token_expires_at, owner_key_hash, pairing_code, vm_id, ...rest } = s; return rest;
};
