import { randomUUID, createHash, randomBytes } from "node:crypto"; import { readFileSync } from "node:fs";
const P = "sqiruowyfjoctskogzjw", SITE = "https://blockyai.onrender.com", FN = `https://${P}.supabase.co/functions/v1`, D = "999000000000000840", R = "./";
const SQL = (q) => fetch(`https://api.supabase.com/v1/projects/${P}/database/query`, { method: "POST", headers: { Authorization: "Bearer " + process.env.SUPABASE_ACCESS_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }).then((r) => r.json());
const sha = (s) => createHash("sha256").update(s).digest("hex"); let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const key = "key-" + randomUUID() + "-padpadpad", oh = sha("ck:" + key), sid = randomUUID(), agentTok = randomBytes(24).toString("hex");
const web = (a, b = {}) => fetch(`${SITE}/api/web-api`, { method: "POST", headers: { "Content-Type": "application/json", "x-client-key": key }, body: JSON.stringify({ client_id: randomUUID(), action: a, session_id: sid, ...b }) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }));
const vmSend = (b) => fetch(`${FN}/agent-screen`, { method: "POST", headers: { "Content-Type": "application/json", "x-agent-token": agentTok }, body: JSON.stringify(b) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }));
const jpg = readFileSync(R + "screen/test/sample-screen.jpg").toString("base64");
const good = { image: jpg, url: "https://create.roblox.com/docs/reference/engine/classes/TweenService", title: "TweenService | Documentation", text: "TweenService lets you animate properties of instances.", activity: "Reading the TweenService page" };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const acc = (await SQL(`select public.link_discord_login('${D}','Screen Tester',null,'${oh}') id`))[0].id; await SQL(`update accounts set chat_only=true where id='${acc}'`);
  await SQL(`insert into sessions (id,title,owner_key_hash,account_id,agent_token_hash,agent_token_expires_at) values ('${sid}','screen e2e','${oh}','${acc}','${sha(agentTok)}', now() + interval '10 minutes')`);

  ok((await web("screen_latest")).j.none === true, "before any frame the site gets 'none'");
  ok((await fetch(`${FN}/agent-screen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status === 401, "no token is refused (401)");
  ok((await fetch(`${FN}/agent-screen`, { method: "POST", headers: { "Content-Type": "application/json", "x-agent-token": "wrong" }, body: "{}" })).status === 401, "wrong token is refused (401)");

  const a = await vmSend(good); ok(a.s === 200 && a.j.shown === true && a.j.seq === 1, "safe page accepted and shown: " + JSON.stringify(a.j));
  const s1 = await web("screen_latest"); const got = Buffer.from(s1.j.image || "", "base64");
  ok(s1.j.shown === true && got[0] === 0xff && got[1] === 0xd8 && got.length === 108859 && s1.j.mime === "image/jpeg", "the owner gets the real JPEG inside the response (" + got.length + " bytes), identical size to what the VM sent");
  ok(s1.j.host === "create.roblox.com" && s1.j.title === "TweenService | Documentation" && s1.j.width === 1280 && s1.j.activity === "Reading the TweenService page", "site name, title, size and activity are returned");
  ok(!JSON.stringify(s1.j).replace(s1.j.image, "").includes("animate properties") && !JSON.stringify(s1.j).includes("/docs/reference"), "the page text and path never reach the site");
  ok(!("url" in s1.j) && !("storage_path" in s1.j), "no link and no storage path is exposed, so there is nothing a CDN could cache");
  const same = await web("screen_latest", { since: s1.j.seq }); ok(same.j.unchanged === true && !same.j.image, "asking again with the same frame number sends no picture (saves bandwidth)");

  await wait(700);
  const h = await vmSend({ ...good, url: "https://github.com/login", title: "Sign in to GitHub", text: "Username Password Sign in", has_password_field: true });
  ok(h.s === 200 && h.j.shown === false && /password field/.test(h.j.why || ""), "a login page is hidden: " + JSON.stringify(h.j).slice(0, 140));
  const s2 = await web("screen_latest"); ok(s2.j.shown === false && s2.j.kind === "private" && !s2.j.url && !s2.j.title && !s2.j.host, "the site now gets NO picture, NO title, NO site for the hidden frame: " + JSON.stringify(s2.j));
  ok(!s2.j.image && !JSON.stringify(s2.j).includes("/9j/"), "after the hide there is no picture data of any kind in the response");
  const s2b = await web("screen_latest", { since: s1.j.seq }); ok(s2b.j.shown === false && !s2b.j.image, "even a client that passes the OLD frame number gets the hide, not the old picture");

  await wait(700);
  const h2 = await vmSend({ ...good, text: "token ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8" }); ok(h2.j.shown === false && !JSON.stringify(h2.j).includes("ghp_"), "a secret on the page is hidden and never echoed");
  const h3 = await vmSend({ image: jpg }); ok(h3.j.shown === false, "no page info at all: hidden (cannot check, so do not show)");
  const bad = await vmSend({ ...good, image: Buffer.from("<html>not an image</html>").toString("base64") }); ok(bad.s === 400, "a non-image is rejected: " + bad.s + " " + (bad.j.error || ""));
  await wait(700); const [quick, quick2] = await Promise.all([vmSend(good), vmSend(good)]); ok([quick, quick2].filter((x) => x.j.skipped).length >= 0 && (quick.j.shown === true || quick2.j.shown === true), "two near-simultaneous frames: at least one is accepted (" + JSON.stringify([quick.j, quick2.j]).slice(0, 110) + ")");
  const rows = (await SQL(`select count(*) c, max(seq) m from screen_frames where session_id='${sid}'`))[0]; ok(+rows.c === 1, "exactly ONE row per session (latest only): " + JSON.stringify(rows));
  const objs = (await SQL(`select count(*) c from storage.objects where bucket_id='screen' and name like '${sid}/%'`))[0]; ok(+objs.c <= 1, "at most ONE stored picture for the session (older ones deleted): " + objs.c);

  // another person cannot read this session's screen
  const other = "key-" + randomUUID() + "-otherother"; const o = await fetch(`${SITE}/api/web-api`, { method: "POST", headers: { "Content-Type": "application/json", "x-client-key": other }, body: JSON.stringify({ client_id: randomUUID(), action: "screen_latest", session_id: sid }) }); ok(o.status >= 400, "a different user cannot read this screen: " + o.status);
  const noauth = await fetch(`${SITE}/api/web-api`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: randomUUID(), action: "screen_latest", session_id: sid }) }); ok(noauth.status >= 400, "no key at all cannot read it: " + noauth.status);
  // direct access to the bucket without a signed link
  const direct = await fetch(`https://${P}.supabase.co/storage/v1/object/public/screen/${sid}/x.jpg`); ok(direct.status >= 400, "the bucket is not public: " + direct.status);
} finally {
  await SQL(`delete from screen_frames where session_id='${sid}'`);
  const left = await SQL(`select name from storage.objects where bucket_id='screen' and name like '${sid}/%'`); for (const o of left) await SQL(`delete from storage.objects where bucket_id='screen' and name='${o.name}'`);
  await SQL(`delete from messages where session_id='${sid}'`); await SQL(`delete from sessions where id='${sid}'`); await SQL(`delete from accounts where discord_id='${D}'`);
  console.log("cleanup:", JSON.stringify((await SQL(`select (select count(*) from sessions where id='${sid}') s,(select count(*) from accounts where discord_id='${D}') a,(select count(*) from screen_frames where session_id='${sid}') f`))[0]));
}
console.log(fails ? `\n${fails} FAILED` : "\nSCREEN PATH VERIFIED LIVE"); process.exit(fails ? 1 : 0);
