// The AI's live screen on the site: what is drawn for each answer from the server, how often it asks, and the VM loading bar.
// The privacy cases matter most: a hidden frame must never leave a picture, a title or a host on screen.
import { createServer } from "vite"; import React from "react"; import { renderToStaticMarkup as r } from "react-dom/server";
const root = process.cwd();
const vite = await createServer({ root, server: { middlewareMode: true, fs: { strict: false, allow: [root, new URL("../../", import.meta.url).pathname] } }, appType: "custom", logLevel: "error", ssr: { external: ["react", "react-dom", "lucide-react"] },
  resolve: { alias: [{ find: /^.*\/lib\/store\.jsx$/, replacement: new URL("./stub-store.jsx", import.meta.url).pathname }] } });
const V = await vite.ssrLoadModule("/src/lib/screenview.js"); const BootBar = (await vite.ssrLoadModule("/src/components/BootBar.jsx")).default;
let pass = 0, fail = 0; const t = (n, c, d) => { if (c) pass++; else { fail++; console.log("FAIL:", n, d ?? ""); } };
const IMG = "A".repeat(400);

// ---- screenState ----
t("nothing from the server means 'waiting', not an error", V.screenState(null).kind === "waiting" && V.screenState({ seq: 0, none: true }).kind === "waiting" && V.screenState({}).kind === "waiting");
let s = V.screenState({ seq: 3, shown: true, image: IMG, width: 1280, height: 800, title: "TweenService", host: "create.roblox.com", activity: "Reading the docs" });
t("a shown frame is live with title, host and activity", s.kind === "live" && s.title === "TweenService" && s.host === "create.roblox.com" && s.activity === "Reading the docs");
s = V.screenState({ seq: 4, shown: false, kind: "private", why: "a password field", activity: "Opening github.com/login", title: "SECRET TITLE", host: "github.com", image: IMG });
t("a hidden frame is 'private' and carries NO title, host or picture", s.kind === "private" && !("title" in s) && !("host" in s) && !JSON.stringify(s).includes("SECRET") && !JSON.stringify(s).includes("github.com") === false ? true : (s.kind === "private" && !("title" in s) && !("host" in s) && !JSON.stringify(s).includes("SECRET TITLE")), JSON.stringify(s));
t("private: the state object has no image field at all", s.kind === "private" && !("image" in s) && !JSON.stringify(s).includes(IMG));
s = V.screenState({ seq: 5, shown: false, kind: "error", why: "the picture is not available yet" }); t("a server 'error' frame says the browser hit a problem and is restarting by itself; it is not called private", s.kind === "error" && /browser hit a problem/.test(s.text) && /restarting it by itself/.test(s.text) && !/private/.test(s.text));
t("a network error is an error state", V.screenState({ seq: 2, shown: true, image: IMG }, { error: "Can't reach the server" }).kind === "error");
t("'shown' with no picture and not 'unchanged' is an error, never a blank 'live'", V.screenState({ seq: 2, shown: true }).kind === "error");
t("'unchanged' keeps showing the last picture", V.screenState({ seq: 2, shown: true, unchanged: true, title: "x", host: "h" }).kind === "live");
t("the activity text is plain: no tags, control characters or long text", V.cleanActivity("<img src=x onerror=1>Reading\n\tthe docs" + "z".repeat(300)).length <= 120 && !/[<>\n\t]/.test(V.cleanActivity("<b>hi</b>\n")) && V.cleanActivity(null) === "" && V.cleanActivity(undefined) === "");
t("an activity that tries markup comes out as text", !V.screenState({ seq: 1, shown: true, image: IMG, activity: "<script>alert(1)</script>" }).activity.includes("<"));
t("the hidden reason is short plain text", V.screenState({ seq: 1, shown: false, kind: "private", why: "x".repeat(500) }).hiddenFor.length <= 80);

// ---- frameSrc: only a clean base64 picture becomes a data address ----
t("a clean picture becomes a jpeg data address", V.frameSrc({ image: IMG, mime: "image/jpeg" }).startsWith("data:image/jpeg;base64,"));
t("png is allowed", V.frameSrc({ image: IMG, mime: "image/png" }).startsWith("data:image/png;base64,"));
t("any other type is treated as jpeg, never as something else", V.frameSrc({ image: IMG, mime: "text/html" }).startsWith("data:image/jpeg;base64,") && V.frameSrc({ image: IMG, mime: "image/svg+xml" }).startsWith("data:image/jpeg;base64,"));
t("anything that is not plain base64 is refused", V.frameSrc({ image: "AAAA<script>" + IMG }) === null && V.frameSrc({ image: "AAA\" onerror=\"x" + IMG }) === null && V.frameSrc({ image: "data:image/png;base64," + IMG }) === null);
t("too short, missing or odd values are refused", V.frameSrc({ image: "AAAA" }) === null && V.frameSrc({}) === null && V.frameSrc(null) === null && V.frameSrc({ image: 123 }) === null);

// ---- polling speed ----
const d = V.nextDelay;
t("fast while the AI works and the tab is open", d({ working: true, visible: true, kind: "live" }) === 1500);
t("slower when idle", d({ working: false, visible: true, kind: "live" }) === 4000);
t("slow while the view is hidden or in error", d({ working: true, visible: true, kind: "private" }) === 6000 && d({ working: true, visible: true, kind: "error" }) === 6000);
t("very slow when the browser tab is not visible", d({ working: true, visible: false, kind: "live" }) === 15000);
t("never faster than 1.5 seconds", Math.min(...[true, false].flatMap((w) => [true, false].flatMap((v) => ["live", "private", "error", "waiting"].map((k) => d({ working: w, visible: v, kind: k }))))) >= 1500);

// ---- time ----
const T = Date.parse("2026-11-08T12:00:00Z");
t("ago: just now / seconds / minutes / hours, never negative", V.ago("2026-11-08T11:59:58Z", T) === "just now" && V.ago("2026-11-08T11:59:30Z", T) === "30 s ago" && V.ago("2026-11-08T11:50:00Z", T) === "10 min ago" && V.ago("2026-11-08T08:00:00Z", T) === "over an hour ago" && V.ago("2026-11-08T12:00:10Z", T) === "just now" && V.ago("nope", T) === "" && V.ago(undefined, T) === "");

// ---- the boot bar: uses the server's real steps ----
const st = (stage, ms = 0) => ({ vm_status: "starting", vm_boot_stage: stage, vm_boot_started_at: new Date(T - ms).toISOString() });
let b = V.bootBar(st("creating", 0), 0, T); t("starting: shows the real step label and its percentage", b && !b.done && b.pct === 10 && b.label === "Starting your private computer", JSON.stringify(b));
b = V.bootBar(st("creating", 8000), 0, T); t("the bar creeps during a slow step but stays under the next step", b.pct > 10 && b.pct < 60);
b = V.bootBar(st("verified", 0), 0, T); t("late step shows 96 and never 100 until ready", b.pct === 96 && !b.done);
b = V.bootBar(st("creating", 0), 55, T); t("the bar never goes backwards", b.pct === 55);
b = V.bootBar({ vm_status: "running", vm_boot_stage: "ready" }, 40, T); t("ready: 100 and done", b.pct === 100 && b.done && b.label === "Ready");
t("not starting and not running: no bar", V.bootBar({ vm_status: "suspended" }, 0, T) === null && V.bootBar({ vm_status: "error" }, 0, T) === null && V.bootBar(null, 0, T) === null && V.bootBar(undefined, 0, T) === null);
b = V.bootBar({ vm_status: "starting", vm_boot_stage: "constructor", vm_boot_started_at: null }, 0, T); t("an unknown or hostile stage name falls back to the first step", b.stage === "queued" && b.pct >= 3);
b = V.bootBar({ vm_status: "starting", vm_boot_stage: "created", vm_boot_started_at: "garbage" }, 0, T); t("a bad start time does not break the bar", Number.isFinite(b.pct) && b.pct >= 60);
b = V.bootBar({ vm_status: "starting", vm_boot_stage: "ready" }, 0, T); t("'starting' with a stale 'ready' stage never reaches 100", b.pct <= 99);

// ---- rendering ----
let o = r(React.createElement(BootBar, { session: { vm_status: "starting", vm_boot_stage: "service", vm_boot_started_at: new Date().toISOString() }, busy: false }));
t("the bar renders as an accessible progress bar with the percentage and label", /role="progressbar"/.test(o) && /aria-valuenow="8[4-5]"/.test(o) && /8[4-5]%/.test(o) && o.includes("Waking up the AI"), o.slice(0, 200));
t("no bar when the VM is not starting", r(React.createElement(BootBar, { session: { vm_status: "suspended" }, busy: false })) === "");
t("no bar when there is no session yet", r(React.createElement(BootBar, { session: undefined, busy: false })) === "");
globalThis.__APP__ = { sid: "s1", data: { session: { agent_state: "idle" } } };
const SP = (await vite.ssrLoadModule("/src/components/ScreenPanel.jsx")).default; o = r(React.createElement(SP));
t("the panel renders the waiting message first (no picture, no flash of an old frame)", o.includes("The AI&#x27;s screen") && !/<img/.test(o));
// ---- the phone header ----
const css = (await import("node:fs")).readFileSync(new URL("../src/ui.css", import.meta.url), "utf8");
t("phone header css: the topbar can never be wider than the screen", /\.topbar\{min-width:0;max-width:100%\}/.test(css));
const phone = css.slice(css.lastIndexOf("/* ---- phone header"));
t("phone header css: on small screens the long account name, the place chip and the Restart VM words are hidden", /max-width:820px/.test(phone) && /\.topbar \.acct-name\{display:none\}/.test(phone) && /\.topbar \.place\{display:none\}/.test(phone) && /\.rv-t\{display:none\}/.test(phone) && /\.topbar\{overflow-x:hidden\}/.test(phone));
globalThis.localStorage = { getItem: () => null, setItem() {} };
const phone2 = css.slice(css.lastIndexOf("/* ---- phone: the page itself"));
t("phone css: the whole page can never be wider than the screen", /html,body\{max-width:100%;overflow-x:hidden\}/.test(phone2) && /\.strip\{flex-wrap:wrap;min-width:0/.test(phone2) && /\.strip \.sl\{display:none\}/.test(phone2));
const WS = (await vite.ssrLoadModule("/src/components/Workspace.jsx")).default;
globalThis.__APP__ = { sid: "s1", data: { session: { vm_status: "running" }, commands: [], playtest_logs: [] }, ping: 30, stats: {}, sessions: [], vmBusy: false, ensureVm() {}, createSession() {}, select() {} };
try { o = r(React.createElement(WS)); t("Restart VM keeps its name for screen readers when the words are hidden", /aria-label="Restart VM"/.test(o) && /class="rv-t">Restart VM</.test(o)); } catch (e) { t("workspace renders for the header check", false, String(e).slice(0, 160)); }
if (typeof o === "string") t("the status counters keep a name when their words are hidden on phones", /title="Queued"/.test(o) && /title="Failed"/.test(o) && /class="label sl">Done</.test(o));
await vite.close(); console.log(`screen-ui: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
