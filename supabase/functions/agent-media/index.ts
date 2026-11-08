import { authAgent, handle, json } from "../_shared/lib.ts";
import { checkImage, decodeBase64, cleanName } from "../_shared/mediacheck.js";

// The agent (on its VM) downloads an image, then uploads the bytes here. This function NEVER fetches a URL itself, so it cannot be turned
// into a server-side request forgery tool. It only checks what it is handed: the real file type from its own bytes, its size and dimensions.
const MAX_PER_SESSION = 60;                       // images kept per session
const MAX_PER_MINUTE = 12;                        // upload rate per session
const srcOf = (v: unknown) => { try { const u = new URL(String(v ?? "")); return u.protocol === "https:" || u.protocol === "http:" ? u.origin + u.pathname.slice(0, 200) : null; } catch { return null; } };

Deno.serve(handle(async (req) => {
  const { db, session } = await authAgent(req);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ error: "send JSON: {name, data (base64), source_url?}" }, 400); }

  const dec = decodeBase64(b?.data); if (!dec.ok) return json({ error: dec.error }, 400);
  const chk = checkImage(dec.bytes); if (!chk.ok) return json({ error: chk.error }, 400);

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count: recent } = await db.from("media").select("id", { count: "exact", head: true }).eq("session_id", session.id).gte("created_at", since);
  if ((recent ?? 0) >= MAX_PER_MINUTE) return json({ error: `too many images at once (max ${MAX_PER_MINUTE} per minute). Wait a bit.` }, 429);
  const { count: total } = await db.from("media").select("id", { count: "exact", head: true }).eq("session_id", session.id);
  if ((total ?? 0) >= MAX_PER_SESSION) return json({ error: `this session already has ${MAX_PER_SESSION} images` }, 429);

  const id = crypto.randomUUID();
  const path = `${session.id}/${id}.${chk.ext}`;                  // built only from UUIDs and a fixed extension, never from user text
  const up = await db.storage.from("media").upload(path, dec.bytes, { contentType: chk.mime, upsert: false });
  if (up.error) return json({ error: "could not store the image" }, 500);
  const { error } = await db.from("media").insert({ id, session_id: session.id, name: cleanName(b?.name), mime: chk.mime, size: chk.size, width: chk.width, height: chk.height, storage_path: path, source_url: srcOf(b?.source_url) });
  if (error) { await db.storage.from("media").remove([path]); return json({ error: "could not save the image" }, 500); }
  return json({ id, mime: chk.mime, width: chk.width, height: chk.height, size: chk.size, note: "Show it in chat with an embed: {\"type\":\"image\",\"media_id\":\"" + id + "\",\"title\":\"...\",\"alt\":\"...\"}" });
}));
