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
