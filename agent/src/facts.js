// "No simulation" in code. Three things the MODEL cannot talk its way around:
//  1. RunLedger  - a record of every tool call made this run, written by the loop from what the tools REALLY returned.
//  2. factsEmbed - a table built ONLY from that record and attached to the final reply by the system, not by the model.
//  3. findFabricated / claimWarnings - catch a model that writes its own "tool results", or says it tested/verified something no tool did.
import { isMutatingTool } from "./lifecycle.js";

const SCRIPT_TOOLS = new Set(["roblox_write_script", "roblox_patch_script"]);
const BUILD_TOOLS_SET = new Set(["build_model", "build_from_template"]);
const SHOT_TOOLS = new Set(["roblox_screenshot", "screenshot_multi"]);
const READ_ONLY_STUDIO = new Set(["roblox_get_tree", "roblox_find", "roblox_read_script", "roblox_get_selection", "get_bounding_box", "get_pivot", "raycast", "measure_distance", "find_empty_space", "roblox_get_edit_log"]);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export class RunLedger {
  constructor() { this.calls = []; this.fabricated = 0; }
  add(name, args, out) {
    this.calls.push({ name: String(name), args: args && typeof args === "object" ? args : {}, ok: !!out?.ok,
      result: out?.ok && out.result && typeof out.result === "object" ? out.result : null, error: out?.ok ? null : String(out?.error ?? "unknown error").slice(0, 200) });
  }
  noteFabricated() { this.fabricated++; }
  // Real work, not bookkeeping: plan_* calls do not count.
  get workCount() { return this.calls.filter((c) => !c.name.startsWith("plan_")).length; }
  ok(pred) { return this.calls.filter((c) => c.ok && pred(c)); }
}

export function buildFacts(ledger) {
  const L = ledger.calls.filter((c) => !c.name.startsWith("plan_"));
  const okc = (pred) => L.filter((c) => c.ok && pred(c));
  const rows = [];
  const scripts = okc((c) => SCRIPT_TOOLS.has(c.name));
  const pushed = okc((c) => c.name === "push_changed").reduce((n, c) => n + num(c.result?.pushed), 0);
  if (scripts.length || pushed) { const paths = [...new Set(scripts.map((c) => String(c.args.path ?? "?")))]; rows.push(["Scripts written to Studio", `${scripts.length + pushed}` + (paths.length ? ` (${paths.slice(0, 4).join(", ")}${paths.length > 4 ? ", ..." : ""})` : "")]); }
  const builds = L.filter((c) => BUILD_TOOLS_SET.has(c.name));
  if (builds.length) {
    const good = builds.filter((c) => c.ok); const inst = good.reduce((n, c) => n + num(c.result?.instances), 0); const errs = good.reduce((n, c) => n + num(c.result?.error_count), 0);
    rows.push(["Models built", `${good.length} of ${builds.length} build calls ok, ${inst} instances created` + (errs ? `, ${errs} child errors` : "")]);
  }
  const other = okc((c) => isMutatingTool(c.name) && !SCRIPT_TOOLS.has(c.name) && !BUILD_TOOLS_SET.has(c.name) && c.name !== "push_changed" && !c.name.startsWith("roblox_playtest") && !SHOT_TOOLS.has(c.name) && !c.name.startsWith("roblox_snapshot"));
  if (other.length) rows.push(["Other changes to the game", `${other.length} (${[...new Set(other.map((c) => c.name.replace(/^roblox_/, "")))].slice(0, 5).join(", ")})`]);
  const pt = okc((c) => c.name === "roblox_playtest_start").length, logs = okc((c) => c.name === "roblox_get_playtest_logs").length;
  if (pt || logs) rows.push(["Playtests", `${pt} started, logs read ${logs} time(s)`]);
  const shots = okc((c) => SHOT_TOOLS.has(c.name)).length; if (shots) rows.push(["Screenshots taken", String(shots)]);
  const lints = L.filter((c) => c.name === "vm_lint_luau" && c.ok); if (lints.length) { const p = lints.filter((c) => c.result?.passed === true).length; rows.push(["Lint (on the VM)", `${p} passed, ${lints.length - p} failed`]); }
  const runs = L.filter((c) => c.name === "vm_run_luau" && c.ok); if (runs.length) { const p = runs.filter((c) => c.result?.exit_code === 0).length; rows.push(["Code run on the VM", `${p} exited cleanly, ${runs.length - p} failed`]); }
  const web = okc((c) => c.name === "vm_web_fetch" || c.name === "vm_web_search").length; if (web) rows.push(["Web", `${web} lookup(s)`]);
  const failed = L.filter((c) => !c.ok);
  rows.push(["Tool calls", `${L.length} total, ${failed.length} failed`]);
  const last = L.at(-1); if (last && !last.ok) rows.push(["Last step", `FAILED: ${last.name}: ${last.error}`.slice(0, 160)]);
  if (ledger.fabricated) rows.push(["Fake tool results the AI wrote", `${ledger.fabricated} (ignored)`]);
  const flags = {
    playtested: pt > 0, ranCode: runs.length > 0, screenshotted: shots > 0, lintedOk: lints.some((c) => c.result?.passed === true),
    inspected: L.some((c) => c.ok && READ_ONLY_STUDIO.has(c.name)), changed: scripts.length + pushed + builds.filter((c) => c.ok).length + other.length > 0,
    readLogs: logs > 0, any: L.length > 0,
  };
  return { rows, flags };
}

// Things the model may SAY that no tool backs up. Heuristic on purpose: it only fires on first-person or past-tense claims.
const CLAIMS = [
  { re: /\b(?:i(?:'ve| have)?\s+(?:play-?tested|tested|ran|run)\b|(?:play-?tests?|tests?)\s+(?:passed|succeeded|ran (?:clean|successfully))|it\s+(?:works|worked)\b)/i,
    ok: (f) => f.playtested || f.ranCode, msg: "says it tested or ran this, but no playtest or code run was recorded" },
  { re: /\b(?:verified|confirmed|double-checked)\b/i,
    ok: (f) => f.playtested || f.ranCode || f.screenshotted || f.inspected || f.lintedOk, msg: "says it verified this, but no check (playtest, code run, screenshot, or a read of the game) was recorded" },
  { re: /\bno (?:errors|warnings|issues|problems|bugs)\b/i,
    ok: (f) => f.playtested || f.readLogs || f.lintedOk || f.ranCode, msg: "says there are no errors, but no playtest, log read, lint or code run was recorded" },
];
export function claimWarnings(text, flags) {
  const t = String(text ?? ""); const out = [];
  for (const c of CLAIMS) if (c.re.test(t) && !c.ok(flags)) out.push(c.msg);
  return out;
}

export function factsEmbeds(ledger, finalText, { outcome = "complete" } = {}) {
  const { rows, flags } = buildFacts(ledger); const embeds = [];
  const warns = claimWarnings(finalText, flags);
  if (ledger.workCount > 0 || ledger.fabricated) embeds.push({ type: "table", title: "Checked by the system from real tool results (not written by the AI)", columns: ["What", "Result"], rows });
  if (warns.length) embeds.push({ type: "warning", title: "Not backed by a tool result", body: "The AI " + warns.join("; and ") + ". Treat that statement as unverified." });
  if (outcome === "complete" && flags.changed && !flags.playtested && !flags.screenshotted && !flags.ranCode)
    embeds.push({ type: "info", title: "Not tested yet", body: "Nothing was playtested or screenshotted this run, so this is built but not shown to work. Press Play in Studio, or ask me to playtest it." });
  return embeds;
}

// A model that writes its own "Tool result for X (ok): ..." is inventing outcomes. The real ones only ever come from the system.
const FAKE_HEAD = /^[ \t]*(?:\*\*)?Tool result for [A-Za-z_]+ \((?:ok|FAILED)\)(?:\*\*)?:?.*$/gim;
const FAKE_TAGS = /<(tool_result|function_results|tool_response|untrusted_game_data)\b[\s\S]*?(?:<\/\1>|$)/gi;
export function findFabricated(text) {
  const s = String(text ?? ""); let found = false; let cleaned = s;
  // Remove the header line and everything after it until a blank line (the invented result body).
  cleaned = cleaned.replace(/^[ \t]*(?:\*\*)?Tool result for [A-Za-z_]+ \((?:ok|FAILED)\)(?:\*\*)?:?[^\n]*(?:\n(?!\s*\n)[^\n]*)*/gim, () => { found = true; return ""; });
  cleaned = cleaned.replace(FAKE_TAGS, () => { found = true; return ""; });
  return { found, cleaned: found ? cleaned.replace(/\n{3,}/g, "\n\n").trim() : s };
}
