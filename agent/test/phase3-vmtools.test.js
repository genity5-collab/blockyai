// Real tests for vm_run_luau (real luau runtime), vm_web_fetch (real curl against a local server, SSRF guard ON) and the search parser.
// The live search provider is NOT contacted here: parseDdgHtml is tested on a FIXTURE shaped like DuckDuckGo's page. That proves parsing, not that the provider answers.
import test from "node:test"; import assert from "node:assert/strict";
import http from "node:http"; import { readdirSync, readFileSync } from "node:fs"; import { execFileSync } from "node:child_process";
import { TOOLS } from "../src/tools.js";   // must load first: tools.js merges the extra tool sets (same order as production, where loop.js imports it first)
import { isPublicIp, parseWebUrl, htmlToText, extractTitle, parseDdgHtml } from "../src/netguard.js";
import { vmRunLuau, vmWebFetch, vmWebSearch, WEB } from "../src/tools-vm.js";
import { currentTurn } from "../src/lifecycle.js";

let hasLuau = true; try { execFileSync("luau", ["--help"], { stdio: "ignore" }); } catch (e) { hasLuau = e.code !== "ENOENT"; }
// Exact check: a process whose program is "luau" and whose arguments name the file. Reads /proc directly, so it cannot match itself the way pgrep -f can.
function luauProcsRunning(file) {
  return readdirSync("/proc").filter((d) => /^\d+$/.test(d)).flatMap((d) => {
    try { const argv = readFileSync(`/proc/${d}/cmdline`, "utf8").split("\0").filter(Boolean); return /(^|\/)luau$/.test(argv[0] ?? "") && argv.some((x) => x.endsWith(file)) ? [Number(d)] : []; } catch { return []; }
  });
}
const noLuau = hasLuau ? false : "luau runtime not installed here (it is on the VM)";

test("netguard: private, loopback, metadata and reserved addresses are refused; public ones pass", () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) assert.equal(isPublicIp(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"]) assert.equal(isPublicIp(ip), true, ip);
});
test("netguard: parseWebUrl blocks the usual tricks", () => {
  for (const u of ["file:///etc/passwd", "ftp://example.com/x", "http://localhost/", "http://x.internal/", "http://intranet/", "http://169.254.169.254/latest/meta-data/", "http://2130706433/", "http://0x7f.1/", "http://[::1]/", "https://user:pw@example.com/", "http://example.com:22/", "javascript:alert(1)", "not a url"]) assert.throws(() => parseWebUrl(u), Error, u);
  assert.equal(parseWebUrl("https://create.roblox.com/docs").hostname, "create.roblox.com");
});
test("netguard: htmlToText strips scripts/tags, keeps text, and does not turn entities back into tags", () => {
  const t = htmlToText("<html><head><title>T</title><style>p{}</style></head><body><script>evil()</script><h1>Hello &amp; welcome</h1><p>a&nbsp;b</p><ul><li>one</li><li>two</li></ul>&lt;script&gt;x&lt;/script&gt;</body></html>");
  assert.match(t, /Hello & welcome/); assert.match(t, /- one/); assert.doesNotMatch(t, /evil\(\)/); assert.match(t, /<script>x<\/script>/);   // visible as TEXT, not executed or parsed
  assert.equal(extractTitle("<title> My &amp; Page </title>"), "My & Page");
});
test("search parser (FIXTURE): extracts title, real url from the uddg redirect, snippet; skips ads; detects a bot check", () => {
  const html = `<div class="result"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcreate.roblox.com%2Fdocs%2Freference%2Fengine%2Fclasses%2FWorkspace&amp;rut=abc">Workspace | Roblox <b>Docs</b></a></h2><a class="result__snippet" href="x">The &quot;Workspace&quot; service holds parts.</a></div>
    <div class="result"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a></div>
    <div class="result"><a class="result__a" href="https://devforum.roblox.com/t/1">Dev Forum</a><a class="result__snippet">forum text</a></div>`;
  const p = parseDdgHtml(html);
  assert.equal(p.results.length, 2);
  assert.deepEqual(p.results[0], { title: "Workspace | Roblox Docs", url: "https://create.roblox.com/docs/reference/engine/classes/Workspace", snippet: 'The "Workspace" service holds parts.' });
  assert.equal(p.results[1].url, "https://devforum.roblox.com/t/1");
  assert.equal(parseDdgHtml("<html>Our systems detected unusual traffic. captcha</html>").blocked, true);
});

// ---- real curl against a local server. The guard stays ON; only this one host:port is exempted ----
function serve(handler) { return new Promise((res) => { const s = http.createServer(handler).listen(0, "127.0.0.1", () => res(s)); }); }
async function withServer(handler, fn) {
  const s = await serve(handler); const port = s.address().port;
  WEB.allowHost = (h, p) => h === "127.0.0.1" && p === port;
  try { await fn(`http://127.0.0.1:${port}`); } finally { WEB.allowHost = null; s.close(); }
}
test("vm_web_fetch (real curl): HTML becomes text, title, and windowing says how to read the rest", async () => {
  currentTurn.messageId = "t-fetch-1";
  const body = "<html><head><title>Docs</title></head><body><h1>Raycast</h1><p>" + "word ".repeat(3000) + "</p></body></html>";
  await withServer((q, r) => { r.setHeader("content-type", "text/html; charset=utf-8"); r.end(body); }, async (base) => {
    const r = await vmWebFetch({ url: base + "/x", max_chars: 500 });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.result.status, 200); assert.equal(r.result.title, "Docs");
    assert.equal(r.result.text.length, 500); assert.equal(r.result.truncated, true); assert.match(r.result.marker, /offset=500/);
    const r2 = await vmWebFetch({ url: base + "/x", offset: r.result.next_offset, max_chars: 100000 });
    assert.equal(r2.result.truncated, false); assert.ok(r2.result.total_chars > 14000);
    assert.equal(r.result.untrusted, true);
  });
});
test("vm_web_fetch: HTTP errors, binary types and redirects are handled honestly", async () => {
  currentTurn.messageId = "t-fetch-2";
  await withServer((q, r) => {
    if (q.url === "/missing") { r.statusCode = 404; return r.end("no"); }
    if (q.url === "/img") { r.setHeader("content-type", "image/png"); return r.end(Buffer.from([137, 80, 78, 71])); }
    if (q.url === "/hop") { r.statusCode = 302; r.setHeader("location", "/final"); return r.end(); }
    if (q.url === "/final") { r.setHeader("content-type", "text/plain"); return r.end("arrived"); }
    if (q.url === "/loop") { r.statusCode = 302; r.setHeader("location", "/loop"); return r.end(); }
    r.end("x");
  }, async (base) => {
    assert.match((await vmWebFetch({ url: base + "/missing" })).error, /HTTP 404/);
    assert.match((await vmWebFetch({ url: base + "/img" })).error, /unsupported content type image\/png/);
    const h = await vmWebFetch({ url: base + "/hop" }); assert.equal(h.ok, true); assert.equal(h.result.text, "arrived"); assert.equal(h.result.redirects, 1);
    assert.match((await vmWebFetch({ url: base + "/loop" })).error, /too many redirects/);
  });
});
test("vm_web_fetch: a redirect INTO a private address is refused (SSRF), and so is a direct private URL", async () => {
  currentTurn.messageId = "t-fetch-3";
  await withServer((q, r) => { r.statusCode = 302; r.setHeader("location", q.url === "/meta" ? "http://169.254.169.254/latest/meta-data/" : "http://127.0.0.1:9/"); r.end(); }, async (base) => {
    assert.match((await vmWebFetch({ url: base + "/meta" })).error, /refused.*private or reserved/);
    assert.match((await vmWebFetch({ url: base + "/other" })).error, /refused/);
  });
  assert.match((await vmWebFetch({ url: "http://127.0.0.1:8080/" })).error, /refused/);          // guard is on again once the test exemption is gone
  assert.match((await vmWebFetch({ url: "file:///etc/passwd" })).error, /only http and https/);
});
test("web tools: per-request budget stops a loop, and a new user request gets a fresh budget", async () => {
  const old = { f: WEB.fetchPerTurn, s: WEB.searchPerTurn }; WEB.fetchPerTurn = 2; WEB.searchPerTurn = 1;
  try {
    currentTurn.messageId = "t-budget-1";
    await vmWebFetch({ url: "file:///a" }); await vmWebFetch({ url: "file:///a" });
    assert.match((await vmWebFetch({ url: "file:///a" })).error, /web budget used up/);
    currentTurn.messageId = "t-budget-2";
    assert.doesNotMatch((await vmWebFetch({ url: "file:///a" })).error, /budget/);
    assert.match((await vmWebSearch({ query: "x" })).error, /2-200/);                            // validation happens before the budget is spent
  } finally { WEB.fetchPerTurn = old.f; WEB.searchPerTurn = old.s; }
});

test("vm_run_luau (REAL luau runtime): runs code and returns the real output", { skip: noLuau }, async () => {
  const r = await vmRunLuau({ name: "t_ok", source: 'local t = {} for i = 1, 5 do t[#t+1] = i*i end print(table.concat(t, ","), string.format("%.3f", math.pi))' });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.result.exit_code, 0); assert.equal(r.result.stdout.trim(), "1,4,9,16,25\t3.142");
  assert.match(r.result.note, /NOT that the code works in Roblox/);
});
test("vm_run_luau: a failing assert is a real non-zero exit with the real error text", { skip: noLuau }, async () => {
  const r = await vmRunLuau({ name: "t_fail", source: "local function f(x) return x * 2 end\nassert(f(2) == 5, 'f(2) should be 5')" });
  assert.equal(r.ok, true); assert.notEqual(r.result.exit_code, 0); assert.match(r.result.stderr, /f\(2\) should be 5/); assert.match(r.result.note, /FAILED/);
});
test("vm_run_luau: Roblox globals fail honestly and the note explains why", { skip: noLuau }, async () => {
  const r = await vmRunLuau({ name: "t_rbx", source: 'local p = Instance.new("Part")\nprint(p)' });
  assert.equal(r.ok, true); assert.notEqual(r.result.exit_code, 0); assert.match(r.result.note, /NO Roblox engine/);
});
test("vm_run_luau: an infinite loop is killed at the timeout (the luau process itself, not just the shell)", { skip: noLuau }, async () => {
  const t0 = Date.now();
  const r = await vmRunLuau({ name: "t_loop", source: "while true do end", timeout_sec: 2 });
  assert.equal(r.ok, false); assert.match(r.error, /timed out/); assert.ok(Date.now() - t0 < 6000);
  assert.deepEqual(luauProcsRunning("t_loop.luau"), [], "no orphaned luau process");
});
test("vm_run_luau: empty and oversized sources are refused before anything runs", async () => {
  assert.match((await vmRunLuau({ source: "  " })).error, /empty/); assert.match((await vmRunLuau({ source: "x".repeat(100_001) })).error, /100 KB/);
});
test("the three tools are registered, in the VM family, and never count as edits to the game", async () => {
  const { isMutatingTool } = await import("../src/lifecycle.js");
  for (const n of ["vm_run_luau", "vm_web_fetch", "vm_web_search"]) { assert.ok(TOOLS[n], n); assert.equal(isMutatingTool(n), false, n); }
});
