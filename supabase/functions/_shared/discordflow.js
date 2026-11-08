// The Discord login flow with every outside call INJECTED (fetch, database), so it can be tested end to end with a fake Discord.
import { signState, verifyState, buildAuthorizeUrl, parseDiscordUser, safeReturnTo } from "./discordauth.js";

// startLogin -> { url } | { error }
export async function startLogin({ cfg, owner, returnTo, now }) {
  if (!cfg.clientId || !cfg.stateSecret) return { error: "Discord login is not configured on the server yet" };
  const state = await signState({ secret: cfg.stateSecret, owner, returnTo: safeReturnTo(returnTo), now });
  return { url: buildAuthorizeUrl({ clientId: cfg.clientId, redirectUri: cfg.redirectUri, state }) };
}

// finishLogin: Discord redirected back with ?code & ?state (or ?error). Always returns where to send the browser; never throws.
// -> { redirect }  (success or failure, with a short reason in the query so the site can show a message)
export async function finishLogin({ cfg, params, fetchFn, link, now, siteUrl }) {
  // The site uses hash routes (/#/diagnostics), so `login=...` goes in a real query string BEFORE the hash: https://site/?login=ok#/diagnostics
  const back = (path, reason) => {
    const p = safeReturnTo(path); const h = p.indexOf("#"); const pathPart = h === -1 ? p : p.slice(0, h), hash = h === -1 ? "" : p.slice(h);
    const q = pathPart.includes("?") ? "&" : "?";
    return { redirect: siteUrl + pathPart + q + "login=" + encodeURIComponent(reason) + hash };
  };
  try {
    if (params.error) return back("/", params.error === "access_denied" ? "cancelled" : "failed");
    const v = await verifyState({ secret: cfg.stateSecret, state: params.state, now });
    if (!v.ok) return back("/", "expired");
    if (typeof params.code !== "string" || params.code.length < 4 || params.code.length > 512) return back(v.returnTo, "failed");
    // 1. code -> access token (used once, never stored)
    const tr = await fetchFn("https://discord.com/api/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "authorization_code", code: params.code, redirect_uri: cfg.redirectUri }).toString() });
    if (!tr.ok) return back(v.returnTo, "failed");
    const tok = await tr.json();
    if (typeof tok?.access_token !== "string") return back(v.returnTo, "failed");
    // 2. who is it
    const ur = await fetchFn("https://discord.com/api/users/@me", { headers: { Authorization: "Bearer " + tok.access_token } });
    if (!ur.ok) return back(v.returnTo, "failed");
    const user = parseDiscordUser(await ur.json());
    if (!user) return back(v.returnTo, "failed");
    // 3. link this browser's key to the account
    await link({ discordId: user.id, name: user.name, avatar: user.avatar, owner: v.owner });
    return back(v.returnTo, "ok");
  } catch { return back("/", "failed"); }
}

export const avatarUrl = (discordId, avatar) => (avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png?size=64` : null);
