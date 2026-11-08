// Token flow: joins the pure rules (tokens.js) to the database functions. The database is INJECTED (`db`) so this is testable with a fake.
// `db` has: balance(), signupBonus(amt), claimDaily(day, amt), dailyFloor(day, floor), spend(amt, reason, ref), lastClaimDay().
import {
  MAX_TOKENS, SIGNUP_BONUS, DAILY_FLOOR, DAILY_REWARDS, SCREENSHOT_COST, LIMIT_MESSAGE,
  utcDay, rewardForDate, messageCost, aiWorkCost, canClaim,
} from "./tokens.js";

const WEEK = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 0]];

// The once-per-day top-up to 5. Safe to call on every request: the database only applies it the first time each UTC day.
const floor = (db, now) => db.dailyFloor(utcDay(now), DAILY_FLOOR);

// Called right after a successful Discord sign-in.
export async function afterSignIn({ db, now = new Date() }) {
  const signup = await db.signupBonus(SIGNUP_BONUS);
  await floor(db, now);
  return { signup, balance: await db.balance() };
}

export async function getStatus({ db, now = new Date() }) {
  await db.signupBonus(SIGNUP_BONUS);          // accounts that signed in before tokens existed get their 30 here; the database makes it once-only
  await floor(db, now);
  const today = utcDay(now), last = await db.lastClaimDay();
  const can = canClaim({ lastClaimDay: last ? String(last).slice(0, 10) : null, today, claimDay: today }).ok;
  const todayDow = now.getUTCDay();
  return {
    balance: await db.balance(), max: MAX_TOKENS,
    today: { day: today, reward: rewardForDate(now), canClaim: can },
    week: WEEK.map(([name, dow]) => ({ name, reward: DAILY_REWARDS[dow], today: dow === todayDow })),
    costs: { message: 2, per35Words: 3, aiMinute: 3, screenshot: SCREENSHOT_COST },
  };
}

// Claim the reward for a day (default: today). Only today can be claimed: a missed day is gone, tomorrow is not available yet.
export async function claimToday({ db, now = new Date(), day }) {
  const today = utcDay(now), want = day ?? today;
  const last = await db.lastClaimDay();
  const c = canClaim({ lastClaimDay: last ? String(last).slice(0, 10) : null, today, claimDay: want });
  if (!c.ok) return { ok: false, reason: c.reason, balance: await db.balance() };
  const r = await db.claimDaily(today, rewardForDate(now));
  if (!r.claimed) return { ok: false, reason: "already_claimed", balance: r.balance };
  return { ok: true, added: r.added, balance: r.balance, reward: rewardForDate(now) };
}

// Decide whether a user message may be sent, and charge for it. A message that cannot be fully paid for is refused and costs nothing.
export async function gateMessage({ db, now = new Date(), text, messageId }) {
  await floor(db, now);
  const cost = messageCost(text), have = await db.balance();
  if (have < cost) return { allowed: false, cost, balance: have, limitMessage: LIMIT_MESSAGE };
  const r = await db.spend(cost, "message", messageId);
  if (!r.covered && !r.duplicate) return { allowed: false, cost, balance: r.balance, limitMessage: LIMIT_MESSAGE };
  return { allowed: true, cost, balance: r.balance };
}

// AI work: charged AFTER the run, per started minute. It may take the balance to 0 but never below, and never cuts a build short.
export async function chargeAiWork({ db, seconds, runId }) {
  const cost = aiWorkCost(seconds);
  if (cost === 0) return { cost: 0, spent: 0, balance: await db.balance() };
  const r = await db.spend(cost, "ai_work", runId);
  return { cost, spent: r.spent, balance: r.balance };
}

// A screenshot shown on the site. If it cannot be paid for, it is not shown and costs nothing.
export async function chargeScreenshot({ db, viewId }) {
  const have = await db.balance();
  if (have < SCREENSHOT_COST) return { allowed: false, cost: SCREENSHOT_COST, balance: have, limitMessage: LIMIT_MESSAGE };
  const r = await db.spend(SCREENSHOT_COST, "screenshot", viewId);
  if (!r.covered && !r.duplicate) return { allowed: false, cost: SCREENSHOT_COST, balance: r.balance, limitMessage: LIMIT_MESSAGE };
  return { allowed: true, cost: SCREENSHOT_COST, balance: r.balance };
}
