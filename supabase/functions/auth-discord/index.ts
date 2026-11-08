import { admin, handle, json, ownerHash, sha256, cors } from "../_shared/lib.ts";
import { startLogin, finishLogin, avatarUrl } from "../_shared/discordflow.js";
import { tokenDb } from "../_shared/tokendb.ts";
import { afterSignIn } from "../_shared/tokenflow.js";

// Discord login. One URL, three jobs:
//   POST {action:"start", return_to}   (with x-client-key)  -> { url }  the browser then goes to Discord
//   GET  ?code=&state=                                       Discord redirects here; we link the browser's key to the account and send the browser back to the site
//   POST {action:"me"}                 (with x-client-key)  -> { account: {name, avatar_url} | null }
//   POST {action:"logout"}             (with x-client-key)  -> unlinks THIS browser key from its account (sessions stay on the account)
// The Discord client secret and the signing key never leave the server. Only id, name and avatar are stored.
const SITE = Deno.env.get("SITE_URL") ?? "https://blockyai.onrender.com";
const cfg = () => ({
  clientId: Deno.env.get("DISCORD_CLIENT_ID") ?? "", clientSecret: Deno.env.get("DISCORD_CLIENT_SECRET") ?? "", stateSecret: Deno.env.get("DISCORD_STATE_SECRET") ?? "",
  redirectUri: `${Deno.env.get("SUPABASE_URL")}/functions/v1/auth-discord`,
});

Deno.serve(handle(async (req) => {
  const url = new URL(req.url);
  // ---- Discord's redirect back to us (a browser navigation, so GET) ----
  if (req.method === "GET") {
    const params = Object.fromEntries(url.searchParams.entries());
    const db = admin();
    const { redirect } = await finishLogin({
      cfg: cfg(), params, fetchFn: fetch, now: Date.now(), siteUrl: SITE,
      link: async ({ discordId, name, avatar, owner }: any) => {
        const { data: accountId, error } = await db.rpc("link_discord_login", { p_discord_id: discordId, p_name: name, p_avatar: avatar, p_owner: owner });
        if (error) throw new Error(error.message);
        // 30 tokens the first time this Discord account ever signs in (the database makes it once-only), plus today's 5-token floor.
        // A token problem must never stop someone from signing in, so it is not allowed to throw.
        try { await afterSignIn({ db: tokenDb(db, accountId as string), now: new Date() }); } catch (_e) { /* signed in anyway; the bonus is retried by the next status call */ }
      },
    });
    return new Response(null, { status: 302, headers: { Location: redirect, "Cache-Control": "no-store", ...cors } });
  }
  // ---- calls from the site ----
  const b = await req.json().catch(() => ({}));
  const owner = await ownerHash(req);
  if (b.action === "start") {
    const r = await startLogin({ cfg: cfg(), owner, returnTo: b.return_to, now: Date.now() });
    return r.error ? json({ error: r.error }, 503) : json({ url: r.url });
  }
  if (b.action === "me") {
    const db = admin();
    const { data: k } = await db.from("account_keys").select("account_id").eq("owner_key_hash", owner).maybeSingle();
    if (!k) return json({ account: null });
    const { data: a } = await db.from("accounts").select("id,discord_id,name,avatar,chat_only").eq("id", k.account_id).maybeSingle();
    return json({ account: a ? { id: a.id, name: a.name, avatar_url: avatarUrl(a.discord_id, a.avatar), chat_only: a.chat_only === true } : null });
  }
  if (b.action === "logout") {
    const db = admin();
    await db.from("account_keys").delete().eq("owner_key_hash", owner);
    return json({ ok: true });
  }
  return json({ error: "unknown action" }, 400);
}));
