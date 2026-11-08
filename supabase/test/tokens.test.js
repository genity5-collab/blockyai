// Token rules (pure). All times are UTC. Run: node --test test/tokens.test.js
import test from "node:test"; import assert from "node:assert/strict";
import { MAX_TOKENS, SIGNUP_BONUS, DAILY_FLOOR, DAILY_REWARDS, rewardForDate, utcDay, countWords, messageCost, aiWorkCost, SCREENSHOT_COST, applyCredit, planDailyFloor, canClaim, LIMIT_MESSAGE } from "../functions/_shared/tokens.js";

const d = (s) => new Date(s + "T12:00:00Z");

test("constants match the spec", () => { assert.equal(MAX_TOKENS, 100); assert.equal(SIGNUP_BONUS, 30); assert.equal(DAILY_FLOOR, 5); assert.equal(SCREENSHOT_COST, 2); });
test("weekday rewards: Mon 20, Tue 15, Wed 20, Thu 10, Fri 30, Sat 15, Sun 15 (UTC)", () => {
  // 2026-11-02 is a Monday
  const want = { "2026-11-02": 20, "2026-11-03": 15, "2026-11-04": 20, "2026-11-05": 10, "2026-11-06": 30, "2026-11-07": 15, "2026-11-08": 15 };
  for (const [day, r] of Object.entries(want)) assert.equal(rewardForDate(d(day)), r, day);
  assert.deepEqual(DAILY_REWARDS, [15, 20, 15, 20, 10, 30, 15]);      // index = getUTCDay(): Sun..Sat
});
test("the day is the UTC day, even for a time just before/after midnight", () => {
  assert.equal(utcDay(new Date("2026-11-08T23:59:59Z")), "2026-11-08"); assert.equal(utcDay(new Date("2026-11-09T00:00:00Z")), "2026-11-09");
  assert.equal(rewardForDate(new Date("2026-11-08T23:59:59Z")), 15); assert.equal(rewardForDate(new Date("2026-11-09T00:00:00Z")), 20);   // Sunday 15 -> Monday 20
  assert.equal(utcDay(new Date("2026-11-08T23:30:00-05:00")), "2026-11-09");                                                        // a non-UTC offset is normalised
});
test("word count: whitespace separated, ignores extra spaces and empty text", () => {
  assert.equal(countWords(""), 0); assert.equal(countWords("   "), 0); assert.equal(countWords("hello"), 1); assert.equal(countWords("  a   b\n\tc  "), 3); assert.equal(countWords(null), 0); assert.equal(countWords(undefined), 0); assert.equal(countWords(5), 1);
});
test("message cost: 2 per message, +3 per 35 words (they stack)", () => {
  const w = (n) => Array.from({ length: n }, () => "w").join(" ");
  assert.equal(messageCost(w(1)), 2); assert.equal(messageCost(w(34)), 2);           // under 35 words: just the message fee
  assert.equal(messageCost(w(35)), 5);                                              // 35 words = 3, plus 2 = 5 (the spec's "3+2 can stack")
  assert.equal(messageCost(w(69)), 5); assert.equal(messageCost(w(70)), 8); assert.equal(messageCost(w(105)), 11);
  assert.equal(messageCost(""), 2, "an attachment-only message still costs the message fee");
});
test("a very long message has a bounded cost (the server already caps text at 4000 chars)", () => { const huge = Array.from({ length: 4000 }, () => "w").join(" "); assert.ok(messageCost(huge) <= 2 + 3 * Math.ceil(2000 / 35) + 3 * 200); assert.ok(Number.isInteger(messageCost(huge))); });
test("AI work: 3 tokens per minute, billed per started minute", () => {
  assert.equal(aiWorkCost(0), 0); assert.equal(aiWorkCost(-5), 0); assert.equal(aiWorkCost(NaN), 0); assert.equal(aiWorkCost(1), 3); assert.equal(aiWorkCost(60), 3); assert.equal(aiWorkCost(61), 6); assert.equal(aiWorkCost(120), 6); assert.equal(aiWorkCost(121), 9);
});
test("AI work is capped so a stuck run cannot drain an account (max 30 minutes billed per run)", () => { assert.equal(aiWorkCost(3 * 3600), 90); assert.equal(aiWorkCost(1e9), 90); });
test("credit: never above 100, reports what was really added", () => {
  assert.deepEqual(applyCredit(0, 30), { balance: 30, added: 30 }); assert.deepEqual(applyCredit(90, 30), { balance: 100, added: 10 }); assert.deepEqual(applyCredit(100, 20), { balance: 100, added: 0 });
  assert.deepEqual(applyCredit(50, -5), { balance: 50, added: 0 }, "a credit can never subtract"); assert.deepEqual(applyCredit(NaN, 10), { balance: 10, added: 10 }); assert.deepEqual(applyCredit(150, 10), { balance: 100, added: 0 }, "a balance somehow above the cap is pulled back");
});
test("daily floor: tops up to 5, never above 5 from this alone, never when already >= 5", () => {
  assert.equal(planDailyFloor(0), 5); assert.equal(planDailyFloor(3), 2); assert.equal(planDailyFloor(5), 0); assert.equal(planDailyFloor(60), 0); assert.equal(planDailyFloor(-2), 5, "a (buggy) negative balance is lifted to 5"); assert.equal(planDailyFloor(NaN), 5);
});
test("claim: once per UTC day; a missed day can never be claimed later", () => {
  const today = "2026-11-08";
  assert.deepEqual(canClaim({ lastClaimDay: null, today, claimDay: today }), { ok: true });
  assert.deepEqual(canClaim({ lastClaimDay: "2026-11-07", today, claimDay: today }), { ok: true });
  assert.deepEqual(canClaim({ lastClaimDay: today, today, claimDay: today }), { ok: false, reason: "already_claimed" });
  assert.deepEqual(canClaim({ lastClaimDay: null, today, claimDay: "2026-11-07" }), { ok: false, reason: "missed" }, "yesterday's reward is gone");
  assert.deepEqual(canClaim({ lastClaimDay: null, today, claimDay: "2026-11-09" }), { ok: false, reason: "not_yet" }, "tomorrow's reward is not available yet");
  assert.equal(canClaim({ lastClaimDay: null, today, claimDay: "garbage" }).ok, false); assert.equal(canClaim({}).ok, false);
});
test("the limit message is exactly what the spec says", () => { assert.equal(LIMIT_MESSAGE, "Credits Usage Limit Reached. Come Back Tomorrow."); });
