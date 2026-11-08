import { readFileSync } from "node:fs";
import { planFrame, hostOf, MIN_GAP_MS } from "../functions/_shared/screenflow.js";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const D = new URL("../../", import.meta.url).pathname;
const jpg = readFileSync(D + "screen/test/sample-screen.jpg").toString("base64"), png = readFileSync(D + "screen/test/sample-button.png").toString("base64");
const good = { image: jpg, url: "https://create.roblox.com/docs/reference/engine/classes/TweenService", title: "TweenService", text: "TweenService lets you animate", activity: "Reading the TweenService page" };
const NOW = Date.parse("2026-11-08T12:00:00Z");

let p = planFrame(good, null, NOW);
ok(p.action === "show" && p.mime === "image/jpeg" && p.ext === "jpg" && p.row.width === 1280 && p.row.height === 800 && p.row.host === "create.roblox.com" && p.row.title === "TweenService", "a safe page is shown with real size and site name");
ok(p.row.activity === "Reading the TweenService page", "activity kept");
ok(!("text" in p.row) && !JSON.stringify(p.row).includes("animate"), "the page text is never stored or returned");
ok(!JSON.stringify(p.row).includes("/docs/reference"), "only the site name is kept, not the path");
ok(planFrame({ ...good, image: png }, null, NOW).action === "show", "a PNG works too");

// hidden cases: NO image bytes, NO title, NO host in the row
const hid = (b, why) => { const r = planFrame(b, null, NOW); ok(r.action === "hide" && r.row.shown === false && r.row.storage_path === null && r.row.title === null && r.row.host === null && !r.bytes, why + " -> hidden: " + JSON.stringify(r).slice(0, 120)); return r; };
hid({ ...good, url: "https://example.com/login" }, "login page");
hid({ ...good, has_password_field: true }, "password field");
hid({ ...good, text: "key ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8" }, "secret in page");
hid({ ...good, typed: "password=hunter22secret" }, "secret typed");
hid({ ...good, url: "chrome://settings" }, "browser internal page");
hid({ ...good, text: undefined }, "no page text means cannot check");
hid({ ...good, url: undefined }, "no address means cannot check");
hid({ ...good, text: 5, url: {} }, "wrong types cannot be checked");
hid({ image: jpg }, "image only, nothing to check");
ok(planFrame({ ...good, url: "https://example.com/login" }, null, NOW).row.hidden_kind === "private", "login is labelled private");
ok(planFrame({ ...good, text: undefined }, null, NOW).row.hidden_kind === "unchecked", "no text is labelled unchecked");
// the reason never contains the secret
const sec = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"; const r1 = planFrame({ ...good, text: sec }, null, NOW); ok(!JSON.stringify(r1).includes(sec), "the secret is not echoed in the result");
// a hidden frame never carries the image even though the VM sent one
ok(!JSON.stringify(planFrame({ ...good, url: "https://example.com/login" }, null, NOW)).includes(jpg.slice(0, 60)), "hidden frame drops the image");

// activity that looks like a secret is dropped, markup is stripped
ok(planFrame({ ...good, activity: "typing token=" + sec }, null, NOW).row.activity === null, "a secret-looking activity note is dropped");
ok(planFrame({ ...good, activity: "<b>hi</b>\u0000 there" }, null, NOW).row.activity === "bhi/b  there".replace("  ", " ") || !/[<>\u0000]/.test(planFrame({ ...good, activity: "<b>hi</b>\u0000 there" }, null, NOW).row.activity), "markup is stripped from the activity note");
ok(planFrame({ ...good, activity: "x".repeat(500) }, null, NOW).row.activity.length === 120, "activity is capped");
ok(planFrame({ ...good, activity: 5 }, null, NOW).row.activity === null, "non-text activity becomes nothing");

// bad images
for (const [m, img] of [["not base64", "!!!"], ["empty", ""], ["text", Buffer.from("hello world, not an image").toString("base64")], ["html", Buffer.from("<html><body>hi</body></html>").toString("base64")], ["svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString("base64")], ["gif", Buffer.from("R0lGODlhAQABAAAAACw=", "base64").toString("base64")], ["missing", undefined], ["number", 5]]) {
  const r = planFrame({ ...good, image: img }, null, NOW); ok(r.action === "reject" && r.status === 400, "bad image rejected: " + m + " -> " + r.action);
}
ok(planFrame(null, null, NOW).action === "reject" && planFrame("x", null, NOW).action === "reject" && planFrame(undefined, null, NOW).action === "reject", "non-object body rejected");

// rate limit: frames closer than MIN_GAP_MS are skipped, never stored
const prev = (ms) => ({ seq: 4, updated_at: new Date(NOW - ms).toISOString(), storage_path: "a/b.jpg" });
ok(planFrame(good, prev(MIN_GAP_MS - 50), NOW).action === "skip", "too soon is skipped");
ok(planFrame(good, prev(MIN_GAP_MS + 50), NOW).action === "show", "after the gap it is accepted");
ok(planFrame({ ...good, url: "https://example.com/login" }, prev(10), NOW).action === "hide", "a hide is NEVER rate limited: a private page replaces the stored picture at once");
ok(planFrame({ ...good, text: undefined }, prev(1), NOW).action === "hide", "an unchecked page also hides at once, even 1ms after the last frame");
ok(planFrame(good, { seq: 1, updated_at: "garbage" }, NOW).action === "show" && planFrame(good, { seq: 1, updated_at: new Date(NOW + 99999).toISOString() }, NOW).action === "show", "a broken or future timestamp never blocks frames");
ok(hostOf("https://www.example.com/a/b?q=1") === "example.com" && hostOf("nope") === null && hostOf(5) === null, "hostOf");
console.log(`screenflow: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
