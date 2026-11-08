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
  o = h(V, { acct: { name: "Nelly Smith", avatar_url: null }, busy: false }); t("signed in without an avatar: shows initials", o.includes(">NS<") && !o.includes("<img"), o);
  o = h(V, { acct: { name: "x", avatar_url: "https://evil.com/a.png" }, busy: false }); t("a non-Discord avatar url is never rendered", !o.includes("evil.com") && !o.includes("<img"), o);
  o = h(V, { acct: { name: "<img src=x onerror=alert(1)><script>alert(2)</script>", avatar_url: null }, busy: false }); t("a hostile display name is escaped", !o.includes("<script>") && !o.includes("<img src=x"), o);
  o = h(V, { acct: { name: "Nelly", avatar_url: null }, busy: true }); t("signed in + busy: sign-out is disabled", o.includes("disabled"), o);
}


// Join panel (landing): Discord is the main way in, anonymous stays available
{
  const J = JP.default; const noop = () => {};
  let o = h(J, { acct: null, busy: false, onDiscord: noop, onAnonymous: noop });
  t("join (signed out): Discord is the primary button", o.includes("Continue with Discord") && o.indexOf("Continue with Discord") < o.indexOf("without an account"), o);
  t("join (signed out): anonymous is still offered, as a quieter text button", /<button[^>]*class="[^"]*linkbtn[^"]*"[^>]*>[^<]*without an account/.test(o), o);
  t("join (signed out): says what signing in gives you", /across devices|keep your sessions/i.test(o), o);
  t("join: no longer claims 'No account needed' as the only story", !/No account needed\./.test(o), o);
  o = h(J, { acct: null, busy: true, onDiscord: noop, onAnonymous: noop }); t("join (busy): Discord button disabled with a clear label", o.includes("disabled") && o.includes("Opening Discord"), o);
  o = h(J, { acct: undefined, busy: false, onDiscord: noop, onAnonymous: noop }); t("join (loading account): no flash of the wrong state", !o.includes("Continue with Discord") && o.includes("aria-busy"), o);
  o = h(J, { acct: { name: "Nelly" }, busy: false, onDiscord: noop, onAnonymous: noop });
  t("join (signed in): welcomes by name and offers Start new session as the main action", o.includes("Welcome back, Nelly") && o.includes("Start new session") && !o.includes("Continue with Discord"), o);
  o = h(J, { acct: { name: "<img src=x onerror=alert(1)>" }, busy: false, onDiscord: noop, onAnonymous: noop }); t("join: a hostile display name is escaped", !o.includes("<img src=x"), o);
  o = h(J, { acct: { name: "" }, busy: false, onDiscord: noop, onAnonymous: noop }); t("join: an empty name still welcomes gracefully", o.includes("Welcome back") && !o.includes("undefined"), o);
}

// ShotStrip
app({ data: { session: {}, screenshots: [] } }); t("no screenshots renders nothing", h(B.ShotStrip) === "");
app({ data: { session: {}, screenshots: [{ id: 2, url: "https://x/b.png", label: "front" }, { id: 1, url: "https://x/a.png", label: "side" }, { id: 3, url: null }] } });
o = h(B.ShotStrip); t("strip shows 2 views (url-less ones skipped)", o.includes("2 views"), o);
t("strip has thumbs with labels", o.includes("front") && o.includes("side"));
t("before/after button appears with 2+ shots", o.includes("Before / after"));
app({ data: { session: {}, screenshots: [{ id: 1, url: "https://x/a.png" }] } }); t("single shot: no compare button", !h(B.ShotStrip).includes("Before / after"));

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
