import { authAgent, handle, json } from "../_shared/lib.ts";

// The VM reports every tool call here. Scoped to the agent token's own session. Secrets are redacted AGAIN server-side.
const SECRET = /(BLOCKY_[A-Z_]+\s*=?\s*\S*|FREESTYLE\w*\s*=?\s*\S*|SERVICE_ROLE\w*\s*=?\s*\S*|eyJ[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{16,}|sbp_[A-Za-z0-9]{20,}|fs_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g;
const clean = (v: unknown, n: number) => (v == null ? null : String(v).replace(SECRET, "[redacted]").slice(0, n));
// Which side of the wall a tool is on. Decided HERE from the name. Tools that act on Studio without the roblox_ prefix are listed explicitly.
export const STUDIO_TOOLS = new Set(["build_model","build_from_template","duplicate_array","duplicate_grid","duplicate_along_path","mirror","scale_model","align","distribute","snap_to_ground","get_bounding_box","get_pivot","raycast","find_empty_space","measure_distance","camera_set","screenshot_multi","terrain_fill","terrain_heightmap","lighting_set","ui_build","insert_asset","batch_refs"]);
export const VM_TOOLS = new Set(["sync_mirror","push_changed"]);
export const family = (name: string) => (name.startsWith("roblox_") || STUDIO_TOOLS.has(name) ? "roblox" : name.startsWith("vm_") || VM_TOOLS.has(name) ? "vm" : "local");   // plan_*, template_* are bookkeeping = local

// Only these numeric keys are kept from a result, and only if they are finite numbers or booleans.
export const SUMMARY_KEYS = ["instances","parts","welds","error_count","sections","requested","captured","scripts_found","scripts_removed","samples","count","inserted","done","total","lines","hit","overlapping","passed"];
export function summarizeResult(r: unknown) {
  if (!r || typeof r !== "object") return null;
  const out: Record<string, number | boolean> = {};
  for (const k of SUMMARY_KEYS) { const v = (r as any)[k]; if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean") out[k] = v; }
  return Object.keys(out).length ? out : null;
}

Deno.serve(handle(async (req) => {
  const { db, session } = await authAgent(req);
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").slice(0, 60);
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) return json({ error: "bad tool name" }, 400);
  const row = {
    session_id: session.id,
    message_id: typeof b.message_id === "string" && /^[0-9a-f-]{36}$/i.test(b.message_id) ? b.message_id : null,
    run_id: clean(b.run_id, 60), seq: Math.max(0, Math.min(Number(b.seq) || 0, 1000)),
    name, family: family(name),                       // family is decided HERE from the tool name, not trusted from the client
    args_summary: clean(b.args_summary, 300), ok: !!b.ok, error: b.ok ? null : clean(b.error, 600),
    duration_ms: Math.max(0, Math.min(Number(b.duration_ms) || 0, 3_600_000)),
    result_summary: summarizeResult(b.result_summary),
  };
  const { error } = await db.from("tool_calls").insert(row);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, family: row.family });
}));
