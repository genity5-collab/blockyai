import { api } from "./api.js";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
const sh = promisify(execFile);
export const WORK = "/home/ubuntu/project";

// Wait for a Studio command to finish (long-poll, up to ~2 min).
export async function run(type, payload) {
  const q = await api.command(type, payload);
  if (q.error) return { ok: false, error: q.error };
  const end = Date.now() + 120_000;
  while (Date.now() < end) {
    const r = await api.result(q.id);
    if (r.status === "done") return { ok: true, result: r.result };
    if (r.status === "failed" || r.status === "cancelled") return { ok: false, error: r.error ?? r.status };
  }
  return { ok: false, error: q.needs_confirm ? "waiting for user confirmation (timed out)" : "plugin did not respond (is Studio open and paired?)" };
}

const safe = (p) => String(p).replace(/[^A-Za-z0-9_./ -]/g, "_").replace(/\.\.+/g, "_");
// Lint a Luau source locally in the VM BEFORE it goes into Studio.
export async function lintLuau(source) {
  const f = `/tmp/lint_${Date.now()}.luau`;
  await writeFile(f, source);
  let out = [];
  try { const r = await sh("stylua", [f]); } catch (e) { out.push("stylua: " + String(e.stderr || e.message).slice(0, 300)); }
  const formatted = await readFile(f, "utf8");
  try { await sh("luau-analyze", [f]); } catch (e) { out.push(String(e.stdout || e.stderr).replaceAll(f, "script").slice(0, 800)); }
  try { await sh("selene", [f]); } catch (e) { const t = String(e.stdout || ""); if (/error/i.test(t)) out.push(t.replaceAll(f, "script").slice(0, 500)); }
  return { formatted, problems: out.filter(Boolean) };
}

export const TOOLS = {
  roblox_get_tree:        { args: "{path?, depth?}", fn: (a) => run("get_tree", a) },
  roblox_find:            { args: "{name?, class?, under?}", fn: (a) => run("find", a) },
  roblox_set_properties:  { args: "{path, properties:{}}", fn: (a) => run("set_properties", a) },
  roblox_create:          { args: "{class, parent, name?, properties?}", fn: (a) => run("create", a) },
  roblox_delete:          { args: "{path}  (auto-snapshots first)", fn: (a) => run("delete", a) },
  roblox_move:            { args: "{path, new_parent}", fn: (a) => run("move", a) },
  roblox_read_script:     { args: "{path}", fn: async (a) => { const r = await run("read_script", a); if (r.ok && r.result?.source != null) await mirror(a.path, r.result.source); return r; } },
  roblox_write_script:    { args: "{path, source, class?}  (linted+formatted locally first; refused if type errors)", fn: async (a) => {
      const l = await lintLuau(a.source);
      const hard = l.problems.filter((p) => /TypeError|SyntaxError/.test(p));
      if (hard.length) return { ok: false, error: "lint failed, fix before pushing:\n" + hard.join("\n") };
      await mirror(a.path, l.formatted);
      const r = await run("write_script", { ...a, source: l.formatted });
      return r.ok && l.problems.length ? { ...r, warnings: l.problems } : r; } },
  roblox_patch_script:    { args: "{path, find, replace}", fn: (a) => run("patch_script", a) },
  roblox_batch:           { args: "{commands:[{type,payload}]}  (max batch size enforced server-side)", fn: (a) => run("batch", a) },
  roblox_playtest_start:  { args: "{mode?: 'run'|'play'}", fn: (a) => run("playtest_start", a) },
  roblox_playtest_stop:   { args: "{}", fn: (a) => run("playtest_stop", a) },
  roblox_get_playtest_logs:{ args: "{}", fn: async () => ({ ok: true, result: await api.data("playtest_logs", 80) }) },
  roblox_screenshot:      { args: "{}", fn: async () => { const r = await run("screenshot", {}); if (!r.ok) return r; const s = await api.data("screenshots"); return { ok: true, result: { latest_url: s?.[0]?.url } }; } },
  roblox_snapshot_save:   { args: "{label}", fn: (a) => run("snapshot_save", a) },
  roblox_snapshot_restore:{ args: "{id}  (needs user confirmation)", fn: (a) => run("snapshot_restore", a) },
  roblox_get_selection:   { args: "{}", fn: () => run("get_selection", {}) },
  roblox_get_edit_log:    { args: "{}", fn: async () => ({ ok: true, result: await api.data("edit_log", 60) }) },
  // Local VM-only tools: search the mirrored project quickly.
  local_grep:             { args: "{pattern}", fn: async (a) => { try { const r = await sh("grep", ["-rn", "-m", "5", "--", String(a.pattern).slice(0, 100), WORK], { maxBuffer: 1e6 }); return { ok: true, result: r.stdout.slice(0, 4000) }; } catch (e) { return { ok: true, result: e.stdout || "no matches" }; } } },
  local_lint:             { args: "{source}", fn: async (a) => ({ ok: true, result: await lintLuau(a.source) }) },
};
async function mirror(path, source) {
  const f = join(WORK, safe(path) + ".luau"); await mkdir(dirname(f), { recursive: true }); await writeFile(f, source);
}
