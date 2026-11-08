// Discord login helpers for the site (pure). Run: node test/login.test.mjs (from web-src)
import assert from "node:assert/strict";
import { readLoginResult, cleanLoginUrl, loginMessage, initials, safeAvatar } from "../src/lib/login.js";
let pass = 0, fail = 0; const t = (n, c, d) => { if (c) pass++; else { fail++; console.log("FAIL:", n, d ?? ""); } };

t("reads ok", readLoginResult("?login=ok") === "ok"); t("reads cancelled", readLoginResult("?login=cancelled") === "cancelled");
t("reads expired and failed", readLoginResult("?login=expired") === "expired" && readLoginResult("?x=1&login=failed") === "failed");
t("no param -> null", readLoginResult("") === null && readLoginResult("?x=1") === null);
t("unknown or hostile values -> null", [ "?login=<script>", "?login=ok%20ok", "?login=OK", "?login=", "?login=" + "a".repeat(500) ].every((q) => readLoginResult(q) === null));
t("junk input never throws", [null, undefined, 5, {}, "%E0%A4%A"].every((q) => readLoginResult(q) === null));

t("clean url drops ?login but keeps other query and the hash", cleanLoginUrl("/", "?login=ok", "#/diagnostics") === "/#/diagnostics" && cleanLoginUrl("/chat", "?a=1&login=ok&b=2", "#/x") === "/chat?a=1&b=2#/x");
t("clean url with no login param is unchanged", cleanLoginUrl("/", "?a=1", "#/h") === "/?a=1#/h" && cleanLoginUrl("/", "", "") === "/");

t("message for ok names the user", loginMessage("ok", "Nelly").text.includes("Nelly") && loginMessage("ok", "Nelly").kind === "success");
t("ok without a name still works", loginMessage("ok", "").text.length > 3 && !loginMessage("ok", undefined).text.includes("undefined"));
t("cancelled is info, failed and expired are errors", loginMessage("cancelled").kind === "info" && loginMessage("failed").kind === "error" && loginMessage("expired").kind === "error");
t("expired tells the user to try again", /again/i.test(loginMessage("expired").text));
t("unknown result -> null", loginMessage("zzz") === null && loginMessage(null) === null);

t("initials", initials("Nelly Smith") === "NS" && initials("nelly") === "N" && initials("") === "?" && initials(null) === "?" && initials("  ") === "?");
t("avatar only from the Discord CDN", safeAvatar("https://cdn.discordapp.com/avatars/1/a.png?size=64") === "https://cdn.discordapp.com/avatars/1/a.png?size=64");
t("other avatar urls are dropped", [ "https://evil.com/a.png", "http://cdn.discordapp.com/x", "javascript:alert(1)", "//cdn.discordapp.com/x", "", null, undefined, 5 ].every((u) => safeAvatar(u) === null));

console.log(`login: ${pass} passed, ${fail} failed`); if (fail) process.exit(1);

// ---- the sign-in gate: when does the full-screen "Continue with Discord" screen appear? ----
import { shouldShowGate } from "../src/lib/login.js";
{
  let p = 0, f = 0; const g = (n, c) => { if (c) p++; else { f++; console.log("FAIL:", n); } };
  const base = { acct: null, skipped: false, hasSession: false, sessionsLoaded: true, paired: false, hash: "", loginResult: null };
  g("first visit, no account -> gate shows", shouldShowGate(base) === true);
  g("account still loading -> NO gate (no flash)", shouldShowGate({ ...base, acct: undefined }) === false);
  g("signed in -> no gate", shouldShowGate({ ...base, acct: { name: "N" } }) === false);
  g("chose 'without an account' before -> no gate", shouldShowGate({ ...base, skipped: true }) === false);
  g("already paired with Studio (existing user) -> never gated", shouldShowGate({ ...base, paired: true }) === false);
  g("has a session already -> never gated (returning anonymous user)", shouldShowGate({ ...base, hasSession: true }) === false);
  g("diagnostics and capability pages are never gated", shouldShowGate({ ...base, hash: "#/diagnostics" }) === false && shouldShowGate({ ...base, hash: "#/capability" }) === false);
  g("just returned from Discord (?login=...) -> no gate while the result is handled", shouldShowGate({ ...base, loginResult: "ok" }) === false && shouldShowGate({ ...base, loginResult: "failed" }) === false);
  g("sessions still loading -> NO gate (a returning user must not see a flash of the sign-in screen)", shouldShowGate({ ...base, sessionsLoaded: false }) === false);
  g("account lookup failed (null) still shows the gate rather than trapping the user", shouldShowGate(base) === true);
  g("junk input never throws and never gates", [undefined, null, 5, "x", {}, []].every((x) => { try { return shouldShowGate(x) === false; } catch { return false; } }));
  console.log(`gate: ${p} passed, ${f} failed`); if (f) process.exit(1);
}
