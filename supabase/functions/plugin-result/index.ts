import { authPlugin, handle, json } from "../_shared/lib.ts";
import { capResult } from "../_shared/policy.js";
import { deflate } from "https://deno.land/x/compress@v0.4.5/zlib/mod.ts";

// Encode raw RGBA (w*h*4 bytes) as a PNG. Plugins send tiny raw frames; the server does the compression.
function crc32(buf: Uint8Array) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i); out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out;
}
function rgbaToPng(w: number, h: number, rgba: Uint8Array) {
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflate(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
// Plugin reports a result, plus optional side data (edit log, playtest logs, scripts, screenshot).
Deno.serve(handle(async (req) => {
  const { db, session } = await authPlugin(req);
  const b = await req.json();
  const { command_id, ok, result, error, edit_log, playtest_logs, scripts, screenshot_b64, screenshot_rgba, snapshot, screenshot_label } = b;
  const now = new Date().toISOString();
  if (edit_log?.length) await db.from("edit_log").insert(edit_log.slice(0, 200).map((e: any) => ({ action: e.action, target: e.target, before: e.before ?? null, after: e.after ?? null, source: e.source === "user" ? "user" : (b.batch ? "bulk" : "ai"), batch_id: b.batch ? command_id : null, session_id: session.id, command_id })));
  if (playtest_logs?.length) await db.from("playtest_logs").insert(playtest_logs.slice(0, 500).map((l: any) => ({ ...l, session_id: session.id })));
  for (const sc of scripts ?? []) await db.from("script_mirror").upsert({ session_id: session.id, path: sc.path, class_name: sc.class_name, source: sc.source, updated_at: now });
  if (snapshot) await db.from("snapshots").insert({ session_id: session.id, label: snapshot.label, data: snapshot.data });
  if (screenshot_b64) {
    // several angles can come from one command, so the label is part of the file name
    const label = String(screenshot_label ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
    const path = `${session.id}/${command_id}${label ? "_" + label : ""}.png`;
    const bin = Uint8Array.from(atob(screenshot_b64), (c) => c.charCodeAt(0));
    if (bin.length < 8 || bin[0] !== 137 || bin[1] !== 80 || bin[2] !== 78 || bin[3] !== 71) return json({ error: "screenshot is not a PNG" }, 400);
    if (bin.length > 4_000_000) return json({ error: "screenshot too large" }, 413);
    await db.storage.from("screenshots").upload(path, bin, { contentType: "image/png", upsert: true });
    await db.from("screenshots").insert({ session_id: session.id, command_id, storage_path: path, label: label || null });
  }
  if (screenshot_rgba?.data && Number(screenshot_rgba.w) > 0 && Number(screenshot_rgba.h) > 0) {
    const w = Math.min(640, Number(screenshot_rgba.w)), h = Math.min(360, Number(screenshot_rgba.h));
    const rgba = Uint8Array.from(atob(String(screenshot_rgba.data)), (c) => c.charCodeAt(0));
    if (rgba.length === w * h * 4) {
      const png = rgbaToPng(w, h, rgba), path = `${session.id}/${command_id}.png`;
      await db.storage.from("screenshots").upload(path, png, { contentType: "image/png", upsert: true });
      await db.from("screenshots").insert({ session_id: session.id, command_id, storage_path: path });
    }
  }
  if (screenshot_label && result && (result as any).uploaded) return json({ ok: true, state: "extra_angle" });   // extra angle: the command already finished
  // 64 KB cap: the plugin may send more; the server keeps at most 64 KB and says so (truncated + next_cursor). The agent can ask for the next page.
  const capped = capResult(result ?? null);
  const stored = capped.truncated ? { ...(Array.isArray(capped.value) ? { items: capped.value } : { value: capped.value }), truncated: true, next_cursor: capped.next_cursor, total_bytes: capped.bytes } : (result ?? null);
  const { data: state, error: ferr } = await db.rpc("finish_command", { p_session: session.id, p_id: command_id, p_ok: !!ok, p_result: stored, p_error: error ? String(error).slice(0, 4000) : null, p_truncated: capped.truncated, p_bytes: capped.bytes });
  if (ferr) return json({ error: ferr.message }, 500);
  return json({ ok: true, state });   // state 'duplicate' = a result was already recorded (first writer wins)
}));
