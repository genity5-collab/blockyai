import { authPlugin, handle, json } from "../_shared/lib.ts";
// The plugin posts the result of its in-Studio self-test (no AI involved). Everything is untrusted input: sizes and types are clamped.
const STATUS = new Set(["pass", "fail", "skip", "fallback"]);
// Keep detail small: a value whose JSON is over 2000 characters is replaced by a truncated text preview.
function clampDetail(d: unknown) {
  if (d === undefined || d === null) return null;
  let text: string;
  try { text = JSON.stringify(d); } catch { return { unserializable: true }; }
  return text.length <= 2000 ? d : { truncated: true, preview: text.slice(0, 1800) };
}
Deno.serve(handle(async (req) => {
  const { db, session } = await authPlugin(req);
  const b = await req.json().catch(() => ({}));
  const steps = (Array.isArray(b.steps) ? b.steps : []).slice(0, 40).map((s: any) => ({
    name: String(s?.name ?? "").slice(0, 120),
    status: STATUS.has(s?.status) ? s.status : "fail",
    error: s?.error ? String(s.error).slice(0, 1500) : null,
    ms: Number.isFinite(Number(s?.ms)) ? Math.max(0, Math.min(3_600_000, Math.floor(Number(s.ms)))) : 0,
    detail: clampDetail(s?.detail),
  }));
  const count = (st: string) => steps.filter((s: any) => s.status === st).length;
  const features: Record<string, boolean> = {};
  if (b.features && typeof b.features === "object") for (const [k, v] of Object.entries(b.features).slice(0, 30)) if (/^[A-Za-z0-9_.]{1,40}$/.test(k) && typeof v === "boolean") features[k] = v;
  const row = {
    session_id: session.id, studio_version: String(b.studio_version ?? "unknown").replace(/[^A-Za-z0-9 ._()-]/g, "").slice(0, 60),
    plugin_version: Number.isFinite(Number(b.plugin_version)) ? Math.floor(Number(b.plugin_version)) : null, features,
    passed: count("pass") + count("fallback"), failed: count("fail"), skipped: count("skip"), steps,
  };
  const { data, error } = await db.from("selftests").insert(row).select("id").single();
  if (error) return json({ error: error.message }, 500);
  // keep only the 20 most recent runs per session
  const { data: old } = await db.from("selftests").select("id").eq("session_id", session.id).order("created_at", { ascending: false }).range(20, 200);
  if (old?.length) await db.from("selftests").delete().in("id", old.map((o: any) => o.id));
  return json({ ok: true, id: data.id, passed: row.passed, failed: row.failed, skipped: row.skipped });
}));
