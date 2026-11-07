import { authPlugin, handle, json } from "../_shared/lib.ts";
// Plugin reports a result, plus optional side data (edit log, playtest logs, scripts, screenshot).
Deno.serve(handle(async (req) => {
  const { db, session } = await authPlugin(req);
  const b = await req.json();
  const { command_id, ok, result, error, edit_log, playtest_logs, scripts, screenshot_b64, snapshot } = b;
  const now = new Date().toISOString();
  if (edit_log?.length) await db.from("edit_log").insert(edit_log.slice(0, 200).map((e: any) => ({ action: e.action, target: e.target, before: e.before ?? null, after: e.after ?? null, source: e.source === "user" ? "user" : (b.batch ? "bulk" : "ai"), batch_id: b.batch ? command_id : null, session_id: session.id, command_id })));
  if (playtest_logs?.length) await db.from("playtest_logs").insert(playtest_logs.slice(0, 500).map((l: any) => ({ ...l, session_id: session.id })));
  for (const sc of scripts ?? []) await db.from("script_mirror").upsert({ session_id: session.id, path: sc.path, class_name: sc.class_name, source: sc.source, updated_at: now });
  if (snapshot) await db.from("snapshots").insert({ session_id: session.id, label: snapshot.label, data: snapshot.data });
  if (screenshot_b64) {
    const path = `${session.id}/${command_id}.png`;
    const bin = Uint8Array.from(atob(screenshot_b64), (c) => c.charCodeAt(0));
    await db.storage.from("screenshots").upload(path, bin, { contentType: "image/png", upsert: true });
    await db.from("screenshots").insert({ session_id: session.id, command_id, storage_path: path });
  }
  await db.from("commands").update({ status: ok ? "done" : "failed", result: result ?? null, error: error ?? null, finished_at: now }).eq("id", command_id).eq("session_id", session.id);
  return json({ ok: true });
}));
