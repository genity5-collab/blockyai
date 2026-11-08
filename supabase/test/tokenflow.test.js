// Token flow: connects the pure rules to the database functions. The database is a fake in-memory one here (the real one is tested separately).
import test from "node:test"; import assert from "node:assert/strict";
import { getStatus, claimToday, gateMessage, chargeScreenshot, chargeAiWork, afterSignIn } from "../functions/_shared/tokenflow.js";
import { LIMIT_MESSAGE } from "../functions/_shared/tokens.js";

// A small fake of the SQL functions with the same behaviour (cap 100, never negative, idempotent refs, once-per-day).
function fakeDb(start = {}) {
  const s = { balance: 0, signup: false, lastClaim: null, lastFloor: null, refs: new Set(), ...start }; const log = [];
  const credit = (amt, reason, ref) => { if (ref && s.refs.has(reason + ":" + ref)) return { added: 0, balance: s.balance, duplicate: true }; if (ref) s.refs.add(reason + ":" + ref); const n = Math.min(100, s.balance + Math.max(0, amt)); const added = n - s.balance; s.balance = n; log.push([reason, added]); return { added, balance: n, duplicate: false }; };
  const db = {
    s, log,
    balance: async () => s.balance,
    signupBonus: async (amt) => { if (s.signup) return { added: 0, balance: s.balance, granted: false }; s.signup = true; const r = credit(amt, "signup", "signup"); return { ...r, granted: true }; },
    claimDaily: async (day, amt) => { if (s.lastClaim === day) return { added: 0, balance: s.balance, claimed: false }; s.lastClaim = day; const r = credit(amt, "daily_reward", day); return { added: r.added, balance: r.balance, claimed: true }; },
    dailyFloor: async (day, floor) => { if (s.lastFloor === day) return { added: 0, balance: s.balance }; s.lastFloor = day; if (s.balance >= floor) return { added: 0, balance: s.balance }; const r = credit(floor - s.balance, "daily_floor", day); return { added: r.added, balance: r.balance }; },
    spend: async (amt, reason, ref) => { if (ref && s.refs.has(reason + ":" + ref)) return { spent: 0, balance: s.balance, covered: true, duplicate: true }; if (ref) s.refs.add(reason + ":" + ref); const take = Math.min(s.balance, Math.max(0, amt)); s.balance -= take; log.push([reason, -take]); return { spent: take, balance: s.balance, covered: take >= amt, duplicate: false }; },
    lastClaimDay: async () => s.lastClaim,
  };
  return db;
}
const NOW = new Date("2026-11-08T12:00:00Z");   // a Sunday

test("afterSignIn: gives the 30 sign-up tokens once, and tops the floor up", async () => {
  const db = fakeDb(); const a = await afterSignIn({ db, now: NOW }); assert.equal(a.signup.granted, true); assert.equal(a.balance, 30);
  const b = await afterSignIn({ db, now: NOW }); assert.equal(b.signup.granted, false); assert.equal(b.balance, 30, "signing in again gives nothing more");
});
test("status: balance, today's reward, whether it can be claimed, and the weekly table", async () => {
  const db = fakeDb({ balance: 40, signup: true }); const st = await getStatus({ db, now: NOW });
  assert.equal(st.balance, 40); assert.equal(st.max, 100); assert.equal(st.today.reward, 15); assert.equal(st.today.canClaim, true); assert.equal(st.today.day, "2026-11-08");
  assert.equal(st.week.length, 7); assert.deepEqual(st.week.map((w) => w.reward), [20, 15, 20, 10, 30, 15, 15], "Mon..Sun"); assert.equal(st.week.find((w) => w.today).name, "Sun");
});
test("status: an account that signed in BEFORE tokens existed still gets its 30 sign-up tokens, once", async () => {
  const db = fakeDb({ balance: 0 }); const st = await getStatus({ db, now: NOW }); assert.equal(st.balance, 30, "30 bonus (the floor does not add on top, 30 is already above 5)");
  const st2 = await getStatus({ db, now: NOW }); assert.equal(st2.balance, 30, "never granted twice");
});
test("status: lifts a 0 balance to the 5-token floor once per day", async () => {
  const db = fakeDb({ balance: 0, signup: true }); const st = await getStatus({ db, now: NOW }); assert.equal(st.balance, 5); const st2 = await getStatus({ db, now: NOW }); assert.equal(st2.balance, 5, "asking again does not add more");
});
test("status: shows can't-claim after claiming", async () => {
  const db = fakeDb({ balance: 40, signup: true }); await claimToday({ db, now: NOW }); assert.equal((await getStatus({ db, now: NOW })).today.canClaim, false);
});
test("claim: pays today's weekday amount, once", async () => {
  const db = fakeDb({ balance: 10 }); const r = await claimToday({ db, now: NOW }); assert.equal(r.ok, true); assert.equal(r.added, 15); assert.equal(r.balance, 25);
  const r2 = await claimToday({ db, now: NOW }); assert.equal(r2.ok, false); assert.equal(r2.reason, "already_claimed"); assert.equal(db.s.balance, 25);
});
test("claim: Monday pays 20 and Friday pays 30", async () => {
  const mon = fakeDb(); assert.equal((await claimToday({ db: mon, now: new Date("2026-11-09T08:00:00Z") })).added, 20);
  const fri = fakeDb(); assert.equal((await claimToday({ db: fri, now: new Date("2026-11-06T23:59:00Z") })).added, 30);
});
test("claim: a missed day is gone, you cannot pay yourself yesterday's reward", async () => {
  const db = fakeDb(); const r = await claimToday({ db, now: NOW, day: "2026-11-07" }); assert.equal(r.ok, false); assert.equal(r.reason, "missed"); assert.equal(db.s.balance, 0);
  const t = await claimToday({ db, now: NOW, day: "2026-11-09" }); assert.equal(t.ok, false); assert.equal(t.reason, "not_yet");
});
test("claim: respects the 100 cap and says how much was really added", async () => {
  const db = fakeDb({ balance: 95 }); const r = await claimToday({ db, now: new Date("2026-11-06T10:00:00Z") }); assert.equal(r.ok, true); assert.equal(r.added, 5); assert.equal(r.balance, 100);
});
test("claim at the cap: still marks the day as claimed, adds 0", async () => {
  const db = fakeDb({ balance: 100 }); const r = await claimToday({ db, now: NOW }); assert.equal(r.ok, true); assert.equal(r.added, 0); assert.equal((await claimToday({ db, now: NOW })).ok, false);
});

test("message gate: enough tokens -> allowed and charged (2 + 3 per 35 words)", async () => {
  const db = fakeDb({ balance: 50, lastFloor: "2026-11-08" }); const text = Array.from({ length: 40 }, () => "w").join(" ");
  const g = await gateMessage({ db, now: NOW, text, messageId: "m1" }); assert.equal(g.allowed, true); assert.equal(g.cost, 5); assert.equal(g.balance, 45);
});
test("message gate: a short message costs 2", async () => { const db = fakeDb({ balance: 10, lastFloor: "2026-11-08" }); const g = await gateMessage({ db, now: NOW, text: "hello", messageId: "m2" }); assert.equal(g.cost, 2); assert.equal(g.balance, 8); });
test("message gate: empty balance -> blocked, nothing is charged, never negative", async () => {
  const db = fakeDb({ balance: 0, lastFloor: "2026-11-08" }); const g = await gateMessage({ db, now: NOW, text: "build me a house", messageId: "m3" }); assert.equal(g.allowed, false); assert.equal(g.limitMessage, LIMIT_MESSAGE); assert.equal(g.balance, 0); assert.ok(db.s.balance >= 0);
});
test("message gate: balance below the price (e.g. 1 token, price 2) -> blocked and keeps its token", async () => {
  const db = fakeDb({ balance: 1, lastFloor: "2026-11-08" }); const g = await gateMessage({ db, now: NOW, text: "hi", messageId: "m4" }); assert.equal(g.allowed, false); assert.equal(db.s.balance, 1, "a refused message costs nothing");
});
test("message gate: a 0 balance on a new day gets the daily floor first, so one short message can go through", async () => {
  const db = fakeDb({ balance: 0 }); const g = await gateMessage({ db, now: NOW, text: "hi", messageId: "m5" }); assert.equal(g.allowed, true); assert.equal(g.balance, 3, "5 floor - 2 message");
});
test("message gate: the same message id is never charged twice (a retry)", async () => {
  const db = fakeDb({ balance: 20, lastFloor: "2026-11-08" }); await gateMessage({ db, now: NOW, text: "hello", messageId: "m6" }); const again = await gateMessage({ db, now: NOW, text: "hello", messageId: "m6" }); assert.equal(db.s.balance, 18); assert.equal(again.allowed, true);
});

test("AI work: charges 3 per started minute and floors at 0 (an unfinished build is never cut off)", async () => {
  const db = fakeDb({ balance: 4, lastFloor: "2026-11-08" }); const r = await chargeAiWork({ db, seconds: 130, runId: "r1" }); assert.equal(r.cost, 9); assert.equal(r.spent, 4); assert.equal(r.balance, 0);
});
test("AI work: a run is billed once even if reported twice", async () => { const db = fakeDb({ balance: 30 }); await chargeAiWork({ db, seconds: 60, runId: "r2" }); await chargeAiWork({ db, seconds: 60, runId: "r2" }); assert.equal(db.s.balance, 27); });
test("AI work: 0 seconds costs nothing", async () => { const db = fakeDb({ balance: 30 }); const r = await chargeAiWork({ db, seconds: 0, runId: "r3" }); assert.equal(r.spent, 0); assert.equal(db.s.balance, 30); });

test("screenshot: costs 2 each time it is shown; with 1 token left it is NOT shown and costs nothing", async () => {
  const db = fakeDb({ balance: 10 }); const a = await chargeScreenshot({ db, viewId: "v1" }); assert.equal(a.allowed, true); assert.equal(a.balance, 8);
  const poor = fakeDb({ balance: 1 }); const b = await chargeScreenshot({ db: poor, viewId: "v2" }); assert.equal(b.allowed, false); assert.equal(poor.s.balance, 1);
});
test("screenshot: the same view id is not charged twice (a double click)", async () => { const db = fakeDb({ balance: 10 }); await chargeScreenshot({ db, viewId: "v9" }); const again = await chargeScreenshot({ db, viewId: "v9" }); assert.equal(db.s.balance, 8); assert.equal(again.allowed, true); });
