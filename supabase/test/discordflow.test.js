import test from "node:test"; import assert from "node:assert/strict";
import { startLogin, finishLogin, avatarUrl } from "../functions/_shared/discordflow.js";
import { signState } from "../functions/_shared/discordauth.js";

const cfg = { clientId: "111", clientSecret: "SECRET-VALUE-NOT-LOGGED", stateSecret: "s".repeat(40), redirectUri: "https://p.supabase.co/functions/v1/auth-discord" };
const OWNER = "c".repeat(64), SITE = "https://blockyai.onrender.com", NOW = 1_800_000_000_000;
const goodState = (o = OWNER, r = "/") => signState({ secret: cfg.stateSecret, owner: o, returnTo: r, now: NOW });
const fakeDiscord = ({ tokenOk = true, userOk = true, user = { id: "80351110224678912", username: "nelly", global_name: "Nelly", avatar: "abc123", email: "e@x.y" } } = {}) => {
  const calls = []; const fetchFn = async (url, init) => { calls.push({ url, init });
    if (url.endsWith("/oauth2/token")) return { ok: tokenOk, json: async () => ({ access_token: "TOKEN", refresh_token: "R" }) };
    if (url.endsWith("/users/@me")) return { ok: userOk, json: async () => user }; throw new Error("unexpected " + url); };
  return { fetchFn, calls }; };
const run = async (params, d = fakeDiscord()) => { const linked = []; const r = await finishLogin({ cfg, params, fetchFn: d.fetchFn, link: async (x) => linked.push(x), now: NOW + 5000, siteUrl: SITE }); return { r, linked, calls: d.calls }; };

test("start: returns a Discord URL whose state is bound to the owner", async () => {
  const { url } = await startLogin({ cfg, owner: OWNER, returnTo: "/#/diagnostics", now: NOW }); const u = new URL(url);
  assert.equal(u.hostname, "discord.com"); assert.equal(u.searchParams.get("client_id"), "111"); assert.ok(u.searchParams.get("state").includes("."));
  assert.ok(!url.includes(cfg.clientSecret)); assert.ok(!url.includes(cfg.stateSecret));
});
test("start: not configured -> a clear error, never a broken URL", async () => {
  assert.match((await startLogin({ cfg: { ...cfg, clientId: "" }, owner: OWNER, returnTo: "/", now: NOW })).error, /not configured/);
  assert.match((await startLogin({ cfg: { ...cfg, stateSecret: "" }, owner: OWNER, returnTo: "/", now: NOW })).error, /not configured/);
});
test("finish: the happy path links the OWNER from the state, with id/name/avatar only", async () => {
  const { r, linked } = await run({ code: "abcd1234", state: await goodState(OWNER, "/") });
  assert.equal(r.redirect, SITE + "/?login=ok");
  assert.deepEqual(linked, [{ discordId: "80351110224678912", name: "Nelly", avatar: "abc123", owner: OWNER }]);
  assert.ok(!JSON.stringify(linked).includes("e@x.y"), "email is never passed on");
});
test("finish: the return path keeps its #route, and login= goes BEFORE the hash", async () => {
  const { r } = await run({ code: "abcd1234", state: await goodState(OWNER, "/#/diagnostics") });
  assert.equal(r.redirect, SITE + "/?login=ok#/diagnostics");
  const { r: r2 } = await run({ code: "abcd1234", state: await goodState(OWNER, "/chat?x=1#/a") }); assert.equal(r2.redirect, SITE + "/chat?x=1&login=ok#/a");
});
test("finish: the token request uses the secret server-side and is never echoed in the redirect", async () => {
  const d = fakeDiscord(); const { r, calls } = await run({ code: "abcd1234", state: await goodState() }, d);
  const t = calls.find((c) => c.url.endsWith("/oauth2/token")); assert.match(String(t.init.body), /client_secret=SECRET-VALUE-NOT-LOGGED/); assert.match(String(t.init.body), /code=abcd1234/);
  assert.ok(!r.redirect.includes("SECRET") && !r.redirect.includes("TOKEN")); assert.equal(calls.find((c) => c.url.endsWith("/users/@me")).init.headers.Authorization, "Bearer TOKEN");
});
test("finish: the owner comes ONLY from the signed state, never from the request", async () => {
  const { linked } = await run({ code: "abcd1234", state: await goodState("d".repeat(64)), owner: "e".repeat(64) }); assert.equal(linked[0].owner, "d".repeat(64));
});
test("finish: a forged, expired or missing state links nothing and never calls Discord", async () => {
  for (const state of ["forged.value", undefined, "", await signState({ secret: "x".repeat(40), owner: OWNER, returnTo: "/", now: NOW })]) {
    const d = fakeDiscord(); const { r, linked } = await run({ code: "abcd1234", state }, d); assert.equal(r.redirect, SITE + "/?login=expired"); assert.equal(linked.length, 0); assert.equal(d.calls.length, 0);
  }
  const old = await signState({ secret: cfg.stateSecret, owner: OWNER, returnTo: "/", now: NOW - 11 * 60 * 1000 }); const d = fakeDiscord();
  assert.equal((await run({ code: "abcd1234", state: old }, d)).r.redirect, SITE + "/?login=expired"); assert.equal(d.calls.length, 0);
});
test("finish: the user pressing Cancel on Discord is 'cancelled', other Discord errors are 'failed'", async () => {
  assert.equal((await run({ error: "access_denied", state: "x" })).r.redirect, SITE + "/?login=cancelled"); assert.equal((await run({ error: "server_error" })).r.redirect, SITE + "/?login=failed");
});
test("finish: Discord failing at any step fails safely and links nothing", async () => {
  for (const d of [fakeDiscord({ tokenOk: false }), fakeDiscord({ userOk: false }), fakeDiscord({ user: { id: "bad" } }), fakeDiscord({ user: null })]) {
    const { r, linked } = await run({ code: "abcd1234", state: await goodState() }, d); assert.equal(r.redirect, SITE + "/?login=failed"); assert.equal(linked.length, 0);
  }
  const boom = { fetchFn: async () => { throw new Error("network"); }, calls: [] }; const { r, linked } = await run({ code: "abcd1234", state: await goodState() }, boom); assert.equal(r.redirect, SITE + "/?login=failed"); assert.equal(linked.length, 0);
});
test("finish: a database failure while linking fails safely", async () => {
  const r = await finishLogin({ cfg, params: { code: "abcd1234", state: await goodState() }, fetchFn: fakeDiscord().fetchFn, link: async () => { throw new Error("db down"); }, now: NOW + 1000, siteUrl: SITE }); assert.equal(r.redirect, SITE + "/?login=failed");
});
test("finish: a missing or absurd code is refused before calling Discord", async () => {
  for (const code of [undefined, "", "a", "x".repeat(600), 5]) { const d = fakeDiscord(); const { r } = await run({ code, state: await goodState() }, d); assert.equal(r.redirect, SITE + "/?login=failed"); assert.equal(d.calls.length, 0); }
});
test("finish: an open-redirect attempt in the state's returnTo is neutralised", async () => {
  const { r } = await run({ code: "abcd1234", state: await goodState(OWNER, "https://evil.com") }); assert.equal(r.redirect, SITE + "/?login=ok");
});
test("avatarUrl: builds the Discord CDN URL, or null", () => { assert.equal(avatarUrl("1234567890123456", "abc"), "https://cdn.discordapp.com/avatars/1234567890123456/abc.png?size=64"); assert.equal(avatarUrl("1", null), null); });
