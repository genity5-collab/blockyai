import { admin, sha256 } from "./lib.ts";

// The real database behind tokenflow.js. One TokenDb per Discord account. Every call is a single SQL function, so it is atomic.
export function tokenDb(db: ReturnType<typeof admin>, accountId: string) {
  const one = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return Array.isArray(data) ? data[0] : data;
  };
  return {
    balance: async () => {
      const { data } = await db.from("token_accounts").select("balance").eq("account_id", accountId).maybeSingle();
      return data?.balance ?? 0;
    },
    lastClaimDay: async () => {
      const { data } = await db.from("token_accounts").select("last_claim_day").eq("account_id", accountId).maybeSingle();
      return data?.last_claim_day ?? null;
    },
    signupBonus: (amt: number) => one("token_signup_bonus", { p_account: accountId, p_amount: amt }).then((r) => ({ added: r.added, balance: r.balance, granted: r.granted })),
    claimDaily: (day: string, amt: number) => one("token_claim_daily", { p_account: accountId, p_day: day, p_amount: amt }).then((r) => ({ added: r.added, balance: r.balance, claimed: r.claimed })),
    dailyFloor: (day: string, floor: number) => one("token_daily_floor", { p_account: accountId, p_day: day, p_floor: floor }).then((r) => ({ added: r.added, balance: r.balance })),
    spend: (amt: number, reason: string, ref: string | null) => one("token_spend", { p_account: accountId, p_amount: amt, p_reason: reason, p_ref: ref }).then((r) => ({ spent: r.spent, balance: r.balance, covered: r.covered, duplicate: r.duplicate })),
  };
}

// Which Discord account is this browser signed in as? null = not signed in (forced sign-in means the site will not let them get here).
export async function accountForOwner(db: ReturnType<typeof admin>, ownerHash: string): Promise<string | null> {
  const { data } = await db.from("account_keys").select("account_id").eq("owner_key_hash", ownerHash).maybeSingle();
  return data?.account_id ?? null;
}
// Which account owns this SESSION? (used by the agent-facing function, which has no browser key.) Sessions are attached to an account at sign-in.
export async function accountForSession(db: ReturnType<typeof admin>, session: { id: string; account_id?: string | null; owner_key_hash?: string | null }): Promise<string | null> {
  if (session.account_id) return session.account_id;
  if (session.owner_key_hash) return await accountForOwner(db, session.owner_key_hash);
  return null;
}
