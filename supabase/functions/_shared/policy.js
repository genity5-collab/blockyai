// Pure JavaScript (no Deno/Node APIs) so BOTH the Supabase functions and the Node tests import the same code.

// ---- per-type run timeouts (seconds). Heavy builders get longer than cheap reads. ----
export const DEFAULT_TIMEOUT_S = 60;
export const TIMEOUT_S = {
  get_tree: 20, find: 20, get_selection: 10, read_script: 20, get_playtest_logs: 20, get_edit_log: 10, get_bounding_box: 15, get_pivot: 10,
  raycast: 15, find_empty_space: 30, measure_distance: 10,
  set_properties: 30, create: 30, delete: 30, move: 30, write_script: 30, patch_script: 30,
  build_model: 180, build_from_template: 180, ui_build: 120, terrain_fill: 180, terrain_heightmap: 240, lighting_set: 30, camera_set: 15,
  screenshot: 45, screenshot_multi: 90, insert_asset: 60, duplicate_array: 90, duplicate_grid: 90, duplicate_along_path: 90, mirror: 60, scale_model: 60,
  align: 60, distribute: 60, snap_to_ground: 90, batch: 240, snapshot_save: 90, snapshot_restore: 120, playtest_start: 60, playtest_stop: 30,
};
export const timeoutFor = (type) => TIMEOUT_S[type] ?? DEFAULT_TIMEOUT_S;

// ---- command categories ----
export const READ_ONLY = new Set(["get_tree", "find", "get_selection", "read_script", "get_playtest_logs", "get_edit_log", "get_bounding_box", "get_pivot", "raycast", "find_empty_space", "measure_distance", "screenshot", "screenshot_multi", "camera_set", "snapshot_save", "playtest_stop", "template_load"]);
// Allowed WHILE a playtest is active: reads, playtest control, screenshots and log reads. Everything else would change the edit-mode DataModel
// that the running test is cloned from, and the changes would be lost or confuse the test.
export const ALLOWED_DURING_PLAYTEST = new Set([...READ_ONLY, "playtest_start"]);
export const isMutating = (type) => !READ_ONLY.has(type);

// ---- result size cap ----
export const RESULT_CAP_BYTES = 64 * 1024;
const enc = (v) => new TextEncoder().encode(JSON.stringify(v ?? null));
export const byteLength = (v) => enc(v).length;
// Cap a result at 64 KB. Arrays are cut on an element boundary so the head stays valid JSON; other values become a preview string.
// Returns { value, truncated, bytes, next_cursor }. next_cursor is the index of the first element NOT returned (arrays only).
// Guarantee: the returned value is ALWAYS <= cap bytes when serialized. The shapes below are first attempts; the final loop
// re-measures and keeps shrinking, so a wrong size estimate can never produce an oversized result.
export function capResult(value, cap = RESULT_CAP_BYTES, startIndex = 0) {
  const bytes = byteLength(value);
  if (bytes <= cap) return { value, truncated: false, bytes, next_cursor: null };
  if (Array.isArray(value)) {
    let lo = 0, hi = value.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (byteLength(value.slice(0, mid)) <= cap - 200) lo = mid; else hi = mid - 1; }
    if (lo === 0) return { value: [`[first element is ${byteLength(value[0])} bytes, over the ${cap}-byte cap]`], truncated: true, bytes, next_cursor: startIndex + 1 < startIndex + value.length ? startIndex + 1 : null };
    return { value: value.slice(0, lo), truncated: true, bytes, next_cursor: lo < value.length ? startIndex + lo : null };
  }
  if (value && typeof value === "object") {
    let budget = cap - 400, out = shrinkObject(value, budget);
    for (let i = 0; i < 12 && byteLength(out) > cap; i++) { budget = Math.floor(budget * 0.7); out = shrinkObject(value, budget); }
    if (byteLength(out) > cap) out = { _truncated: `result of ${bytes} bytes did not fit the ${cap}-byte cap`, keys: Object.keys(value).slice(0, 50) };
    return { value: out, truncated: true, bytes, next_cursor: null };
  }
  if (typeof value === "string") { let n = cap - 120; let out = value.slice(0, n) + `... [${value.length} chars total]`; while (byteLength(out) > cap && n > 10) { n = Math.floor(n * 0.8); out = value.slice(0, n) + `... [${value.length} chars total]`; } return { value: out, truncated: true, bytes, next_cursor: null }; }
  return { value, truncated: true, bytes, next_cursor: null };
}
// Fit an object into `budget` bytes: small fields stay whole, big strings are clipped, big arrays are cut on an element boundary.
function shrinkObject(obj, budget) {
  const out = {}; let used = 2;
  const entries = Object.entries(obj).sort((x, y) => byteLength(x[1]) - byteLength(y[1]));   // smallest first so scalars always survive
  const fair = Math.max(300, Math.floor(budget / Math.max(1, entries.length)));
  for (const [k, v] of entries) {
    const room = Math.max(120, Math.min(budget - used - 40, Math.max(fair, byteLength(v) <= fair ? byteLength(v) : fair)));
    const b = byteLength(v);
    if (b <= room) { out[k] = v; used += b + k.length + 6; continue; }
    if (Array.isArray(v)) { const c = capResult(v, room, 0); out[k] = c.value; out[k + "_truncated"] = true; out[k + "_total"] = v.length; used += byteLength(c.value) + k.length * 2 + 40; }
    else if (typeof v === "string") { out[k] = v.slice(0, Math.max(40, room - 80)) + `... [${v.length} chars cut]`; used += room; }
    else { out[k] = `[${b} bytes omitted]`; used += 40; }
  }
  return out;
}

// ---- risk tiers ----
// Expand batch / batch_refs into their sub-commands BEFORE classifying, so a batch cannot hide a HIGH step.
export function expandCommands(type, payload, depth = 0) {
  if (depth > 3) return [{ type, payload: payload ?? {}, deep: true }];
  if (type === "batch" || type === "batch_refs") {
    const subs = Array.isArray(payload?.commands) ? payload.commands : Array.isArray(payload?.steps) ? payload.steps : [];
    return subs.flatMap((c) => expandCommands(String(c?.type ?? c?.name ?? ""), c?.payload ?? c?.args ?? {}, depth + 1));
  }
  return [{ type, payload: payload ?? {} }];
}
const TOP_LEVEL = /^(game\.|Game\.|DataModel\.)?(Workspace|ServerScriptService|ServerStorage|ReplicatedStorage|ReplicatedFirst|StarterGui|StarterPack|StarterPlayer|Lighting|SoundService|Teams|Chat)$/i;
const SCRIPT_CLASS = /^(Script|LocalScript|ModuleScript)$/;
export const risk = (type, payload = {}) => {
  if (["delete", "snapshot_restore", "run_lua"].includes(type)) return "high";
  if (["create", "write_script", "patch_script", "build_model", "build_from_template", "ui_build", "insert_asset", "terrain_fill", "terrain_heightmap", "duplicate_array", "duplicate_grid", "duplicate_along_path", "mirror", "scale_model", "lighting_set", "template_save"].includes(type)) return "medium";
  if (["set_properties", "move", "align", "distribute", "snap_to_ground"].includes(type)) return "low";
  return READ_ONLY.has(type) ? "low" : "medium";
};
const RANK = { low: 0, medium: 1, high: 2 };
// Classify a command, including everything inside batches. Returns { tier, reasons, needsApproval, steps }.
//   ctx.tainted = the session saw instruction-like untrusted content: EVERY high action then needs approval.
//   ctx.deleteCount(payload) may supply a live count; otherwise it is estimated from the payload (paths array length, or `count`).
export function classify(type, payload = {}, ctx = {}) {
  const steps = expandCommands(type, payload);
  let tier = "low"; const reasons = []; let needsApproval = false;
  for (const s of steps) {
    const t = risk(s.type, s.payload);
    if (RANK[t] > RANK[tier]) tier = t;
    if (s.deep) { tier = "high"; needsApproval = true; reasons.push("batch nested too deeply to inspect"); }
    if (t !== "high") continue;
    if (s.type === "run_lua") { needsApproval = true; reasons.push("run_lua always needs approval"); }
    if (s.type === "snapshot_restore") { needsApproval = ctx.restoreVerified === true ? needsApproval : true; if (ctx.restoreVerified !== true) reasons.push("snapshot_restore is not yet proven by a real restore test, so it needs approval"); }
    if (s.type === "delete") {
      const paths = Array.isArray(s.payload?.paths) ? s.payload.paths : s.payload?.path ? [s.payload.path] : [];
      const n = ctx.deleteCount ? ctx.deleteCount(s.payload) : Number(s.payload?.count ?? paths.length);
      if (!Number.isFinite(n) || n > 10) { needsApproval = true; reasons.push(`deletes ${Number.isFinite(n) ? n : "an unknown number of"} instances (more than 10)`); }
      if (paths.some((p) => TOP_LEVEL.test(String(p).trim()))) { needsApproval = true; reasons.push("deletes a top-level service child"); }
      if (SCRIPT_CLASS.test(String(s.payload?.class ?? s.payload?.class_name ?? "")) || s.payload?.is_script === true || paths.some((p) => /\.(server|client)?\.?lua[u]?$/i.test(String(p)))) { needsApproval = true; reasons.push("deletes a script"); }
      if (!paths.length && !s.payload?.count && !s.payload?.under) { needsApproval = true; reasons.push("delete target is unclear"); }
    }
    if (ctx.tainted) { needsApproval = true; reasons.push("session is tainted (instruction-like text was seen in untrusted content)"); }
  }
  return { tier, needsApproval, reasons: [...new Set(reasons)], steps: steps.map((s) => s.type) };
}
