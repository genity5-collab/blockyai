// Regression guard: the queue states are queued/claimed/running/done/failed/cancelled/expired. The old 'pending' no longer exists, so any
// query that filters on it silently matches nothing (approve/reject/stop would do nothing). Scan every edge function for it.
import test from "node:test"; import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs"; import { join } from "node:path";
const ROOT = new URL("../supabase/functions/", import.meta.url).pathname;
const files = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "_shared").map((d) => join(ROOT, d.name, "index.ts"));
test("no function filters or sets a command status of 'pending'", () => {
  const bad = [];
  for (const f of files) readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return;                                   // comments are fine
    if (/status["']?\s*[,:=]\s*["']pending["']|\[[^\]]*["']pending["'][^\]]*\]/.test(line)) bad.push(`${f.split("/functions/")[1]}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
  assert.deepEqual(bad, []);
});
test("every status used in a query on the commands table is a real queue state", () => {
  const REAL = new Set(["queued", "claimed", "running", "done", "failed", "cancelled", "expired"]);
  const bad = []; let checked = 0;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // one statement per db.from("<table>") ... up to the next db.from or the end of the line's statement; only look at the commands ones
    for (const stmt of src.split(/(?=db\.from\(")/)) {
      if (!/^db\.from\("commands"\)/.test(stmt)) continue;
      const head = stmt.split(/\n\s*\n|;\s*\n/)[0];
      for (const m of head.matchAll(/status["']?\s*[:,]\s*"([a-z]+)"|\.eq\("status",\s*"([a-z]+)"\)|\.in\("status",\s*\[([^\]]*)\]/g)) {
        const names = m[1] ? [m[1]] : m[2] ? [m[2]] : m[3].split(",").map((x) => x.trim().replace(/"/g, ""));
        for (const n of names) { checked++; if (n && !REAL.has(n)) bad.push(`${f.split("/functions/")[1]}: '${n}'`); }
      }
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(checked >= 8, `scan looked at too few status uses (${checked}); the matcher may be broken`);
});
// The matcher is shared so the "does it really catch it" test exercises the very same regex the scan uses.
const STALE = /status["']?\s*[,:=]\s*["']pending["']|\[[^\]]*["']pending["'][^\]]*\]/;
test("the guard itself works: it catches stale statuses and ignores good ones", () => {
  assert.ok(STALE.test('.eq("status", "pending")'), "must catch .eq('status','pending')");
  assert.ok(STALE.test('.in("status", ["pending", "running"])'), "must catch an .in([...]) list");
  assert.ok(STALE.test('update({ status: "pending" })'), "must catch an update");
  assert.ok(!STALE.test('.eq("status", "queued")'), "must not flag queued");
  assert.ok(!STALE.test('const pending_confirmations = []'), "must not flag an unrelated variable");
});
