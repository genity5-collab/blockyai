import { api } from "./api.js";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
const sh = promisify(execFile);
export const WORK = "/home/ubuntu/project";
const SANDBOX = WORK;

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
// ---------------------------------------------------------------------------------------------------------------------
// Luau checking. luau-lsp's `analyze` is the same Luau analyzer as luau-analyze PLUS Roblox type definitions, so valid Roblox
// code is not flagged and real API mistakes (part.Sizee, Material = "Neon") are. Plain luau-analyze runs as a second opinion
// for syntax. stylua --check reports formatting; stylua (without --check) is used to format what gets pushed.
// ---------------------------------------------------------------------------------------------------------------------
export const TYPES_FILE = `${SANDBOX}/types/globalTypes.d.luau`;
export const hashSource = (src) => createHash("sha256").update(String(src)).digest("hex").slice(0, 16);
export const lintLedger = new Map();                       // content hash -> { at, name, passed }  (this session only; the agent restarts per session)
export const LINT_LINE_THRESHOLD = 30;
export const countLines = (src) => String(src).split("\n").filter((l, i, a) => i < a.length - 1 || l.length).length;

// Parse "file(line,col): Kind: message" lines into structured errors.
export function parseDiagnostics(out, file) {
  const errors = [], warnings = [];
  for (const raw of String(out).split("\n")) {
    const m = raw.match(/\((\d+),(\d+)\):\s*([A-Za-z]+):\s*(.*)$/); if (!m) continue;
    const d = { line: +m[1], column: +m[2], kind: m[3], message: m[4].replaceAll(file, "script").slice(0, 300) };
    (/^(TypeError|SyntaxError)$/.test(d.kind) ? errors : warnings).push(d);
  }
  return { errors, warnings };
}

export async function lintLuau(source, name = "script") {
  const src = String(source ?? ""); const hash = hashSource(src);
  const rel = `lint/${safe(name).replace(/[\/ ]+/g, "_")}.luau`;
  const w = await vmWrite(rel, src);
  if (!w.ok) return { formatted: src, problems: ["could not write to VM: " + w.error], report: { written: false }, errors: [], warnings: [], passed: false, hash };
  const file = w.result.path, report = { file, written: true, analyzer: null, stylua_check: null };
  const problems = [], errors = [], warnings = [];
  const haveTypes = (await vmExec(`test -s ${JSON.stringify(TYPES_FILE)} && echo yes`, 10)).result?.stdout.trim() === "yes";
  report.roblox_types = haveTypes;
  // 1. Syntax/format via stylua --check (does NOT modify the file). Non-zero with "error parsing" = it cannot parse.
  const chk = await vmExec(`stylua --check ${JSON.stringify(file)} 2>&1`, 30);
  const chkOut = chk.ok ? chk.result.stdout + chk.result.stderr : chk.error;
  report.stylua_check = { exit_code: chk.ok ? chk.result.exit_code : null, formatting_ok: chk.ok && chk.result.exit_code === 0, parse_error: /error parsing/i.test(chkOut) };
  if (report.stylua_check.parse_error) problems.push("stylua could not parse the file: " + chkOut.split("\n").filter((l) => /unexpected|expected|error/i.test(l)).slice(0, 3).join(" | ").replaceAll(file, name).slice(0, 400));
  // 2. Type + syntax analysis with Roblox definitions.
  const cmd = haveTypes ? `luau-lsp analyze --definitions=${TYPES_FILE} --no-flags-enabled ${JSON.stringify(file)} 2>&1` : `luau-analyze --mode=strict ${JSON.stringify(file)} 2>&1`;
  const an = await vmExec(cmd, 60);
  const out = an.ok ? an.result.stdout + an.result.stderr : an.error;
  report.analyzer = { tool: haveTypes ? "luau-lsp analyze (+Roblox types)" : "luau-analyze --mode=strict (NO Roblox types: some false errors possible)", exit_code: an.ok ? an.result.exit_code : null };
  if (!an.ok) problems.push("analyzer did not run: " + an.error);
  else {
    const d = parseDiagnostics(out, file);
    // Without Roblox types the engine globals are "unknown" - that is a limit of the tool, not a bug in the script, so don't count it.
    const noise = haveTypes ? () => false : (e) => /Unknown (global|type) '/.test(e.message);
    for (const e of d.errors) { if (noise(e)) warnings.push(e); else errors.push(e); }
    warnings.push(...d.warnings);
    if (an.result.exit_code !== 0 && !d.errors.length && !d.warnings.length) problems.push("analyzer failed with no diagnostics: " + out.replaceAll(file, name).slice(0, 300));
  }
  for (const e of errors) problems.push(`${name}(${e.line},${e.column}): ${e.kind}: ${e.message}`);
  // 3. Formatted version = what we push (stylua formats in place, after analysis).
  await vmExec(`stylua ${JSON.stringify(file)}`, 30);
  const formatted = (await vmRead(file)).result?.content ?? src;
  const passed = problems.length === 0;
  lintLedger.set(hash, { at: Date.now(), name, passed, lines: countLines(src) });
  // The pushed text is the FORMATTED text, so remember that hash as linted too (same content, only whitespace differs).
  if (passed && formatted !== src) lintLedger.set(hashSource(formatted), { at: Date.now(), name, passed: true, lines: countLines(formatted) });
  report.passed = passed;
  return { formatted, problems, report, errors, warnings, passed, hash };
}


// ---------- Real VM tools. These run on the VM itself (the agent process lives here). Nothing is simulated. ----------
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

// ---------- Mirror: a copy of Studio's scripts on the VM, keyed by instance path ----------
export const MIRROR = `${SANDBOX}/mirror`;
export const SCRIPT_CLASSES = ["Script", "LocalScript", "ModuleScript"];
const SERVICES = ["Workspace", "ServerScriptService", "ServerStorage", "ReplicatedStorage", "ReplicatedFirst", "StarterGui", "StarterPack", "StarterPlayer", "Lighting", "SoundService"];
// "ServerScriptService.Game.Main" -> mirror/ServerScriptService/Game/Main.<Class>.luau  (class in the name so we can restore it)
export function mirrorFile(instPath, cls) {
  const parts = String(instPath).split(/[./]/).filter(Boolean).map((x) => x.replace(/[^A-Za-z0-9_ -]/g, "_").replace(/^\.+$/, "_"));
  if (!parts.length) throw new Error("empty instance path");
  const leaf = parts.pop();
  return join(MIRROR, ...parts, `${leaf}.${cls}.luau`);
}
export function instFromMirrorFile(file) {
  const rel = file.slice(MIRROR.length + 1).replace(/\.(Script|LocalScript|ModuleScript)\.luau$/, "");
  const cls = (file.match(/\.(Script|LocalScript|ModuleScript)\.luau$/) || [])[1];
  return { path: rel.split("/").join("."), cls };
}
// Names that contain a dot or slash can't round-trip through the path syntax; report them instead of mangling silently.
const roundTrips = (instPath) => !/[^A-Za-z0-9_ .-]/.test(instPath);

async function syncMirror(a = {}) {
  const t0 = Date.now(); const found = new Map(); const warnings = []; let capped = 0;
  const roots = a.under ? [String(a.under)] : SERVICES;
  for (const root of roots) for (const cls of SCRIPT_CLASSES) {
    const r = await run("find", { class: cls, under: root });
    if (!r.ok) { if (/not found/i.test(r.error ?? "")) continue; return { ok: false, error: `find ${cls} under ${root}: ${r.error}` }; }
    const list = Array.isArray(r.result) ? r.result : [];
    if (list.length >= 100) { capped++; warnings.push(`${root}/${cls}: hit the 100-result limit of roblox_find; some scripts may be missing. Re-run with under:"<a narrower path>".`); }
    for (const p of list) found.set(p, cls);
  }
  await vmExec(`rm -rf ${JSON.stringify(a.under ? MIRROR + "/_none_" : MIRROR)} && mkdir -p ${JSON.stringify(MIRROR)}`, 30);
  const index = {}; let count = 0, failed = 0, bytes = 0;
  for (const [p, cls] of found) {
    if (!roundTrips(p)) { warnings.push(`skipped "${p}": the name has characters that can't be safely mapped to a file path`); continue; }
    const r = await run("read_script", { path: p });
    if (!r.ok || r.result?.source == null) { failed++; warnings.push(`could not read ${p}: ${r.error ?? "no source"}`); continue; }
    const file = mirrorFile(p, r.result.class ?? cls);
    const w = await vmWrite(file, r.result.source);
    if (!w.ok || !w.result.verified) { failed++; warnings.push(`could not write ${file}`); continue; }
    index[p] = { class: r.result.class ?? cls, hash: hashSource(r.result.source), file }; count++; bytes += w.result.bytes;
  }
  await vmWrite(join(MIRROR, "_index.json"), JSON.stringify(index));       // what Studio had at sync time, for push_changed
  const tree = await vmExec(`cd ${MIRROR} && find . -type f -name '*.luau' | sort | head -60`, 15);
  return { ok: true, result: { file_count: count, failed, bytes, capped_searches: capped, warnings: warnings.slice(0, 12), mirror: MIRROR, ms: Date.now() - t0, sample: tree.result?.stdout.trim().split("\n").slice(0, 25) } };
}

// Compare the mirror to what Studio had at sync time, and push ONLY what changed. Re-checks Studio first so a concurrent
// edit by the user is never silently overwritten.
async function pushChanged(a = {}) {
  const idxRead = await vmRead(join(MIRROR, "_index.json"));
  if (!idxRead.ok) return { ok: false, error: "no mirror index. Run sync_mirror first." };
  let index; try { index = JSON.parse(idxRead.result.content); } catch { return { ok: false, error: "mirror index is corrupt. Run sync_mirror again." }; }
  const ls = await vmExec(`cd ${MIRROR} && find . -type f -name '*.luau' | sort`, 20);
  if (!ls.ok) return { ok: false, error: ls.error };
  const changed = [], created = [], unchanged = []; const skipped = [];
  for (const rel of ls.result.stdout.trim().split("\n").filter(Boolean)) {
    const file = join(MIRROR, rel); const { path, cls } = instFromMirrorFile(file);
    if (!cls) { skipped.push(`${rel}: unrecognised file name`); continue; }
    const cur = (await vmRead(file)).result?.content ?? "";
    const known = index[path];
    if (!known) { created.push({ path, cls, source: cur }); continue; }
    if (hashSource(cur) !== known.hash) changed.push({ path, cls, source: cur, before: known.hash }); else unchanged.push(path);
  }
  const todo = [...changed, ...created];
  if (a.dry_run || !todo.length) return { ok: true, result: { pushed: 0, dry_run: !!a.dry_run, would_push: todo.map((x) => x.path), unchanged: unchanged.length, skipped } };
  // Gate every file. Big scripts must pass the Roblox-aware lint first; a failure blocks the WHOLE push (all-or-nothing).
  const cmds = [], failures = [];
  for (const f of todo) {
    const l = await lintLuau(f.source, f.path);
    if (!l.passed) { failures.push(`${f.path}: ${l.problems.slice(0, 3).join(" | ")}`); continue; }
    cmds.push({ type: "write_script", payload: { path: f.path, source: l.formatted, class: f.cls }, _meta: f });
  }
  if (failures.length) return { ok: false, error: `NOTHING pushed. ${failures.length} script(s) failed analysis:\n` + failures.join("\n") };
  // Studio-side conflict check: refuse to overwrite a script that changed in Studio since the sync.
  const conflicts = [];
  for (const c of cmds) { if (!index[c.payload.path]) continue;
    const r = await run("read_script", { path: c.payload.path });
    if (r.ok && hashSource(r.result.source) !== index[c.payload.path].hash) conflicts.push(c.payload.path); }
  if (conflicts.length) return { ok: false, error: "NOTHING pushed. These scripts changed in Studio after the sync, so pushing would overwrite someone's edit: " + conflicts.join(", ") + ". Run sync_mirror and redo the change." };
  const r = await run("batch", { commands: cmds.map(({ type, payload }) => ({ type, payload })) });
  if (!r.ok) return r;
  const results = Array.isArray(r.result) ? r.result : [];
  const bad = results.map((x, i) => (x?.ok ? null : `${cmds[i].payload.path}: ${x?.error ?? "failed"}`)).filter(Boolean);
  if (bad.length) return { ok: false, error: `batch partly failed (${results.length - bad.length}/${results.length} applied):\n` + bad.join("\n") };
  // refresh the index so a second push_changed only sends new edits
  for (const c of cmds) index[c.payload.path] = { class: c.payload.class, hash: hashSource(c.payload.source), file: mirrorFile(c.payload.path, c.payload.class) };
  await vmWrite(join(MIRROR, "_index.json"), JSON.stringify(index));
  return { ok: true, result: { pushed: cmds.length, updated: changed.map((x) => x.path), created: created.map((x) => x.path), unchanged: unchanged.length, skipped } };
}

// Structured lint for the model: errors with line numbers, pass/fail, and the content hash the push guard checks.
async function vmLintLuau(a = {}) {
  if (typeof a.source !== "string" || !a.source.trim()) return { ok: false, error: "source is empty" };
  const name = String(a.name ?? a.script_name ?? "script");
  const l = await lintLuau(a.source, name);
  return { ok: true, result: { passed: l.passed, content_hash: l.hash, lines: countLines(a.source), errors: l.errors.slice(0, 30), warnings: l.warnings.slice(0, 15).map((w) => `${w.line}:${w.column} ${w.kind}: ${w.message}`),
    analyzer: l.report.analyzer?.tool, roblox_types_loaded: !!l.report.roblox_types, formatting_ok: l.report.stylua_check?.formatting_ok, file_on_vm: l.report.file,
    note: l.passed ? "Passed analysis. This is NOT a playtest: it does not prove the script works." : "FAILED. Fix every error, then lint again before pushing." } };
}

export const TOOLS = {
  vm_exec:                { args: "{command, timeout_sec?: 1-120}  runs a shell command ON THE VM; returns {exit_code, stdout, stderr}", fn: (a) => vmExec(a.command, a.timeout_sec) },
  vm_lint_luau:           { args: "{name, source}  writes to the VM, runs luau-lsp (Roblox types) + stylua --check; returns {passed, content_hash, errors:[{line,column,message}]}", fn: vmLintLuau },
  sync_mirror:            { args: "{under?}  copy every script from Studio into the VM at /home/ubuntu/project/mirror/<instance path>; returns file_count", fn: syncMirror },
  push_changed:           { args: "{dry_run?}  diff the mirror against what Studio had at sync time; lint and push ONLY modified scripts in one roblox_batch (all-or-nothing)", fn: pushChanged },
  vm_read_file:           { args: "{path}  read a file on the VM (inside the project folder or /tmp)", fn: (a) => vmRead(a.path) },
  vm_write_file:          { args: "{path, content}  write a file on the VM; verified by reading it back", fn: (a) => vmWrite(a.path, a.content) },
  plan_create:            { args: "{title, items:[string,...] (2..30), target_path?}  REQUIRED before any build. The numbered checklist is shown live to the user. target_path = the model/area you are building (e.g. \"Workspace.Yacht\"); the server refuses to let you finish if it has fewer than 5 descendants.", fn: async (a) => {
      if (!Array.isArray(a.items) || a.items.length < 2) return { ok: false, error: "items must be a list of at least 2 checklist steps" };
      const r = await api.plan("create", { title: a.title, items: a.items, target_path: a.target_path });
      return r?.error ? { ok: false, error: r.error } : { ok: true, result: { plan_id: r.plan.id, items: r.plan.items.map((i) => `#${i.id} ${i.text}`), note: "Work through the items in order. Tick each with plan_update. The last items must be verification (screenshots/playtest)." } }; } },
  plan_update:            { args: "{updates:[{id, done?, verified?, note?}], add_items?:[string], target_path?}  tick items as you finish them; verified:true only after you actually checked (screenshot/playtest)", fn: async (a) => {
      const r = await api.plan("update", { updates: a.updates, add_items: a.add_items, target_path: a.target_path });
      if (r?.error) return { ok: false, error: r.error };
      const left = r.plan.items.filter((i) => !i.done);
      return { ok: true, result: { done: r.plan.items.length - left.length, total: r.plan.items.length, remaining: left.map((i) => `#${i.id} ${i.text}`) } }; } },
  roblox_get_tree:        { args: "{path?, depth?}", fn: (a) => run("get_tree", a) },
  roblox_find:            { args: "{name?, class?, under?}", fn: (a) => run("find", a) },
  roblox_set_properties:  { args: "{path, properties:{}}", fn: (a) => run("set_properties", a) },
  roblox_create:          { args: "{class, parent, name?, properties?}", fn: (a) => run("create", a) },
  roblox_delete:          { args: "{path}  (auto-snapshots first)", fn: (a) => run("delete", a) },
  roblox_move:            { args: "{path, new_parent}", fn: (a) => run("move", a) },
  roblox_read_script:     { args: "{path}", fn: async (a) => { const r = await run("read_script", a); if (r.ok && r.result?.source != null) await mirror(a.path, r.result.source); return r; } },
  roblox_write_script:    { args: "{path, source, class?}  GUARDED: a script over 30 lines is refused unless this exact content already passed vm_lint_luau in this session. Smaller scripts are analyzed automatically.", fn: async (a) => {
      if (typeof a.source !== "string" || !a.source.trim()) return { ok: false, error: "source is empty" };
      const lines = countLines(a.source);
      // Hard rule: big script + no prior passing lint of THIS content = refuse, even if the code happens to be clean.
      if (lines > LINT_LINE_THRESHOLD && !lintLedger.get(hashSource(a.source))?.passed)
        return { ok: false, error: `REFUSED: this script is ${lines} lines (limit ${LINT_LINE_THRESHOLD} without a prior lint). No passing vm_lint_luau result exists for this exact source (content hash ${hashSource(a.source)}). Run vm_lint_luau on it in the VM first, fix every error, then call roblox_write_script again with the same source.` };
      const l = await lintLuau(a.source, a.path);        // small scripts are analyzed here; big ones are re-checked so the pushed (formatted) text is what was verified
      if (!l.passed) return { ok: false, error: "NOT pushed to Studio. Analysis failed (raw):\n" + l.problems.join("\n") + `\nChecked file on the VM: ${l.report.file ?? "(not written)"}` };
      await mirror(a.path, l.formatted);
      const r = await run("write_script", { ...a, source: l.formatted });
      return r.ok ? { ...r, result: { pushed: r.result, lines, lint: { analyzer: l.report.analyzer?.tool, content_hash: l.hash, checked_file: l.report.file }, note: "Pushed. This is NOT a playtest." } } : r; } },
  roblox_patch_script:    { args: "{path, find, replace}", fn: (a) => run("patch_script", a) },
  roblox_batch:           { args: "{commands:[{type,payload}]}  (max batch size enforced server-side)", fn: (a) => run("batch", a) },
  roblox_playtest_start:  { args: "{mode?: 'run'|'play', seconds?: 2-120}  starts a real test, returns immediately; wait then read logs", fn: (a) => run("playtest_start", a) },
  roblox_playtest_stop:   { args: "{}", fn: (a) => run("playtest_stop", a) },
  roblox_get_playtest_logs:{ args: "{}", fn: async () => { const st = await run("get_playtest_logs", {}); return { ok: true, result: { test: st.ok ? st.result : st.error, output: await api.data("playtest_logs", 80) } }; } },
  roblox_screenshot:      { args: "{}  scene report (camera, lighting, nearest parts, sizes, colors). For real pixels from several angles use screenshot_multi", fn: async () => run("screenshot", {}) },
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

// Build tools live in their own file (they import run from here), merged in after TOOLS is defined.
import { BUILD_TOOLS } from "./tools-build.js";
Object.assign(TOOLS, BUILD_TOOLS);
