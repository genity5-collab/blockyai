import { parseBlocks, parseInline, safeUrl, textLen } from "../src/lib/markdown.js";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const J = (x) => JSON.stringify(x);

// the shape in the user's screenshot: heading + inline code + a fenced lua block
const reply = "### 1. Server Script\nPut this in `ServerScriptService`:\n\n```lua\nlocal Players = game:GetService(\"Players\")\nprint(\"hi\")\n```\n\n#### 2. Client-Side Detection (LocalScript)\nCreate a `LocalScript` in `StarterPlayerScripts`.";
let b = parseBlocks(reply);
ok(b[0].t === "h" && b[0].n === 3 && b[0].c[0].v === "1. Server Script", "### heading parsed, hashes removed");
ok(b[1].t === "p" && b[1].c.some((x) => x.t === "code" && x.v === "ServerScriptService"), "inline code parsed");
const code = b.find((x) => x.t === "code");
ok(code && code.lang === "lua" && code.v === 'local Players = game:GetService("Players")\nprint("hi")' && !code.open, "fenced lua block keeps exact code, language, and is closed");
ok(b.filter((x) => x.t === "h").length === 2 && b.at(-1).t === "p", "second heading and trailing paragraph kept");
ok(!J(b).includes("###") && !J(b).includes("```"), "no raw markdown markers are left in the output");

// code is never altered: markdown characters inside a fence stay literal
b = parseBlocks("```\n# not a heading\n**not bold** `x` [a](http://b)\n- not a list\n```");
ok(b.length === 1 && b[0].t === "code" && b[0].v.includes("# not a heading") && b[0].v.includes("**not bold**"), "markdown inside a code fence is NOT interpreted");

// streaming: an unclosed fence shows as code so far, flagged open
b = parseBlocks("Here:\n```lua\nlocal x = 1\nlocal y =");
ok(b[1].t === "code" && b[1].open === true && b[1].v === "local x = 1\nlocal y =", "unclosed fence renders as open code, nothing lost");
ok(parseBlocks("```lua\n```")[0].v === "", "empty fence ok");
ok(parseBlocks("~~~\nabc\n~~~")[0].v === "abc", "tilde fence ok");
ok(parseBlocks("````\n```\ninner\n```\n````")[0].v === "```\ninner\n```", "longer outer fence can contain a shorter fence");

// lists, quotes, hr
b = parseBlocks("- one\n- two **b**\n\n1. a\n2. b\n\n> quoted\n\n---");
ok(b[0].t === "ul" && b[0].items.length === 2 && b[0].items[1].c.some((x) => x.t === "bold"), "bullet list with bold");
ok(b[1].t === "ol" && b[1].items.length === 2, "numbered list");
ok(b[2].t === "quote" && b[3].t === "hr", "quote and horizontal rule");
ok(parseBlocks("- a\n1. b").length === 2, "switching list kind starts a new list");

// inline
let i = parseInline("use **bold**, *italic*, `code`, and a_b_c and 2*3*4 safely");
ok(i.some((x) => x.t === "bold") && i.some((x) => x.t === "em") && i.some((x) => x.t === "code"), "bold italic code");
ok(!i.some((x) => x.t === "em" && x.c[0].v === "b") && J(i).includes("a_b_c") && J(i).includes("2*3*4"), "snake_case and 2*3*4 are not turned into italics");
ok(parseInline("a * b * c").every((x) => x.t === "text"), "spaced asterisks stay text");
ok(parseInline("unclosed **bold and `code").every((x) => x.t === "text"), "unclosed markers stay literal text");
i = parseInline("see [docs](https://create.roblox.com/docs) or https://x.io/a?b=1.");
ok(i.filter((x) => x.t === "link").length === 2 && i.find((x) => x.href === "https://x.io/a?b=1"), "markdown link and bare link; trailing period not part of the url");

// SAFETY: nothing can become a dangerous link or markup
for (const bad of ["javascript:alert(1)", "data:text/html;base64,AAAA", "vbscript:x", "//evil.com", "file:///etc/passwd", "ftp://x", "JaVaScRiPt:alert(1)", " javascript:alert(1)"]) ok(safeUrl(bad) === null, "refused url: " + bad);
ok(safeUrl("https://a.com/x") === "https://a.com/x" && safeUrl("http://a.com") === "http://a.com", "http and https allowed");
i = parseInline("[click](javascript:alert(1)) <img src=x onerror=alert(1)> <script>alert(1)</script>");
ok(!i.some((x) => x.t === "link") && J(i).includes("<script>") && i.every((x) => ["text"].includes(x.t)), "javascript link dropped to plain text; HTML tags stay inert TEXT (React escapes them)");
ok(parseInline("[x](https://a.com\"onmouseover=\"alert(1))").every((x) => x.t !== "link" || !/["<>]/.test(x.href)), "quotes cannot break out of an href");

// robustness
ok(parseBlocks("").length === 0 && parseBlocks(null).length === 0 && parseBlocks(undefined).length === 0, "empty / null / undefined");
ok(parseBlocks("a\r\nb\r\n```\r\nc\r\n```")[1].v === "c", "windows line endings");
const big = "x".repeat(200000) + "\n" + "- a\n".repeat(5000) + "```\n" + "y\n".repeat(5000);
const t0 = Date.now(); parseBlocks(big); ok(Date.now() - t0 < 1500, "large input parses fast (" + (Date.now() - t0) + "ms)");
ok(Date.now() - t0 < 1500 && (() => { const t = Date.now(); parseInline("*".repeat(20000) + "`".repeat(20000) + "[".repeat(20000)); return Date.now() - t < 1500; })(), "pathological inline input does not hang");
ok(textLen(parseBlocks(reply)) > 100, "textLen counts visible characters");
console.log(`markdown: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
