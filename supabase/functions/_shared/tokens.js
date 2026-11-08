// Token rules, pure (no network, no database). Every price and limit lives HERE and nowhere else; the browser never decides a price.
// All days are UTC days.

export const MAX_TOKENS = 100;          // balance ceiling (free plan)
export const SIGNUP_BONUS = 30;         // once, on the first Discord sign-in
export const DAILY_FLOOR = 5;           // each UTC day the balance is topped up to at least this, so nobody sits at 0
export const MESSAGE_FEE = 2;           // every message
export const WORD_BLOCK = 35;           // every full 35 words in a message ...
export const WORD_BLOCK_FEE = 3;        // ... costs this much more (stacks with the message fee)
export const AI_MINUTE_FEE = 3;         // per started minute of AI work
export const AI_MAX_BILLED_MINUTES = 30; // a stuck run is billed for at most this long
export const SCREENSHOT_COST = 2;       // each time a screenshot is shown on the site
export const LIMIT_MESSAGE = "Credits Usage Limit Reached. Come Back Tomorrow.";

// Index = getUTCDay(): Sunday..Saturday.  Mon 20, Tue 15, Wed 20, Thu 10, Fri 30, Sat 15, Sun 15.
export const DAILY_REWARDS = [15, 20, 15, 20, 10, 30, 15];

const validDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
export const utcDay = (d) => (validDate(d) ? d.toISOString().slice(0, 10) : null);
export const rewardForDate = (d) => (validDate(d) ? DAILY_REWARDS[d.getUTCDay()] : 0);

export function countWords(text) {
  const s = text == null ? "" : String(text).trim();
  return s ? s.split(/\s+/).length : 0;
}
export const messageCost = (text) => MESSAGE_FEE + Math.floor(countWords(text) / WORD_BLOCK) * WORD_BLOCK_FEE;

// seconds of AI work -> tokens. Billed per STARTED minute, capped.
export function aiWorkCost(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return Math.min(Math.ceil(s / 60), AI_MAX_BILLED_MINUTES) * AI_MINUTE_FEE;
}

// Add tokens without ever exceeding the ceiling. Returns the new balance and how much was REALLY added.
export function applyCredit(balance, amount) {
  const b = Number.isFinite(Number(balance)) ? Number(balance) : 0;
  const a = Number.isFinite(Number(amount)) && Number(amount) > 0 ? Math.floor(Number(amount)) : 0;
  const next = Math.min(MAX_TOKENS, Math.max(0, b) + a);
  return { balance: next, added: Math.max(0, next - Math.min(b, MAX_TOKENS)) };
}

// How much the daily floor adds today for this balance (0 when already at or above the floor).
export function planDailyFloor(balance) {
  const b = Number(balance);
  if (!Number.isFinite(b)) return DAILY_FLOOR;
  return b >= DAILY_FLOOR ? 0 : DAILY_FLOOR - Math.max(0, b);
}

// A reward can only be claimed for TODAY, once. Yesterday's is gone for good; tomorrow's is not available yet.
export function canClaim({ lastClaimDay, today, claimDay } = {}) {
  const ok = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!ok(today) || !ok(claimDay)) return { ok: false, reason: "bad_day" };
  if (claimDay < today) return { ok: false, reason: "missed" };
  if (claimDay > today) return { ok: false, reason: "not_yet" };
  if (lastClaimDay === today) return { ok: false, reason: "already_claimed" };
  return { ok: true };
}
