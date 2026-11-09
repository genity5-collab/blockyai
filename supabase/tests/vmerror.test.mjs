// When the AI's computer cannot start, the user gets a plain reason, never the provider's raw text, and the site knows whether trying again can help.
import test from "node:test"; import assert from "node:assert/strict";
import { explainVmError } from "../functions/_shared/vmerror.js";

test("the provider's allowance error becomes a plain 'unavailable' message that says retrying will not help right now", () => {
  const e = explainVmError(new Error("Cannot start this VM because the allowance for memory_time, vcpu_time has been used. Add a card to unlock the full Free allowance, wait for the allowance to reset, or upgrade to Hobby; then resume the VM manually."));
  assert.equal(e.reason, "capacity"); assert.equal(e.retry, false);
  assert.match(e.message, /AI computer/i); assert.doesNotMatch(e.message, /memory_time|vcpu_time|Hobby|allowance|card/i, "no provider wording or billing advice goes to a user");
});
test("a status 429 or LIMIT_EXCEEDED is also 'capacity'", () => {
  for (const x of [{ status: 429, message: "x" }, { code: "LIMIT_EXCEEDED", message: "x" }, new Error("LIMIT_EXCEEDED: nope"), "rate limit exceeded 429"]) assert.equal(explainVmError(x).reason, "capacity", JSON.stringify(x));
});
test("a timeout or network blip is 'busy' and worth retrying", () => {
  for (const x of [new Error("fetch failed"), new Error("request timed out"), new Error("ECONNRESET"), { status: 503, message: "unavailable" }, { status: 502, message: "bad gateway" }]) { const e = explainVmError(x); assert.equal(e.reason, "busy", String(x.message ?? x)); assert.equal(e.retry, true); }
});
test("the agent not starting on a good VM is 'agent' and not blamed on capacity", () => {
  const e = explainVmError(new Error("agent service failed to start: node: cannot find module")); assert.equal(e.reason, "agent"); assert.equal(e.retry, true);
});
test("anything else is a generic 'error' with a short safe message", () => {
  const e = explainVmError(new Error("boom BLOCKY_AGENT_TOKEN=abcdef1234567890abcdef service_role eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnopqrstuvwx"));
  assert.equal(e.reason, "error"); assert.ok(!/abcdef1234567890|eyJhbGci|service_role/.test(JSON.stringify(e)), "no secret text in what the user sees");
});
test("bad input never throws", () => { for (const x of [null, undefined, 42, {}, [], "", Symbol.iterator.toString()]) { const e = explainVmError(x); assert.ok(e.reason && typeof e.message === "string" && typeof e.retry === "boolean"); } });
test("every message is short, plain text, with no markup", () => {
  for (const x of ["allowance has been used", "fetch failed", "agent service failed", "weird"]) { const m = explainVmError(new Error(x)).message; assert.ok(m.length > 20 && m.length < 200 && !/[<>{}]/.test(m), m); }
});
