import { authAgent, handle, json } from "../_shared/lib.ts";
import { planFrame } from "../_shared/screenflow.js";
import { BLACK_FRAME_NOTE } from "../_shared/screenguard.js";

// The VM sends {image (base64 JPEG/PNG), url, title, text, has_password_field, typed, activity}. THIS function decides what the user may see (see screenflow.js).
// Cannot check -> hide. Risky -> hide. Only the latest frame is kept. The user never receives the page text, only the picture.
Deno.serve(handle(async (req) => {
  const { db, session } = await authAgent(req);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ error: "send JSON" }, 400); }

  const { data: prev } = await db.from("screen_frames").select("seq,storage_path,updated_at").eq("session_id", session.id).maybeSingle();
  const plan = planFrame(b, prev ?? null);
  if (plan.action === "reject") return json({ error: plan.error }, plan.status);
  if (plan.action === "skip") return json({ ok: true, skipped: "too fast, the previous frame stays" });

  let path: string | null = null;
  if (plan.action === "show") {
    path = `${session.id}/${Date.now()}.${plan.ext}`;                     // a UUID folder and a timestamp, never text from the VM
    const up = await db.storage.from("screen").upload(path, plan.bytes, { contentType: plan.mime, upsert: false });
    if (up.error) return json({ error: "could not store the frame" }, 500);
  }
  const seq = (prev?.seq ?? 0) + 1;
  const { error } = await db.from("screen_frames").upsert({ session_id: session.id, seq, updated_at: new Date().toISOString(), ...plan.row, storage_path: path });
  if (error) { if (path) await db.storage.from("screen").remove([path]); return json({ error: "could not save the frame" }, 500); }
  // Keep ONLY the latest frame. List the session's folder and delete everything except the file the row points to, so even two frames that raced each other
  // (both read the same previous row) cannot leave an orphaned picture of the screen behind.
  const { data: files } = await db.storage.from("screen").list(session.id, { limit: 100 });
  const stale = (files ?? []).map((f: any) => `${session.id}/${f.name}`).filter((n: string) => n !== path);
  if (stale.length) await db.storage.from("screen").remove(stale);
  return json(plan.action === "show" ? { ok: true, shown: true, seq } : { ok: true, shown: false, seq, hidden: BLACK_FRAME_NOTE, why: plan.row.hidden_why });
}));
