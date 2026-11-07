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
export async function lintLuau(source, name = "script") {
  // 1. Write the file to the VM (project/lint/…) so the tools run on a real file and the model can inspect it with vm_read_file.
  const rel = `lint/${safe(name).replace(/[\/ ]+/g, "_")}.luau`;
  const w = await vmWrite(rel, source); if (!w.ok) return { formatted: source, problems: ["could not write to VM: " + w.error], report: { written: false } };
  const file = w.result.path, report = { file, written: true, stylua: null, analyze: null };
  const problems = [];
  // 2. stylua formats in place; a non-zero exit means it could not even parse the file.
  const sty = await vmExec(`stylua ${JSON.stringify(file)}`, 30);
  report.stylua = sty.ok ? { exit_code: sty.result.exit_code, stderr: sty.result.stderr.slice(0, 400) } : { error: sty.error };
  if (!sty.ok || sty.result.exit_code !== 0) problems.push("stylua (parse/format) failed: " + (sty.ok ? sty.result.stderr : sty.error).slice(0, 400));
  const formatted = (await vmRead(file)).result?.content ?? source;
  // 3. luau-analyze: real type and syntax errors. Studio-only globals are not errors, so filter that noise.
  const an = await vmExec(`luau-analyze --mode=strict ${JSON.stringify(file)}`, 45);
  const out = an.ok ? (an.result.stdout + an.result.stderr) : an.error;
  report.analyze = an.ok ? { exit_code: an.result.exit_code, output: out.slice(0, 800) } : { error: an.error };
  const lines = String(out).split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !/Unknown global '(game|workspace|script|plugin|task|Enum|Instance|Vector3|Vector2|CFrame|Color3|BrickColor|UDim2|UDim|Ray|Region3|TweenInfo|NumberSequence|ColorSequence|NumberRange|Random|DateTime|typeof|tick|wait|spawn|delay|warn|shared|settings|stats|time|elapsedTime|version|require|ipairs|pairs|utf8|bit32|debug)'/.test(l));
  for (const l of lines) { if (/(TypeError|SyntaxError)/.test(l)) problems.push(l.replaceAll(file, name)); else (report.warnings ??= []).push(l.replaceAll(file, name)); }
  report.passed = problems.length === 0;
  return { formatted, problems, report };
}


// ---------- Real VM tools. These run on the VM itself (the agent process lives here). Nothing is simulated. ----------
const SANDBOX = "/home/ubuntu/project";
const SECRET_RE = /(BLOCKY_[A-Z_]+|FREESTYLE[A-Z_]*|SERVICE_ROLE[A-Z_]*|eyJ[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{16,})/g;
export const redact = (t) => String(t ?? "").replace(SECRET_RE, "[redacted]");
// Paths for the file tools must stay inside the project folder or /tmp. No traversal, no reading /etc/blockyai.env.
export function vmPath(p) {
  const raw = String(p ?? "").trim(); if (!raw) throw new Error("path is required");
  const abs = raw.startsWith("/") ? raw : join(SANDBOX, raw);
  const norm = join("/", abs);                       // collapses ../
  if (!(norm === SANDBOX || norm.startsWith(SANDBOX + "/") || norm.startsWith("/tmp/"))) throw new Error(`path must be inside ${SANDBOX} or /tmp (got ${norm})`);
  return norm;
}
// Commands run as the agent user with a clean environment: the agent token and API addresses are NOT passed down.
export async function vmExec(command, timeoutSec = 60) {
  const cmd = String(command ?? ""); if (!cmd.trim()) return { ok: false, error: "command is empty" };
  if (/blockyai\.env|\/proc\/\d*\/?environ/.test(cmd)) return { ok: false, error: "refused: that file holds the agent credentials" };
  await mkdir(SANDBOX, { recursive: true });
  const t0 = Date.now();
  try {
    const r = await sh("bash", ["-lc", cmd], { cwd: SANDBOX, timeout: Math.min(Math.max(timeoutSec, 1), 120) * 1000, maxBuffer: 2e6,
      env: { PATH: process.env.PATH, HOME: "/home/ubuntu", LANG: "C.UTF-8" } });
    return { ok: true, result: { exit_code: 0, stdout: redact(r.stdout).slice(0, 8000), stderr: redact(r.stderr).slice(0, 4000), ms: Date.now() - t0 } };
  } catch (e) {
    // A non-zero exit is a real, reportable result, not a tool failure. Timeouts and spawn errors are tool failures.
    if (typeof e.code === "number") return { ok: true, result: { exit_code: e.code, stdout: redact(e.stdout).slice(0, 8000), stderr: redact(e.stderr).slice(0, 4000), ms: Date.now() - t0 } };
    return { ok: false, error: redact(e.killed ? `timed out after ${timeoutSec}s` : e.message).slice(0, 300) };
  }
}
export async function vmRead(path) {
  const p = vmPath(path); const text = await readFile(p, "utf8");
  return { ok: true, result: { path: p, bytes: Buffer.byteLength(text), content: redact(text).slice(0, 20000), truncated: text.length > 20000 } };
}
export async function vmWrite(path, content) {
  const p = vmPath(path); const text = String(content ?? "");
  if (text.length > 200000) return { ok: false, error: "file is over 200 KB" };
  await mkdir(dirname(p), { recursive: true }); await writeFile(p, text);
  const back = await readFile(p, "utf8");            // read it back so "written" is verified, not assumed
  return { ok: true, result: { path: p, bytes: Buffer.byteLength(back), verified: back === text } };
}

export const TOOLS = {
  vm_exec:                { args: "{command, timeout_sec?: 1-120}  runs a shell command ON THE VM; returns {exit_code, stdout, stderr}", fn: (a) => vmExec(a.command, a.timeout_sec) },
  vm_read_file:           { args: "{path}  read a file on the VM (inside the project folder or /tmp)", fn: (a) => vmRead(a.path) },
  vm_write_file:          { args: "{path, content}  write a file on the VM; verified by reading it back", fn: (a) => vmWrite(a.path, a.content) },
  roblox_get_tree:        { args: "{path?, depth?}", fn: (a) => run("get_tree", a) },
  roblox_find:            { args: "{name?, class?, under?}", fn: (a) => run("find", a) },
  roblox_set_properties:  { args: "{path, properties:{}}", fn: (a) => run("set_properties", a) },
  roblox_create:          { args: "{class, parent, name?, properties?}", fn: (a) => run("create", a) },
  roblox_delete:          { args: "{path}  (auto-snapshots first)", fn: (a) => run("delete", a) },
  roblox_move:            { args: "{path, new_parent}", fn: (a) => run("move", a) },
  roblox_read_script:     { args: "{path}", fn: async (a) => { const r = await run("read_script", a); if (r.ok && r.result?.source != null) await mirror(a.path, r.result.source); return r; } },
  roblox_write_script:    { args: "{path, source, class?}  GATED: written to the VM, run through stylua + luau-analyze first; ANY error blocks the push and is returned raw. Fix and call again.", fn: async (a) => {
      if (typeof a.source !== "string" || !a.source.trim()) return { ok: false, error: "source is empty" };
      const l = await lintLuau(a.source, a.path);
      if (l.problems.length) return { ok: false, error: "NOT pushed to Studio. Lint output (raw):\n" + l.problems.join("\n") + `\nChecked file on the VM: ${l.report.file ?? "(not written)"}` };
      await mirror(a.path, l.formatted);
      const r = await run("write_script", { ...a, source: l.formatted });
      return r.ok ? { ...r, result: { pushed: r.result, lint: { stylua_exit: l.report.stylua?.exit_code, analyze_exit: l.report.analyze?.exit_code, checked_file: l.report.file } } } : r; } },
  roblox_patch_script:    { args: "{path, find, replace}", fn: (a) => run("patch_script", a) },
  roblox_batch:           { args: "{commands:[{type,payload}]}  (max batch size enforced server-side)", fn: (a) => run("batch", a) },
  roblox_playtest_start:  { args: "{mode?: 'run'|'play', seconds?: 2-120}  starts a real test, returns immediately; wait then read logs", fn: (a) => run("playtest_start", a) },
  roblox_playtest_stop:   { args: "{}", fn: (a) => run("playtest_stop", a) },
  roblox_get_playtest_logs:{ args: "{}", fn: async () => { const st = await run("get_playtest_logs", {}); return { ok: true, result: { test: st.ok ? st.result : st.error, output: await api.data("playtest_logs", 80) } }; } },
  roblox_screenshot:      { args: "{}  returns a scene report (camera, lighting, nearest parts), not pixels", fn: async () => run("screenshot", {}) },
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
