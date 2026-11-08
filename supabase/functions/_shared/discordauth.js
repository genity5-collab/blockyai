// Discord login, pure logic (no network, no database). Works in Deno edge functions and in Node tests (Web Crypto only).
//
// The OAuth `state` is the CSRF defence. It is signed (HMAC-SHA256), short-lived, random per login, and BOUND to the browser's owner hash,
// so a login started in one browser cannot be completed into another browser by a link an attacker sends.

export const STATE_TTL_MS = 10 * 60 * 1000;

const enc = new TextEncoder();
const b64u = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"); };
const b64uToStr = (s) => { const p = String(s).replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(p + "=".repeat((4 - (p.length % 4)) % 4)); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); };
const hmac = async (secret, data) => {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
};
// constant-time compare of two strings
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// Only same-site paths. Anything else (absolute URLs, //host, backslashes, javascript:, control characters, very long) becomes "/".
export function safeReturnTo(v) {
  if (typeof v !== "string" || v.length === 0 || v.length > 512) return "/";
  if (v[0] !== "/" || v[1] === "/" || v[1] === "\\") return "/";
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return "/";
  return v;
}

export async function signState({ secret, owner, returnTo, now = Date.now() }) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("state secret must be at least 32 characters");
  if (typeof owner !== "string" || !/^[0-9a-f]{64}$/.test(owner)) throw new Error("owner must be a 64-char hex hash");
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(12)));
  const body = b64u(enc.encode(JSON.stringify({ o: owner, r: safeReturnTo(returnTo), t: now, n: nonce })));
  return body + "." + b64u(await hmac(secret, body));
}

// -> { ok: true, owner, returnTo } | { ok: false, reason }. Never throws.
export async function verifyState({ secret, state, now = Date.now() }) {
  try {
    if (typeof secret !== "string" || secret.length < 32) return { ok: false, reason: "no secret" };
    if (typeof state !== "string" || state.length > 2000) return { ok: false, reason: "malformed" };
    const parts = state.split("."); if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
    if (!same(b64u(await hmac(secret, parts[0])), parts[1])) return { ok: false, reason: "bad signature" };
    const p = JSON.parse(b64uToStr(parts[0]));
    if (typeof p.t !== "number" || now - p.t > STATE_TTL_MS || p.t - now > 60_000) return { ok: false, reason: "expired" };
    if (typeof p.o !== "string" || !/^[0-9a-f]{64}$/.test(p.o)) return { ok: false, reason: "bad owner" };
    return { ok: true, owner: p.o, returnTo: safeReturnTo(p.r) };
  } catch { return { ok: false, reason: "malformed" }; }
}

export function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const u = new URL("https://discord.com/oauth2/authorize");
  u.searchParams.set("client_id", String(clientId)); u.searchParams.set("response_type", "code"); u.searchParams.set("scope", "identify");
  u.searchParams.set("redirect_uri", redirectUri); u.searchParams.set("state", state); u.searchParams.set("prompt", "none");
  return u.toString();
}

// Keep only what we need (id, display name, avatar hash). No email, no locale, no tokens are ever stored.
export function parseDiscordUser(d) {
  if (!d || typeof d !== "object") return null;
  if (typeof d.id !== "string" || !/^\d{15,25}$/.test(d.id)) return null;
  const raw = typeof d.global_name === "string" && d.global_name.trim() ? d.global_name : typeof d.username === "string" ? d.username : "";
  if (!raw) return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64) || "Discord user";
  const avatar = typeof d.avatar === "string" && /^[A-Za-z0-9_]{1,64}$/.test(d.avatar) ? d.avatar : null;
  return { id: d.id, name, avatar };
}
