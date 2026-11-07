// Queue tests on REAL PostgreSQL. They apply supabase/migrations/0008_reliable_queue.sql unmodified.
// Start the server first:  /tmp/start-pg.sh   (runs pg-server.mjs as a non-root user)
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startPg } from "./pg-harness.mjs";

let db;
before(async () => { db = await startPg(); });
after(async () => { await db.stop(); });

const session = async () => (await db.admin.query("insert into sessions default values returning id")).rows[0].id;
const enqueue = async (sid, type = "get_tree", extra = {}) => (await db.admin.query(
  "insert into commands(session_id,type,status,needs_confirm,confirmed) values ($1,$2,'queued',$3,$4) returning id", [sid, type, !!extra.needs_confirm, !!extra.confirmed])).rows[0].id;
const claim = async (client, sid, lease = 30) => (await client.query("select * from claim_command($1,$2)", [sid, lease])).rows;
const row = async (id) => (await db.admin.query("select * from commands where id=$1", [id])).rows[0];
const expireLease = (id) => db.admin.query("update commands set lease_expires_at = now() - interval '1 second' where id=$1", [id]);

test("state machine: queued -> claimed -> running (ack) -> done", async () => {
  const sid = await session(), id = await enqueue(sid);
  assert.equal((await row(id)).status, "queued");
  const [c] = await claim(db.admin, sid); assert.equal(c.id, id); assert.equal(c.status, "claimed"); assert.equal(c.attempts, 1);
  assert.equal((await db.admin.query("select ack_command($1,$2) s", [sid, id])).rows[0].s, "running");
  const r = await row(id); assert.equal(r.status, "running"); assert.ok(r.acked_at, "ack time recorded");
  assert.equal((await db.admin.query("select finish_command($1,$2,true,'{\"n\":1}',null) s", [sid, id])).rows[0].s, "done");
  assert.deepEqual((await row(id)).result, { n: 1 });
});

test("EXACTLY ONCE: 20 concurrent pollers on one queued command, exactly one receives it", async () => {
  const sid = await session(), id = await enqueue(sid);
  const clients = await Promise.all(Array.from({ length: 20 }, () => db.mk()));
  const results = await Promise.all(clients.map((c) => claim(c, sid)));
  const winners = results.filter((r) => r.length === 1);
  assert.equal(winners.length, 1, "exactly one poller must win");
  assert.equal(winners[0][0].id, id);
  assert.equal((await row(id)).attempts, 1, "handed out once");
  await Promise.all(clients.map((c) => c.end()));
});

test("EXACTLY ONCE across many commands: 10 pollers, 10 commands, no command delivered twice, none lost, in order", async () => {
  const sid = await session(); const ids = []; for (let i = 0; i < 10; i++) ids.push(await enqueue(sid));
  const clients = await Promise.all(Array.from({ length: 10 }, () => db.mk()));
  const got = [];
  try {
    // 10 pollers race on every round; each claimed command is finished before the next round (strict ordering allows one at a time)
    for (let round = 0; round < 40 && got.length < 10; round++) {
      const rs = (await Promise.all(clients.map((c) => claim(c, sid)))).flat();
      assert.ok(rs.length <= 1, "never more than one command in flight");
      for (const c of rs) { got.push(c.id); await db.admin.query("select finish_command($1,$2,true,'{}',null)", [sid, c.id]); }
    }
  } finally { await Promise.all(clients.map((c) => c.end())); }
  assert.equal(got.length, 10); assert.equal(new Set(got).size, 10, "no duplicate delivery");
  assert.deepEqual(got, ids, "delivered in insertion order");
});

test("ORDERING HAZARD: commands inserted in ONE transaction (same now()) still run in insertion order", async () => {
  const sid = await session(); const ids = [];
  await db.admin.query("begin");
  for (const t of ["snapshot_save", "delete", "create", "move", "set_properties"]) ids.push((await db.admin.query("insert into commands(session_id,type,status) values ($1,$2,'queued') returning id", [sid, t])).rows[0].id);
  await db.admin.query("commit");
  const stamps = (await db.admin.query("select count(distinct created_at) n from commands where session_id=$1", [sid])).rows[0].n;
  assert.equal(Number(stamps), 1, "precondition: all five share one created_at, so created_at cannot order them");
  const order = [];
  for (let i = 0; i < 5; i++) { const [c] = await claim(db.admin, sid); order.push(c.type); await db.admin.query("select finish_command($1,$2,true,'{}',null)", [sid, c.id]); }
  assert.deepEqual(order, ["snapshot_save", "delete", "create", "move", "set_properties"], "the safety snapshot must run BEFORE the delete it protects");
});

test("ORDERING: while command 1 is running, command 2 is NOT handed out", async () => {
  const sid = await session(), a = await enqueue(sid), b = await enqueue(sid);
  const [c1] = await claim(db.admin, sid); assert.equal(c1.id, a);
  assert.deepEqual(await claim(db.admin, sid), [], "no overtaking");
  await db.admin.query("select finish_command($1,$2,true,'{}',null)", [sid, a]);
  const [c2] = await claim(db.admin, sid); assert.equal(c2.id, b);
});

test("LEASE EXPIRY: plugin vanishes mid-command -> re-queued, redelivered, attempts counted", async () => {
  const sid = await session(), id = await enqueue(sid);
  await claim(db.admin, sid); await db.admin.query("select ack_command($1,$2)", [sid, id]);   // running, then the plugin dies
  assert.deepEqual(await claim(db.admin, sid), [], "lease still valid: nothing to hand out yet");
  await expireLease(id);
  const [again] = await claim(db.admin, sid); assert.equal(again.id, id, "re-queued and handed out again");
  assert.equal(again.attempts, 2);
});

test("BOUNDED RE-QUEUE: re-queued at most 2 times, then EXPIRED (3 deliveries total)", async () => {
  const sid = await session(), id = await enqueue(sid);
  for (let delivery = 1; delivery <= 3; delivery++) {
    const [c] = await claim(db.admin, sid); assert.ok(c, `delivery ${delivery}`); assert.equal(c.attempts, delivery);
    await expireLease(id);
  }
  assert.deepEqual(await claim(db.admin, sid), [], "no 4th delivery");
  const r = await row(id); assert.equal(r.status, "expired"); assert.match(r.error, /lease expired 3 times/); assert.ok(r.finished_at);
});

test("HEARTBEAT renews the lease so a slow command is not re-queued", async () => {
  const sid = await session(), id = await enqueue(sid);
  await claim(db.admin, sid, 1); await db.admin.query("update commands set lease_expires_at = now() + interval '1 second' where id=$1", [id]);
  assert.equal((await db.admin.query("select heartbeat_command($1,$2,30) ok", [sid, id])).rows[0].ok, true);
  await new Promise((r) => setTimeout(r, 1300));
  assert.deepEqual(await claim(db.admin, sid), [], "lease was renewed, so it is still running");
  assert.equal((await row(id)).status, "claimed"); assert.equal((await row(id)).attempts, 1);
});

test("LOST RESULT / DUPLICATE RESULT: the second result is ignored and reported as duplicate", async () => {
  const sid = await session(), id = await enqueue(sid); await claim(db.admin, sid);
  assert.equal((await db.admin.query("select finish_command($1,$2,true,'{\"v\":1}',null) s", [sid, id])).rows[0].s, "done");
  assert.equal((await db.admin.query("select finish_command($1,$2,false,'{\"v\":2}','late') s", [sid, id])).rows[0].s, "duplicate");
  const r = await row(id); assert.equal(r.status, "done"); assert.deepEqual(r.result, { v: 1 }, "first writer wins");
});

test("a result for an EXPIRED command is rejected as duplicate (cannot resurrect it)", async () => {
  const sid = await session(), id = await enqueue(sid);
  for (let i = 0; i < 3; i++) { await claim(db.admin, sid); await expireLease(id); }
  await claim(db.admin, sid);   // runs the expiry step
  assert.equal((await row(id)).status, "expired");
  assert.equal((await db.admin.query("select finish_command($1,$2,true,'{}',null) s", [sid, id])).rows[0].s, "duplicate");
});

test("ack / heartbeat from the wrong session do nothing", async () => {
  const s1 = await session(), s2 = await session(), id = await enqueue(s1); await claim(db.admin, s1);
  assert.equal((await db.admin.query("select ack_command($1,$2) s", [s2, id])).rows[0].s, "ignored");
  assert.equal((await db.admin.query("select heartbeat_command($1,$2) ok", [s2, id])).rows[0].ok, false);
  assert.equal((await db.admin.query("select finish_command($1,$2,true,'{}',null) s", [s2, id])).rows[0].s, "duplicate");
  assert.equal((await row(id)).status, "claimed");
});

test("CONCURRENT SESSIONS are independent: each gets only its own command", async () => {
  const s1 = await session(), s2 = await session(), a = await enqueue(s1), b = await enqueue(s2);
  const [r1, r2] = await Promise.all([claim(db.admin, s1), claim(db.admin, s2)]);
  assert.equal(r1[0].id, a); assert.equal(r2[0].id, b);
  assert.deepEqual(await claim(db.admin, s1), [], "s1 has nothing else");
});

test("a command that needs confirmation is not handed out until confirmed", async () => {
  const sid = await session(), id = await enqueue(sid, "run_lua", { needs_confirm: true });
  assert.deepEqual(await claim(db.admin, sid), []);
  await db.admin.query("update commands set confirmed=true where id=$1", [id]);
  assert.equal((await claim(db.admin, sid))[0].id, id);
});

test("NEVER-CLAIMED commands expire after 10 minutes (plugin offline), they do not wait forever", async () => {
  const sid = await session(), id = await enqueue(sid);
  await db.admin.query("update commands set created_at = now() - interval '11 minutes' where id=$1", [id]);
  assert.deepEqual(await claim(db.admin, sid), []);
  const r = await row(id); assert.equal(r.status, "expired"); assert.match(r.error, /plugin was offline/);
});

test("IDEMPOTENCY KEY: the same key in a session cannot be inserted twice; other sessions may reuse it", async () => {
  const s1 = await session(), s2 = await session();
  await db.admin.query("insert into commands(session_id,type,idempotency_key,status) values ($1,'create','k1','queued')", [s1]);
  await assert.rejects(db.admin.query("insert into commands(session_id,type,idempotency_key,status) values ($1,'create','k1','queued')", [s1]), /commands_idem_uq|duplicate key/);
  await db.admin.query("insert into commands(session_id,type,idempotency_key,status) values ($1,'create','k1','queued')", [s2]);
});

test("migration moved legacy 'pending' rows to 'queued' and rejects unknown states", async () => {
  const sid = await session();
  await assert.rejects(db.admin.query("insert into commands(session_id,type,status) values ($1,'x','pending')", [sid]), /commands_status_check/);
  await assert.rejects(db.admin.query("insert into commands(session_id,type,status) values ($1,'x','bogus')", [sid]), /commands_status_check/);
});
