// What to do when a tool call fails. Pure functions, no I/O.
//
// The old rule stopped the run when the SAME ERROR TEXT appeared twice, or after 4 failures in a row. That kills a build for a recoverable
// miss ("path not found") yet does nothing about a model hammering one tool. This module decides by the KIND of error and by the exact CALL.
//
//   fatal  - only the user can fix it (Studio offline, VM down, auth, user said no). Stop at once, show the raw error.
//   retry  - transient (timeout, rate limit). Send the SAME call again, a bounded number of times.
//   fix    - the call itself was wrong (bad path, failed lint, missing hash). Hand the raw error back to the model so it changes something.
//            Unknown errors land here: never silently fatal, and the budgets below still bound them.
//
// Stop conditions on top of the kinds: the same call failing twice in a row (a loop), a per-tool budget, and a per-run budget.

// Real strings from the plugin, the edge functions and the agent. Fatal is checked first so a fatal phrase inside a longer message still wins.
const FATAL = /plugin not responding|plugin did not respond|waiting for user confirmation|rejected by user|rejected in studio|cancelled by (the )?user|stopped by user|run_lua is (disabled|off)|LLM error|http 401|invalid or expired token|VM is not running|no VM yet|refused: non self-hosted|pair studio first|credentials/i;
const RETRY = /rate limit|timed out|timeout|temporar|storage:|still working|try again|econnreset|http 5\d\d|http 429/i;

export function classifyError(err) {
  const e = String(err ?? "");
  if (FATAL.test(e)) return { kind: "fatal" };
  if (RETRY.test(e)) return { kind: "retry" };
  return { kind: "fix" };
}

// Same call = same tool name + same arguments, regardless of key order.
const canon = (v) => (v && typeof v === "object" ? (Array.isArray(v) ? v.map(canon) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))) : v);
export const callKey = (c) => { try { return `${c?.name}|${JSON.stringify(canon(c?.args ?? {}))}`; } catch { return `${c?.name}|?`; } };

export class FailureTracker {
  constructor({ maxRetries = 2, perToolBudget = 6, perRunBudget = 14 } = {}) {
    Object.assign(this, { maxRetries, perToolBudget, perRunBudget });
    this.lastFailedKey = null; this.retries = new Map(); this.perTool = new Map(); this.total = 0;
  }
  // A success ends a "same call twice in a row" streak. It never refunds the budgets.
  recordSuccess(_call) { this.lastFailedKey = null; }
  // -> { action: "continue" | "retry" | "stop", reason?, kind }
  record(call, err) {
    const raw = String(err ?? "unknown error"); const { kind } = classifyError(raw); const key = callKey(call);
    this.total++; this.perTool.set(call?.name, (this.perTool.get(call?.name) ?? 0) + 1);
    if (kind === "fatal") { this.lastFailedKey = key; return { action: "stop", kind, reason: `needs your action: ${raw.slice(0, 300)}` }; }
    if (this.perTool.get(call?.name) > this.perToolBudget) return { action: "stop", kind, reason: `${call?.name} has failed more than ${this.perToolBudget} times this run. Last error: ${raw.slice(0, 300)}` };
    if (this.total > this.perRunBudget) return { action: "stop", kind, reason: `more than ${this.perRunBudget} tool failures this run (budget). Last error: ${raw.slice(0, 300)}` };
    if (kind === "retry") {
      const n = (this.retries.get(key) ?? 0) + 1; this.retries.set(key, n); this.lastFailedKey = key;
      return n <= this.maxRetries ? { action: "retry", kind } : { action: "stop", kind, reason: `${call?.name} kept failing after ${this.maxRetries} retries. Last error: ${raw.slice(0, 300)}` };
    }
    // fix: the model may try something different. The exact same call failing again right after is a loop.
    const repeat = this.lastFailedKey === key; this.lastFailedKey = key;
    return repeat ? { action: "stop", kind, reason: `the same call to ${call?.name} failed twice in a row (it repeats instead of changing). Last error: ${raw.slice(0, 300)}` } : { action: "continue", kind };
  }
}
