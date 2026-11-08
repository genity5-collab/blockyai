import { admin, handle, json, ownerHash } from "../_shared/lib.ts";
import { tokenDb, accountForOwner } from "../_shared/tokendb.ts";
import { getStatus, claimToday, chargeScreenshot } from "../_shared/tokenflow.js";

// Tokens, for the signed-in browser. Prices live in _shared/tokens.js; this function only asks the rules and the database.
//   POST {action:"status"}                        -> balance, today's reward, the weekly table, prices
//   POST {action:"claim"}                         -> claim TODAY's reward (once per UTC day; a missed day cannot be claimed)
//   POST {action:"view_screenshot", id, view_id}  -> charges 2 and returns a signed image URL (or refuses when out of tokens)
Deno.serve(handle(async (req) => {
  const b = await req.json().catch(() => ({}));
  const db = admin(); const oh = await ownerHash(req);
  const account = await accountForOwner(db, oh);
  if (!account) return json({ error: "sign in with Discord first", signed_out: true }, 401);
  const tdb = tokenDb(db, account); const now = new Date();

  if (b.action === "status") return json(await getStatus({ db: tdb, now }));
  if (b.action === "claim") {
    const r = await claimToday({ db: tdb, now });
    return json(r, r.ok ? 200 : 409);
  }
  if (b.action === "view_screenshot") {
    const id = String(b.id ?? ""), view = String(b.view_id ?? "").slice(0, 64);
    if (!/^[0-9a-f-]{36}$/.test(id) || view.length < 8) return json({ error: "bad request" }, 400);
    // The screenshot must belong to a session that belongs to THIS account (or this browser): never sign someone else's image.
    const { data: shot } = await db.from("screenshots").select("id,storage_path,session_id").eq("id", id).maybeSingle();
    if (!shot) return json({ error: "not found" }, 404);
    const { data: s } = await db.from("sessions").select("id,account_id,owner_key_hash").eq("id", shot.session_id).maybeSingle();
    if (!s || !(s.account_id === account || s.owner_key_hash === oh)) return json({ error: "not found" }, 404);
    const c = await chargeScreenshot({ db: tdb, viewId: `${id}:${view}` });
    if (!c.allowed) return json({ error: c.limitMessage, balance: c.balance, out_of_tokens: true }, 402);
    const { data: sig } = await db.storage.from("screenshots").createSignedUrl(shot.storage_path, 900);
    return json({ url: sig?.signedUrl ?? null, cost: c.cost, balance: c.balance });
  }
  return json({ error: "unknown action" }, 400);
}));
