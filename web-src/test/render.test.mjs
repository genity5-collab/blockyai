// Renders the real site components with fake data and asserts on the HTML. Run: node test/render.test.mjs (from web-src)
import { createServer } from "vite";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup as r } from "react-dom/server";
const root = process.cwd();
const vite = await createServer({ root, server: { middlewareMode: true }, appType: "custom", logLevel: "error", ssr: { external: ["react", "react-dom", "lucide-react"] },
  resolve: { alias: [{ find: /^.*\/lib\/store\.jsx$/, replacement: new URL("./stub-store.jsx", import.meta.url).pathname }] }, server: { middlewareMode: true, fs: { strict: false, allow: [root] } } });
const B = await vite.ssrLoadModule("/src/components/Build.jsx");
const C = await vite.ssrLoadModule("/src/components/Cards.jsx");
const K = await vite.ssrLoadModule("/src/components/Capability.jsx");
const CH = await vite.ssrLoadModule("/src/components/Chat.jsx");
const AC = await vite.ssrLoadModule("/src/components/Account.jsx");
const JP = await vite.ssrLoadModule("/src/components/JoinPanel.jsx");
const DI = await vite.ssrLoadModule("/src/components/DiscordIcon.jsx");
const TC = await vite.ssrLoadModule("/src/components/TokenChip.jsx");
const RW = await vite.ssrLoadModule("/src/components/RewardsPanel.jsx");
const LS = await vite.ssrLoadModule("/src/components/LockedShot.jsx");
let pass = 0, fail = 0; const t = (n, c, d) => { if (c) pass++; else { fail++; console.log("FAIL:", n, d ?? ""); } };
const app = (o = {}) => (globalThis.__APP__ = { sid: "s1", toast() {}, send() {}, patchSession() {}, agentBusy: false, data: { session: { agent_state: "working", mode: "chat" } }, ...o });
const h = (C_, props = {}) => r(React.createElement(C_, props));

// PlanCard
app({ data: { session: { agent_state: "working" }, plan: { title: "Yacht", status: "active", items: [{ id: 1, text: "Hull", done: true, verified: false }, { id: 2, text: "Deck", done: false }, { id: 3, text: "Verify", done: false }] } } });
let o = h(B.PlanCard);
t("plan shows title and 1/3", o.includes("Yacht") && o.includes("1/3"), o);
t("plan lists every item", ["Hull", "Deck", "Verify"].every((x) => o.includes(x)));
t("plan progress width 33%", o.includes("width:33%"));
t("active plan has a spinner on the first open item", o.includes("spin"));
app({ data: { session: { agent_state: "idle" }, plan: { title: "Done", status: "complete", items: [{ id: 1, text: "a", done: true, verified: true }, { id: 2, text: "b", done: true }] } } });
o = h(B.PlanCard); t("complete plan: 100%, verified badge, no spinner", o.includes("width:100%") && o.includes("verified") && !o.includes("spin"));
app({ data: { session: {}, plan: null } }); t("no plan renders nothing", h(B.PlanCard) === "");
app({ data: { session: {}, plan: { items: [] } } }); t("empty plan renders nothing", h(B.PlanCard) === "");
app({ data: { session: {}, plan: { title: "<img src=x onerror=alert(1)>", items: [{ id: 1, text: "<script>alert(1)</script>", done: false }] } } });
o = h(B.PlanCard); t("plan text is escaped (no injected tags)", !o.includes("<script>") && !o.includes("<img src=x"), o);


// OutcomeBadge (Phase 1 item 8): a message that ended INCOMPLETE / stopped / error is labelled, a complete one is not, and it can never be mistaken for success.
const O = C.OutcomeBadge;
t("OutcomeBadge exists", typeof O === "function");
if (typeof O === "function") {
  const inc = h(O, { outcome: "incomplete" }); t("incomplete shows the word INCOMPLETE and the incomplete class", /INCOMPLETE/.test(inc) && inc.includes("outcome-incomplete"), inc);
  t("incomplete badge is not styled as success", !inc.includes("outcome-complete") && !/\bDone\b|Success/i.test(inc));
  t("stopped is labelled Stopped", /Stopped/.test(h(O, { outcome: "stopped" })));
  t("error is labelled Error", /Error/.test(h(O, { outcome: "error" })));
  t("complete shows no warning badge", h(O, { outcome: "complete" }) === "");
  t("missing/unknown outcome renders nothing (old messages)", h(O, {}) === "" && h(O, { outcome: "bogus" }) === "" && h(O, { outcome: null }) === "");
  t("outcome text is never taken from the message (no injection)", !h(O, { outcome: "<img src=x onerror=1>" }).includes("<img"));
}


// Chat (Phase 1 item 8): the REAL Chat component renders the end state of each message. This test exists because the badge was once used without being imported.
{
  const msg = (id, outcome, content) => ({ id, role: "assistant", content, outcome, embeds: null, created_at: "2026-11-07T10:00:0" + id + "Z" });
  app({ data: { session: { agent_state: "idle", mode: "chat" }, commands: [], attachments: [], messages: [msg(1, "incomplete", "I ran out of steps"), msg(2, "stopped", "Stopped."), msg(3, "complete", "Built it."), msg(4, null, "old message")] } });
  let html = ""; let err = null; try { html = h(CH.default); } catch (e) { err = e; }
  t("Chat renders without throwing (OutcomeBadge is imported)", !err, String(err));
  t("Chat shows exactly one INCOMPLETE badge", (html.match(/INCOMPLETE/g) || []).length === 1, html.slice(0, 200));
  t("Chat shows the Stopped badge once", (html.match(/outcome-stopped/g) || []).length === 1);
  t("Chat does not badge complete or old messages", (html.match(/class="outcome /g) || []).length === 2);
}


// Account button (Discord login)
{
  const V = AC.AccountView;
  let o = h(V, { acct: null, busy: false });
  t("signed out: shows a Sign in button", o.includes("Sign in") && o.includes("<button") && !o.includes("disabled"), o);
  o = h(V, { acct: null, busy: true }); t("signed out + busy: button disabled and says Opening Discord", o.includes("disabled") && o.includes("Opening Discord"), o);
  o = h(V, { acct: undefined, busy: false }); t("loading: a quiet placeholder, no sign-in button", o.includes("aria-busy") && !o.includes("Sign in"), o);
  o = h(V, { acct: { name: "Nelly", avatar_url: "https://cdn.discordapp.com/avatars/123/abc.png?size=64" }, busy: false });
  t("signed in: shows the name, the avatar and a sign-out button", o.includes("Nelly") && o.includes("cdn.discordapp.com/avatars/123/abc.png") && o.includes("Sign out"), o);
  o = h(V, { acct: { name: "Nelly", avatar_url: null }, busy: false });
  t("signed in: the name is NEVER hidden on small screens (it is not inside hide-sm)", !/hide-sm[^>]*>[^<]*Nelly/.test(o) && o.includes("Nelly"), o);
  o = h(V, { acct: { name: "Nelly Smith", avatar_url: null }, busy: false }); t("signed in without an avatar: shows initials", o.includes(">NS<") && !o.includes("<img"), o);
  o = h(V, { acct: { name: "x", avatar_url: "https://evil.com/a.png" }, busy: false }); t("a non-Discord avatar url is never rendered", !o.includes("evil.com") && !o.includes("<img"), o);
  o = h(V, { acct: { name: "<img src=x onerror=alert(1)><script>alert(2)</script>", avatar_url: null }, busy: false }); t("a hostile display name is escaped", !o.includes("<script>") && !o.includes("<img src=x"), o);
  o = h(V, { acct: { name: "Nelly", avatar_url: null }, busy: true }); t("signed in + busy: sign-out is disabled", o.includes("disabled"), o);
}


// Join panel: sign-in is FORCED, so signed out shows only the Discord button (no skip)
{
  const J = JP.default; const noop = () => {};
  let o = h(J, { acct: null, busy: false, onDiscord: noop, onStart: noop });
  t("join (signed out): Continue with Discord is the way in", o.includes("Continue with Discord"), o);
  t("join (signed out): there is NO skip / anonymous option", !/without an account|linkbtn|Start new session/i.test(o), o);
  t("join (signed out): says what signing in gives you", /across devices/i.test(o) && /never your email/i.test(o), o);
  t("join (signed out): the old 'No account needed' claim is gone", !/No account needed/i.test(o), o);
  o = h(J, { acct: null, busy: true, onDiscord: noop, onStart: noop }); t("join (busy): Discord button disabled with a clear label", o.includes("disabled") && o.includes("Opening Discord"), o);
  o = h(J, { acct: undefined, busy: false, onDiscord: noop, onStart: noop }); t("join (loading account): no flash of the wrong state", !o.includes("Continue with Discord") && o.includes("aria-busy"), o);
  o = h(J, { acct: { name: "Nelly" }, busy: false, onDiscord: noop, onStart: noop });
  t("join (signed in): welcomes by name and offers Start new session", o.includes("Welcome back, Nelly") && o.includes("Start new session") && !o.includes("Continue with Discord"), o);
  o = h(J, { acct: { name: "<img src=x onerror=alert(1)>" }, busy: false, onDiscord: noop, onStart: noop }); t("join: a hostile display name is escaped", !o.includes("<img src=x"), o);
  o = h(J, { acct: { name: "" }, busy: false, onDiscord: noop, onStart: noop }); t("join: an empty name still welcomes gracefully", o.includes("Welcome back") && !o.includes("undefined"), o);
}


// Discord icon + icons around the auth UI
{
  const D = DI.default;
  let o = h(D, { size: 20 });
  t("discord icon is an inline svg (no network, CSP-safe)", o.startsWith("<svg") && o.includes("<path") && !/https?:\/\/(?!www\.w3\.org)/.test(o) && !o.includes("<image") && !o.includes("<use"), o);
  t("discord icon uses the page text colour (currentColor), so it matches the button", o.includes('fill="currentColor"'), o);
  t("discord icon has the requested size", o.includes('width="20"') && o.includes('height="20"'), o);
  t("discord icon is decorative by default (hidden from screen readers)", o.includes('aria-hidden="true"') && !o.includes("<title"), o);
  o = h(D, { size: 16, title: "Discord" }); t("discord icon with a title is exposed to screen readers", o.includes("<title>Discord</title>") && o.includes('role="img"') && !o.includes('aria-hidden'), o);
  o = h(D, {}); t("discord icon has a sane default size", /width="\d+"/.test(o), o);
  const J = JP.default, noop = () => {};
  o = h(J, { acct: null, busy: false, onDiscord: noop, onStart: noop });
  t("Continue with Discord button shows the Discord logo (not the generic arrow)", /<button[^>]*>\s*<svg[^>]*>[\s\S]*?<\/svg>Continue with Discord/.test(o) && o.includes("M20.317 4.3698"), o);
  t("trust line has a shield icon", /lucide-shield-check/.test(o), o);
  o = h(J, { acct: { name: "Nelly" }, busy: false, onDiscord: noop, onStart: noop }); t("signed-in welcome has an icon too", /lucide-sparkles/.test(o), o);
  o = h(AC.AccountView, { acct: null, busy: false }); t("corner Sign in button shows the Discord logo", o.includes("M20.317 4.3698") && o.includes("Sign in"), o);
}


// Tokens UI
{
  const week = [["Mon", 20], ["Tue", 15], ["Wed", 20], ["Thu", 10], ["Fri", 30], ["Sat", 15], ["Sun", 15]].map(([name, reward], i) => ({ name, reward, today: i === 6 }));
  const st = (o = {}) => ({ balance: 40, max: 100, today: { day: "2026-11-08", reward: 15, canClaim: true }, week, costs: { message: 2, per35Words: 3, aiMinute: 3, screenshot: 2 }, ...o });
  let o = h(TC.default, { status: null, onOpen() {} }); t("chip: renders nothing when there is no status (signed out)", o === "", o);
  o = h(TC.default, { status: st(), onOpen() {} }); t("chip: shows the balance and a gift when today's reward is waiting", o.includes(">40<") && o.includes("lucide-gift") && /daily reward available/.test(o), o);
  o = h(TC.default, { status: st({ today: { canClaim: false } }), onOpen() {} }); t("chip: no gift once claimed", !o.includes("lucide-gift") && !/daily reward available/.test(o), o);
  o = h(TC.default, { status: st({ balance: 0 }), onOpen() {} }); t("chip: 0 tokens is red", o.includes("red") && o.includes(">0<"), o);
  o = h(TC.default, { status: st({ balance: 3 }), onOpen() {} }); t("chip: low (under 5) is amber", o.includes("amber"), o);
  o = h(RW.default, { status: st(), claiming: false, onClaim() {}, onClose() {} });
  t("rewards: shows balance / 100", o.includes(">40<") && o.includes("/ 100"), o);
  t("rewards: lists Mon..Sun with the exact amounts", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].every((d) => o.includes(d)) && ["20", "15", "10", "30"].every((n) => o.includes(">" + n + "<")), o);
  t("rewards: past days are marked missed, today is available", (o.match(/missed/g) || []).length === 6 && /Sun: 15 tokens, available today/.test(o), o);
  t("rewards: a Claim button with today's amount", o.includes("Claim +15 tokens"), o);
  t("rewards: states the real prices", /2 per message/.test(o) && /\+3 per 35 words/.test(o) && /3 per minute of AI work/.test(o) && /2 per screenshot/.test(o) && /topped up to 5/.test(o), o);
  o = h(RW.default, { status: st({ today: { canClaim: false, reward: 15 } }), claiming: false, onClaim() {}, onClose() {} }); t("rewards: after claiming there is no claim button and it says missed days can't be claimed", !o.includes("Claim +") && /can(&#x27;|')t be claimed later/.test(o) && /Sun: 15 tokens, claimed/.test(o), o);
  o = h(RW.default, { status: st(), claiming: true, onClaim() {}, onClose() {} }); t("rewards: claiming disables the button", o.includes("Claiming") && o.includes("disabled"), o);
  o = h(RW.default, { status: null }); t("rewards: renders nothing without status", o === "", o);
  const T = LS.ShotTile;
  o = h(T, { state: "locked", url: null, label: "Front view", onReveal() {} }); t("locked shot: shows a lock, the price, and is a button", o.includes("lucide-lock") && o.includes("2 tokens") && o.includes("Show screenshot") && !o.includes("<img"), o);
  o = h(T, { state: "shown", url: "https://x.supabase.co/a.png", label: "Front view" }); t("shown shot: renders the image", o.includes("<img") && o.includes("a.png") && o.includes('alt="Front view"'), o);
  o = h(T, { state: "out", msg: "Credits Usage Limit Reached. Come Back Tomorrow.", onReveal() {} }); t("out of tokens: shows the limit message and the button is disabled", o.includes("Credits Usage Limit Reached. Come Back Tomorrow.") && o.includes("disabled") && o.includes("Out of tokens"), o);
  o = h(T, { state: "loading", onReveal() {} }); t("loading: disabled", o.includes("Loading") && o.includes("disabled"), o);
  o = h(T, { state: "broke", msg: "Could not load", onReveal() {} }); t("error: offers Try again", o.includes("Try again") && !o.includes("disabled"), o);
  o = h(T, { state: "locked", label: "<img src=x onerror=alert(1)>", onReveal() {} }); t("locked shot: a hostile label is escaped", !o.includes("<img src=x"), o);
  o = h(T, { state: "locked", cost: 4, label: "Before and after", onReveal() {} }); t("before/after tile shows the 4 token price", o.includes("4 tokens"), o);
}

// ShotStrip
app({ data: { session: {}, screenshots: [] } }); t("no screenshots renders nothing", h(B.ShotStrip) === "");
app({ data: { session: {}, screenshots: [{ id: "b", locked: true, label: "front" }, { id: "a", locked: true, label: "side" }, { id: "c", locked: true }] } });
o = h(B.ShotStrip); t("strip counts every screenshot (3 views); they are all locked", o.includes("3 views") && o.includes("Show screenshot"), o);
t("strip never renders an image before one is opened (nothing is shown for free)", !o.includes("<img"), o);
t("strip has selectable thumbs with labels", o.includes("front") && o.includes("side"));
t("before/after button appears with 2+ shots", o.includes("Before / after"));
t("the locked tile states the 2 token price", o.includes("2 tokens"), o);
app({ data: { session: {}, screenshots: [{ id: "a", locked: true }] } }); t("single shot: no compare button", !h(B.ShotStrip).includes("Before / after"));

// ModeSwitch
app({ data: { session: { mode: "chat" } } }); o = h(B.ModeSwitch);
t("chat mode: both tabs, no genre cards", o.includes("Game Builder") && !o.includes("Obby"));
app({ data: { session: { mode: "game", genre: "obby" } } }); o = h(B.ModeSwitch);
t("game mode: all 7 genre cards", B.GENRES.length === 7 && B.GENRES.every((g) => o.includes(g[1])), o);
t("selected genre marked", o.includes("gcard on"));
app({ agentBusy: true, data: { session: { mode: "game" } } }); t("genre cards disabled while busy", (h(B.ModeSwitch).match(/disabled/g) || []).length >= 7);

// Family badge + command cards
t("VM badge", h(B.FamilyBadge, { family: "vm" }).includes(">VM<"));
t("STUDIO badge", h(B.FamilyBadge, { family: "roblox" }).includes("STUDIO"));
t("no badge for local/none", h(B.FamilyBadge, {}) === "" && h(B.FamilyBadge, { family: "local" }) === "");
app();
o = h(C.CommandCard, { cmd: { name: "vm_exec", args: { cmd: "ls" }, status: "done" } }); t("vm_exec card shows VM badge + label", o.includes(">VM<") && o.includes("Run in VM"), o);
o = h(C.CommandCard, { cmd: { name: "roblox_get_tree", args: {}, status: "done" } }); t("roblox tool card shows STUDIO badge", o.includes("STUDIO"));
o = h(C.CommandCard, { cmd: { type: "build_model", payload: { spec: { name: "Yacht" } }, status: "running" } }); t("build_model card has its own label and STUDIO badge", o.includes("Build model") && o.includes("STUDIO"), o);
o = h(C.CommandCard, { cmd: { name: "plan_create", args: {}, status: "done" } }); t("plan tools get a label, no env badge", o.includes("Make plan") && !o.includes(">VM<"));
// Capability page: with no paired Studio the Run buttons are disabled and the reason is stated
app({ sid: "s1", data: { session: { plugin_connected_at: null } } });
o = h(K.default);
t("capability page: unpaired Studio is stated", o.includes("Studio not paired"), o.slice(0, 200));
app({ sid: null, data: null }); t("capability page: no session message", h(K.default).includes("Open a session first"));
console.log(`site render: ${pass} passed, ${fail} failed`);
await vite.close(); process.exit(fail ? 1 : 0);
