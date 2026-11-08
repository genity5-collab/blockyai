import { urlRisk, textRisk, pageRisk, frameDecision, BLACK_FRAME_NOTE } from "../functions/_shared/screenguard.js";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
// Built at run time so this file itself holds no real-looking secret.
const j = (n) => "x".repeat(n), tok = (p, n) => p + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0".slice(0, n);

// ---------- pages that must be SAFE (a useless guard blacks these out) ----------
for (const u of ["https://create.roblox.com/docs/reference/engine/classes/TweenService", "https://www.google.com/search?q=roblox+tweenservice", "https://developer.mozilla.org/en-US/docs/Web/CSS", "https://fonts.google.com/specimen/Fredoka", "https://api.iconify.design/collections", "https://game-icons.net/", "https://github.com/Roblox/roact", "https://www.photopea.com/", "https://excalidraw.com/", "https://en.wikipedia.org/wiki/Login", "https://devforum.roblox.com/t/how-to-make-an-obby/123", "http://example.com/"])
  ok(!urlRisk(u).risky, "safe url allowed: " + u);
for (const t of ["TweenService lets you animate properties of instances. Use TweenInfo.new(1, Enum.EasingStyle.Quad).", "local part = Instance.new('Part')\npart.Size = Vector3.new(4,1,4)", "Version 0.742.1.7420710 released on 2026-11-04. 1,234,567 players online.", "The quick brown fox. Contact: support@example.com", "color: #00A2FF; width: 512px; id=7421038495", "Page 3 of 12. Order number 4111 is not a card. Scroll for more."])
  ok(!textRisk(t).risky, "ordinary text allowed: " + t.slice(0, 40));

// ---------- addresses that must be BLOCKED ----------
for (const u of ["chrome://settings/passwords", "chrome://version", "chrome-extension://abc/page.html", "view-source:https://a.com", "file:///etc/passwd", "about:blank#x", "data:text/html,<h1>x</h1>", "javascript:alert(1)", "http://localhost:9222/json", "http://127.0.0.1:6080/vnc.html", "http://169.254.169.254/latest/meta-data/", "http://192.168.1.10/admin", "http://10.0.0.5/", "https://user:pass@example.com/", "https://accounts.google.com/signin", "https://example.com/login", "https://example.com/account/security", "https://example.com/settings/api-keys", "https://example.com/checkout?x=1", "https://example.com/oauth/authorize", "https://app.example.com/page?access_token=abc123", "https://example.com/#id_token=abc", "https://example.com/p?api_key=zzz", "not a url", "https://supabase.com/dashboard/project/abc", "https://github.com/settings/tokens", "https://mail.google.com/mail/u/0/", "https://www.paypal.com/myaccount"])
  ok(urlRisk(u).risky, "risky url blocked: " + u);
ok(!urlRisk("").risky && !urlRisk(null).risky, "empty address is not by itself a risk (the text check still runs)");

// ---------- secrets in text that must be BLOCKED ----------
const secrets = {
  "private key": "-----BEGIN RSA PRIVATE KEY-----\nMIIE", "jwt": "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  "bearer": "Authorization: Bearer " + tok("", 30), "aws": "AKIA" + "ABCDEFGHIJKLMNOP", "github": tok("ghp_", 36), "slack": "xoxb-1234567890-abcdefghij", "stripe": "sk_live_" + tok("", 24), "openai": "sk-" + tok("", 30),
  "google": "AIza" + j(35).replace(/x/g, "a"), "supabase": "sb_secret_" + tok("", 30), "ours": "BLOCKY_AGENT_TOKEN=" + tok("", 20), "freestyle": "FREESTYLE_API_KEY: " + tok("", 20), "service role": "SERVICE_ROLE_KEY=" + tok("", 20),
  "password assign": 'password: "hunter22secret"', "password eq": "DB_PASSWORD=correcthorse", "api key": 'api_key = "abcd1234efgh"', "client secret": "client_secret: abcdefghijkl", "conn string": "postgresql://admin:s3cretpw@db.example.com:5432/app",
  "visa": "pay with 4111 1111 1111 1111 now", "visa dashed": "4111-1111-1111-1111", "discord": "M" + "A".repeat(23) + "." + "B".repeat(6) + "." + "C".repeat(27), "hex secret": "a".repeat(40) + "bc",
};
for (const [n, s] of Object.entries(secrets)) ok(textRisk(s).risky, "secret blocked: " + n);
ok(!textRisk("4111 1111 1111 1112 is not a valid card number").risky, "a number that fails the card check is not blocked");
ok(textRisk("Sign in\nEmail\nPassword\nForgot password?").risky, "a sign-in form is blocked");
ok(!textRisk("How to sign in a player to a Roblox game with Players.PlayerAdded").risky, "docs that merely mention 'sign in' are allowed");
// reasons never repeat the secret
for (const s of Object.values(secrets)) { const r = textRisk(s); ok(!r.why || r.why.length < 60 && !s.split(/\s+/).some((w) => w.length > 12 && r.why.includes(w)), "reason does not echo the secret"); }

// ---------- whole-page decision ----------
ok(!pageRisk({ url: "https://create.roblox.com/docs", title: "Docs", text: "Hello world" }).risky, "a normal docs page is safe");
ok(pageRisk({ url: "https://create.roblox.com/docs", title: "Docs", text: "Hello", hasPasswordField: true }).risky, "any password field blacks the view out");
ok(pageRisk({ url: "https://example.com/docs", title: "Docs", text: "token=" + tok("ghp_", 36) }).risky, "a secret in the page text blacks the view out");
ok(pageRisk({ url: "https://example.com/docs", title: "Docs", text: "ok", typed: "BLOCKY_AGENT_TOKEN=" + tok("", 20) }).risky, "a secret the AI just typed blacks the view out");
ok(pageRisk({ url: "https://example.com/docs", title: "sk-" + tok("", 30), text: "ok" }).risky, "a secret in the tab title blacks the view out");
ok(!pageRisk({}).risky && !pageRisk().risky, "no info is not 'risky' by itself (frameDecision handles unknown)");

// ---------- frameDecision: when we cannot check, we do not show ----------
ok(frameDecision(undefined).show === false && frameDecision(null).show === false && frameDecision("x").show === false, "no page info means no frame");
ok(frameDecision({ unreadable: true, url: "https://create.roblox.com/docs" }).show === false, "an unreadable page is hidden");
ok(frameDecision({ url: "https://create.roblox.com/docs", title: "t", text: "hello" }).show === true, "a checked, safe page is shown");
ok(frameDecision({ url: "https://example.com/login", title: "t", text: "hello" }).show === false && frameDecision({ url: "https://example.com/login", text: "x" }).reason_kind === "private", "a login page is hidden and labelled private");
ok(/fixing it myself/.test(BLACK_FRAME_NOTE) && !/[\u2014\u2013]/.test(BLACK_FRAME_NOTE), "the black-frame note says the AI is fixing it");
// robustness: hostile / huge input does not hang or throw
const t0 = Date.now(); const big = "a ".repeat(500000) + "password"; textRisk(big); textRisk("1".repeat(300000)); textRisk(("x".repeat(30) + " ").repeat(8000)); ok(Date.now() - t0 < 2500, "huge inputs finish fast (" + (Date.now() - t0) + "ms)");
ok(!(() => { try { urlRisk({ toString() { throw 1; } }); textRisk({}); pageRisk({ url: 5, title: [], text: {} }); return false; } catch { return true; } })(), "weird input types never throw");
console.log(`screenguard: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
