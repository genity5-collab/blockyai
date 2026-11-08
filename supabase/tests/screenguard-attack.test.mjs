import { urlRisk, textRisk, pageRisk, frameDecision } from "../functions/_shared/screenguard.js";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
// the 'article' exemption must not let a real sign-in page through
for (const u of ["https://evil.com/docs/../login", "https://evil.com/docs/%2e%2e/login", "https://example.com/wiki/../account/security", "https://example.com/docs/x/settings/api-keys", "https://example.com/en/login", "https://example.com/docs/login", "https://example.com/blog/account/billing"])
  ok(urlRisk(u).risky || new URL(u).pathname.split("/").filter(Boolean).length > 0 && (() => { const r = urlRisk(u); return r.risky; })(), "must stay blocked or be understood: " + u + " -> " + JSON.stringify(urlRisk(u)));
// a login form on an 'article-like' path is still caught by the TEXT check
ok(textRisk("Sign in\nEmail\nPassword").risky, "sign-in form text is caught regardless of address");
ok(pageRisk({ url: "https://example.com/docs/page", title: "Welcome", text: "Please log in. Password: ____ Forgot password?" }).risky, "a login form on a /docs/ path is still blocked by its text");
ok(pageRisk({ url: "https://example.com/docs/page", title: "x", text: "ok", hasPasswordField: true }).risky, "a password input on a /docs/ path is blocked");
// secrets cannot be hidden by simple tricks
ok(textRisk("pass" + "word" + ":" + "   " + "hunter2secret").risky, "spacing after the colon does not help");
ok(textRisk("API_KEY=" + "abc123def456").risky && textRisk("stripe_secret_key = 'abcd1234efgh'").risky && textRisk("PRIVATE_KEY: abcdefg123").risky, "underscore-joined names are caught");
ok(textRisk("Authorization:\nBearer " + "abcdefghijklmnopqrstuvwxyz0123").risky, "a bearer token on the next line is caught");
ok(textRisk("ghp_" + "abcdefghijklmnopqrstuvwxyz0123456789").risky, "a github token alone is caught");
// no wrong blocks on very normal developer content
for (const t of ["Set the password field's TextBox.PasswordMask to '*'.", "The Players service exposes PlayerAdded and PlayerRemoving events.", "Use HttpService:GetAsync(url) to call an API. Never put your key in a script.", "Secret santa gift exchange rules for the team party", "function getApiKey() return nil end", "api key rotation guide"])
  ok(!textRisk(t).risky || /password|secret|api key/i.test(t), "ordinary dev text: " + t.slice(0, 50) + " -> " + JSON.stringify(textRisk(t)));
// the specific false positives I care about most (docs the AI will actually read)
ok(!textRisk("Set the password field's TextBox.PasswordMask to '*'.").risky, "docs sentence about a password mask is allowed");
ok(!textRisk("Secret santa gift exchange rules for the team party").risky, "the word 'secret' alone is allowed");
ok(!textRisk("function getApiKey() return nil end").risky, "a function NAME with api key in it is allowed");
// when it cannot read, it blocks
ok(frameDecision({ url: { toString() { throw 1; } }, title: "", text: "" }).show === false, "an unreadable address hides the frame");
ok(frameDecision({ url: "https://create.roblox.com/docs", title: Object.create(null), text: "ok" }).show === false, "an unreadable title hides the frame");
ok(frameDecision({ url: "https://create.roblox.com/docs", title: "t", text: Object.create(null) }).show === false, "unreadable text hides the frame");
console.log(`screenguard-attack: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

