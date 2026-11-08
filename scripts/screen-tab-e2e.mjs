// Real-browser check of the site's Screen tab against the LIVE site: safe page -> picture, login page -> black "fixing it" frame with NO picture left, safe page -> picture again.
// Needs SUPABASE_ACCESS_TOKEN, Chrome at /usr/bin/google-chrome, and Playwright (set PLAYWRIGHT_PATH to its index.mjs if it is not installed here). Cleans up after itself.
import { randomUUID, createHash } from "node:crypto"; import { readFileSync } from "node:fs";
const P = "sqiruowyfjoctskogzjw", SITE = "https://blockyai.onrender.com", D = "999000000000000880", SB = `https://${P}.supabase.co`;
const SQL = (q) => fetch(`https://api.supabase.com/v1/projects/${P}/database/query`, { method: "POST", headers: { Authorization: "Bearer " + process.env.SUPABASE_ACCESS_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }).then((r) => r.json());
const sha = (s) => createHash("sha256").update(s).digest("hex"); let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || "playwright");
let sid = ""; const tok = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const key = "key-" + randomUUID() + "-padpadpad", oh = sha("ck:" + key);
const IMG = readFileSync(new URL("../screen/test/sample-screen.jpg", import.meta.url)).toString("base64");
const send = (o) => fetch(`${SB}/functions/v1/agent-screen`, { method: "POST", headers: { "Content-Type": "application/json", "x-agent-token": tok }, body: JSON.stringify({ image: IMG, ...o }) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }));
const safe = (act) => send({ url: "https://example.com/", title: "Example Domain", text: "Example Domain. This domain is for use in documentation.", has_password_field: false, activity: act });
const login = () => send({ url: "https://github.com/login", title: "Sign in to GitHub", text: "Username Password Sign in", has_password_field: true, activity: "Opening github.com/login" });
let b;
try {
  const acc = (await SQL(`select public.link_discord_login('${D}','Screen Tab Tester',null,'${oh}') id`))[0].id; await SQL(`update accounts set chat_only=true where id='${acc}'`);
  b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 850 } }); const pg = await ctx.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(String(e).slice(0, 100)));
  await pg.addInitScript(`localStorage.setItem('blocky_client_key','${key}');localStorage.setItem('blocky_client_id','${randomUUID()}')`);
  await pg.goto(SITE + "/#/chat", { waitUntil: "networkidle" }); await pg.waitForTimeout(2500);
  const st = pg.locator("button", { hasText: "Start new session" }); if (await st.count()) { await st.click(); await pg.waitForTimeout(3500); }
  sid = (await SQL(`select id from sessions where owner_key_hash='${oh}' order by created_at desc limit 1`))[0].id;
  await SQL(`update sessions set vm_status='running', agent_token_hash='${sha(tok)}', agent_token_expires_at=now() + interval '20 minutes' where id='${sid}'`);
  const polls = []; pg.on("response", async (r) => { if (r.url().includes("web-api")) { try { const rq = JSON.parse(r.request().postData() || "{}"); if (rq.action === "screen_latest") polls.push({ sid: rq.session_id, st: r.status(), body: (await r.text()).slice(0, 90) }); } catch {} } });
  const r1 = await safe("Reading example.com"); ok(r1.s === 200 && r1.j.shown === true, "a safe page is accepted as SHOWN: " + JSON.stringify(r1.j).slice(0, 80));
  await pg.reload({ waitUntil: "networkidle" }); await pg.waitForTimeout(2500);
  await pg.locator('[role=tab]', { hasText: "Screen" }).click(); await pg.waitForTimeout(3500);
  console.log("   my session:", sid.slice(0, 8), "| polls:", JSON.stringify(polls.slice(-1)).slice(0, 160));
  const img = pg.locator(".screen-frame img"); ok((await img.count()) === 1, "STATE 1 (safe page): the picture is on screen");
  ok((await pg.locator(".screen-frame.live").count()) === 1, "  and the frame is marked live");
  const txt1 = await pg.locator(".screenpane").innerText(); ok(/Reading example\.com/.test(txt1), "  the activity line is shown: " + txt1.replace(/\s+/g, " ").slice(0, 80));
  if (await img.count()) { const nat = await img.evaluate((i) => ({ w: i.naturalWidth, h: i.naturalHeight })); ok(nat.w === 1280 && nat.h === 800, "  the picture really loaded (" + nat.w + "x" + nat.h + ")"); }
  await pg.screenshot({ path: "/tmp/fs/screen_state1.png" });
  const r2 = await login(); ok(r2.s === 200 && r2.j.shown === false, "a login page is decided HIDDEN by the server: " + JSON.stringify(r2.j).slice(0, 110));
  await pg.waitForTimeout(6500);
  ok((await pg.locator(".screen-frame img").count()) === 0, "STATE 2 (login page): NO picture element is left in the page");
  const html2 = await pg.locator(".screenpane").innerHTML(); ok(!/data:image/.test(html2) && !/base64/.test(html2), "  and no picture data is left anywhere in the panel");
  const txt2 = await pg.locator(".screenpane").innerText(); ok(/Fixing it/i.test(txt2), "  it says it is fixing it: " + txt2.replace(/\s+/g, " ").slice(0, 100));
  ok(!/Example Domain/.test(txt2), "  and the last page's title is gone");
  ok(!/github/i.test(await pg.locator(".screen-frame").innerText()), "  and the private page's name is not shown inside the frame");
  await pg.screenshot({ path: "/tmp/fs/screen_state2.png" });
  await new Promise((r) => setTimeout(r, 4000));
  const r3 = await safe("Reading example.com again"); ok(r3.s === 200 && r3.j.shown === true, "the AI returns to a safe page");
  await pg.waitForTimeout(6500);
  ok((await pg.locator(".screen-frame img").count()) === 1, "STATE 3 (safe again): the picture comes back by itself");
  console.log("   last polls:", JSON.stringify(polls.slice(-4).map((p) => ({ st: p.st, b: p.body.slice(0, 60) }))));
  console.log("   r3 =", JSON.stringify(r3.j).slice(0, 120));
  await pg.screenshot({ path: "/tmp/fs/screen_state3.png" });
  ok(errs.length === 0, "no page errors in the browser" + (errs.length ? ": " + errs.join(" | ") : ""));
} catch (e) { console.log("ERR", String(e).slice(0, 300)); fails++; }
finally {
  if (b) await b.close(); if (!sid) sid = randomUUID();
  try { const H = { Authorization: "Bearer " + process.env.SUPABASE_ACCESS_TOKEN, "Content-Type": "application/json" }; const ks = await fetch(`https://api.supabase.com/v1/projects/${P}/api-keys`, { headers: H }).then((r) => r.json()); const sr = ks.find((k) => k.name === "service_role");
    const names = (await SQL(`select name from storage.objects where bucket_id='screen' and name like '${sid}/%'`)).map((o) => o.name); if (names.length) await fetch(`${SB}/storage/v1/object/screen`, { method: "DELETE", headers: { Authorization: "Bearer " + sr.api_key, apikey: sr.api_key, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: names }) }); } catch (e) { console.log("storage cleanup:", String(e).slice(0, 80)); }
  await SQL(`delete from screen_frames where session_id='${sid}'`); await SQL(`delete from messages where session_id='${sid}'`); await SQL(`delete from sessions where id='${sid}'`); await SQL(`delete from accounts where discord_id='${D}'`);
  console.log("cleanup:", JSON.stringify((await SQL(`select (select count(*) from sessions where id='${sid}') s,(select count(*) from accounts where discord_id='${D}') a,(select count(*) from screen_frames where session_id='${sid}') f,(select count(*) from storage.objects where bucket_id='screen' and name like '${sid}/%') o`))[0]));
}
console.log(fails ? `\n${fails} FAILED` : "\nSCREEN TAB VERIFIED IN A REAL BROWSER"); process.exit(fails ? 1 : 0);
