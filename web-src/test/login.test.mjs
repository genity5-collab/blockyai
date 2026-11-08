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

// ---- the sign-in gate: FORCED. No Discord account = the sign-in screen, before the plugin steps. ----
import { shouldShowGate } from "../src/lib/login.js";
{
  let p = 0, f = 0; const g = (n, c) => { if (c) p++; else { f++; console.log("FAIL:", n); } };
  const base = { acct: null, hash: "", loginResult: null };
  g("signed out -> gate shows", shouldShowGate(base) === true);
  g("account still loading -> NO gate yet (no flash)", shouldShowGate({ ...base, acct: undefined }) === false);
  g("signed in -> no gate", shouldShowGate({ ...base, acct: { name: "N" } }) === false);
  g("an existing session, paired Studio or saved session id do NOT bypass it any more", shouldShowGate({ ...base, hasSession: true, paired: true, skipped: true, sessionsLoaded: true }) === true);
  g("diagnostics and capability pages are never gated (they are tools, not the product)", shouldShowGate({ ...base, hash: "#/diagnostics" }) === false && shouldShowGate({ ...base, hash: "#/capability" }) === false);
  g("returned from Discord with ok and the account is loaded -> signed in, no gate", shouldShowGate({ ...base, loginResult: "ok", acct: { name: "N" } }) === false);
  g("returned with ?login=ok but the account is not there yet -> still waits (no flash of the gate)", shouldShowGate({ ...base, loginResult: "ok", acct: undefined }) === false);
  g("returned with cancelled/failed/expired -> the gate shows again so they can retry", ["cancelled", "expired", "failed"].every((r) => shouldShowGate({ ...base, loginResult: r }) === true));
  g("junk input never throws and never gates", [undefined, null, 5, "x", [], {}].every((x) => { try { return shouldShowGate(x) === false; } catch { return false; } }));
  console.log(`gate: ${p} passed, ${f} failed`); if (f) process.exit(1);
}

// ---- tokens: pure helpers for the UI ----
import { weekView, tokenTone, claimMessage } from "../src/lib/tokensui.js";
{
  let p = 0, f = 0; const g = (n, c) => { if (c) p++; else { f++; console.log("FAIL:", n); } };
  const week = [["Mon", 20], ["Tue", 15], ["Wed", 20], ["Thu", 10], ["Fri", 30], ["Sat", 15], ["Sun", 15]].map(([name, reward], i) => ({ name, reward, today: i === 6 }));
  let v = weekView(week, true);
  g("week: Mon..Sat are in the past (missed or claimed-earlier, can't be claimed), Sun is today", v.slice(0, 6).every((d) => d.state === "past") && v[6].state === "today");
  g("week: today is claimable when not yet claimed", v[6].claimable === true && v.slice(0, 6).every((d) => d.claimable === false));
  v = weekView(week, false); g("week: after claiming, today shows as claimed and is not claimable", v[6].state === "claimed" && v[6].claimable === false);
  const mid = week.map((d, i) => ({ ...d, today: i === 2 })); v = weekView(mid, true);
  g("week: a mid-week today -> earlier days past, later days upcoming", v[0].state === "past" && v[1].state === "past" && v[2].state === "today" && v[3].state === "upcoming" && v[6].state === "upcoming");
  g("week: upcoming days are never claimable", v.filter((d) => d.state === "upcoming").every((d) => !d.claimable));
  g("week: junk input gives an empty list and never throws", weekView(null, true).length === 0 && weekView(undefined, false).length === 0 && weekView("x", true).length === 0);
  g("tone: 0 is 'empty', under 5 is 'low', otherwise 'ok'", tokenTone(0) === "empty" && tokenTone(3) === "low" && tokenTone(5) === "ok" && tokenTone(100) === "ok" && tokenTone(NaN) === "empty" && tokenTone(-4) === "empty");
  g("claim message: ok mentions the amount", /\+15/.test(claimMessage({ ok: true, added: 15, balance: 40 }).text) && claimMessage({ ok: true, added: 15 }).kind === "success");
  g("claim message: at the cap says the balance is full", /full|100/i.test(claimMessage({ ok: true, added: 0, balance: 100 }).text));
  g("claim message: already claimed / missed / not yet are clear and not errors", ["already_claimed", "missed", "not_yet"].every((r) => claimMessage({ ok: false, reason: r }).kind === "info" && claimMessage({ ok: false, reason: r }).text.length > 8));
  g("claim message: unknown failure is an error", claimMessage({ ok: false, reason: "zzz" }).kind === "error" && claimMessage(null).kind === "error");
  console.log(`tokens ui: ${p} passed, ${f} failed`); if (f) process.exit(1);
}
