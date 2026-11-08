// Discord login logic (pure, no network). The OAuth "state" is the CSRF defence, so it gets the strictest tests.
import test from "node:test"; import assert from "node:assert/strict";
import { signState, verifyState, buildAuthorizeUrl, parseDiscordUser, safeReturnTo, STATE_TTL_MS } from "../functions/_shared/discordauth.js";

const SECRET = "test-secret-".padEnd(40, "x"), OWNER = "a".repeat(64), NOW = 1_800_000_000_000;

test("state: a fresh state verifies and returns the owner it was made for", async () => {
  const s = await signState({ secret: SECRET, owner: OWNER, returnTo: "/", now: NOW });
  const v = await verifyState({ secret: SECRET, state: s, now: NOW + 1000 });
  assert.equal(v.ok, true); assert.equal(v.owner, OWNER);
});
test("state: expires after the TTL", async () => {
  const s = await signState({ secret: SECRET, owner: OWNER, returnTo: "/", now: NOW });
  assert.equal((await verifyState({ secret: SECRET, state: s, now: NOW + STATE_TTL_MS + 1 })).ok, false);
  assert.equal((await verifyState({ secret: SECRET, state: s, now: NOW + STATE_TTL_MS - 1 })).ok, true);
});
test("state: a state signed with another secret is rejected", async () => {
  const s = await signState({ secret: "other".padEnd(40, "y"), owner: OWNER, returnTo: "/", now: NOW });
  assert.equal((await verifyState({ secret: SECRET, state: s, now: NOW })).ok, false);
});
test("state: tampering with the owner or the signature is rejected", async () => {
  const s = await signState({ secret: SECRET, owner: OWNER, returnTo: "/", now: NOW }); const [body, sig] = s.split(".");
  const evil = btoa(JSON.stringify({ o: "b".repeat(64), r: "/", t: NOW, n: "x" })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  assert.equal((await verifyState({ secret: SECRET, state: evil + "." + sig, now: NOW })).ok, false);
  assert.equal((await verifyState({ secret: SECRET, state: body + "." + sig.slice(0, -2) + "AA", now: NOW })).ok, false);
});
test("state: junk never throws and never verifies", async () => {
  for (const bad of ["", "abc", "a.b", "...", null, undefined, 42, "a".repeat(5000), "e30.e30"]) assert.equal((await verifyState({ secret: SECRET, state: bad, now: NOW })).ok, false);
});
test("state: two states for the same owner differ (random nonce) so one cannot be guessed from another", async () => {
  const a = await signState({ secret: SECRET, owner: OWNER, returnTo: "/", now: NOW }), b = await signState({ secret: SECRET, owner: OWNER, returnTo: "/", now: NOW });
  assert.notEqual(a, b);
});
test("state: a missing or short secret refuses to sign (never sign with an empty key)", async () => {
  await assert.rejects(() => signState({ secret: "", owner: OWNER, returnTo: "/", now: NOW })); await assert.rejects(() => signState({ secret: "short", owner: OWNER, returnTo: "/", now: NOW }));
  assert.equal((await verifyState({ secret: "", state: "a.b", now: NOW })).ok, false);
});
test("state: the owner must be a 64-char hex hash", async () => { await assert.rejects(() => signState({ secret: SECRET, owner: "nope", returnTo: "/", now: NOW })); });

test("returnTo: only same-site paths survive (no open redirect)", () => {
  assert.equal(safeReturnTo("/"), "/"); assert.equal(safeReturnTo("/#/diagnostics"), "/#/diagnostics"); assert.equal(safeReturnTo("/chat?x=1"), "/chat?x=1");
  for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "", null, undefined, "evil.com", "/\n/evil", "http://localhost", "/" + "a".repeat(600)]) assert.equal(safeReturnTo(bad), "/", String(bad));
});

test("authorize url: has the right Discord endpoint, scope, and state, and no secret", () => {
  const u = new URL(buildAuthorizeUrl({ clientId: "123", redirectUri: "https://x.supabase.co/functions/v1/auth-discord", state: "S.T" }));
  assert.equal(u.origin + u.pathname, "https://discord.com/oauth2/authorize"); assert.equal(u.searchParams.get("client_id"), "123");
  assert.equal(u.searchParams.get("response_type"), "code"); assert.equal(u.searchParams.get("scope"), "identify"); assert.equal(u.searchParams.get("state"), "S.T");
  assert.equal(u.searchParams.get("redirect_uri"), "https://x.supabase.co/functions/v1/auth-discord"); assert.equal(u.searchParams.get("prompt"), "none");
  assert.ok(!/secret/i.test(u.toString()));
});
test("discord user: keeps only id, name and avatar; rejects bad ids", () => {
  const u = parseDiscordUser({ id: "80351110224678912", username: "nelly", global_name: "Nelly", avatar: "8342729096ea3675442027381ff50dfe", email: "x@y.z", mfa_enabled: true, locale: "en" });
  assert.deepEqual(u, { id: "80351110224678912", name: "Nelly", avatar: "8342729096ea3675442027381ff50dfe" });
  assert.equal(parseDiscordUser({ id: "80351110224678912", username: "bob" }).name, "bob"); assert.equal(parseDiscordUser({ id: "80351110224678912", username: "bob" }).avatar, null);
  for (const bad of [null, {}, { id: "abc", username: "x" }, { id: 5, username: "x" }, { id: "123" }, "str"]) assert.equal(parseDiscordUser(bad), null);
});
test("discord user: names are trimmed, bounded and stripped of control characters", () => {
  assert.equal(parseDiscordUser({ id: "80351110224678912", username: "  a\u0000b\nc  " }).name, "abc");
  assert.equal(parseDiscordUser({ id: "80351110224678912", username: "x".repeat(200) }).name.length, 64);
  assert.equal(parseDiscordUser({ id: "80351110224678912", username: "\u0000\n" }).name, "Discord user");
});
test("discord user: an avatar hash with odd characters is dropped (it ends up in a URL)", () => {
  assert.equal(parseDiscordUser({ id: "80351110224678912", username: "a", avatar: "../../x" }).avatar, null); assert.equal(parseDiscordUser({ id: "80351110224678912", username: "a", avatar: "a_8342729096ea" }).avatar, "a_8342729096ea");
});
