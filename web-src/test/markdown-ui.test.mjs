// Renders the real <Markdown/> component and asserts on the HTML it produces. Run from web-src.
import { createServer } from "vite"; import React from "react"; import { renderToStaticMarkup as r } from "react-dom/server";
const root = process.cwd();
const vite = await createServer({ root, server: { middlewareMode: true, fs: { strict: false, allow: [root] } }, appType: "custom", logLevel: "error", ssr: { external: ["react", "react-dom", "lucide-react"] } });
const M = (await vite.ssrLoadModule("/src/components/Markdown.jsx")).default;
let pass = 0, fail = 0; const t = (n, c, d) => { if (c) pass++; else { fail++; console.log("FAIL:", n, d ?? ""); } };
const h = (text, shown) => r(React.createElement(M, { text, shown }));

const reply = "### 1. Server Script\nPut this in `ServerScriptService`:\n\n```lua\nlocal Players = game:GetService(\"Players\")\nif a < b and c > d then print('x & y') end\n```\n\n#### 2. Client-Side Detection (LocalScript)\nCreate a `LocalScript` in `StarterPlayerScripts`. **Important:** do not skip.\n\n- first\n- second";
let o = h(reply);
t("no raw ### / #### / ``` left on screen", !/###|```/.test(o.replace(/<[^>]+>/g, "")), o.replace(/<[^>]+>/g, "").slice(0, 120));
t("headings are real heading elements", /<h5[^>]*class="md-h md-h3"/.test(o) && /<h6[^>]*class="md-h md-h4"/.test(o));
t("inline code is a <code class=md-ic>", /<code class="md-ic mono">ServerScriptService<\/code>/.test(o));
t("fenced code is a code block with a Copy button", /class="md-code emb-code"/.test(o) && /aria-label="Copy code"/.test(o) && />Copy<\/span>/.test(o));
t("code block shows the language", /<span class="mono">lua<\/span>/.test(o));
t("code characters < > & ' \" are escaped, so the code is shown exactly and cannot become markup", o.includes("a &lt; b and c &gt; d") && o.includes("x &amp; y") && !/<b and c/.test(o));
t("code text is intact inside <pre><code>", /<pre class="mono"[^>]*><code>local Players = game:GetService\(&quot;Players&quot;\)/.test(o));
t("bold and lists render", /<strong>Important:<\/strong>/.test(o) && /<ul class="md-l"><li>first<\/li><li>second<\/li><\/ul>/.test(o));

// the copy button must copy the EXACT code (not the rendered/escaped version): the component passes the raw string
t("copy handler receives the raw code (checked via the component source)", (await import("node:fs")).readFileSync("src/components/Markdown.jsx", "utf8").includes("await copyText(v)"));

// hostile input becomes inert text, never markup or a dangerous link
o = h("[x](javascript:alert(1)) <script>alert(1)</script> <img src=x onerror=alert(1)> [y](https://ok.com)");
t("no <script> or <img> element is produced", !/<script|<img/i.test(o), o);
t("tags are shown as escaped text", o.includes("&lt;script&gt;") && o.includes("&lt;img"));
t("javascript: link is not a link", !/href="javascript/i.test(o) && !/javascript:alert/.test(o.match(/href="[^"]*"/g)?.join("") ?? ""));
t("https link is a safe external link", /<a class="md-a" href="https:\/\/ok\.com" target="_blank" rel="noopener noreferrer nofollow">y<\/a>/.test(o));
t("no tag carries an event-handler attribute (checked on real tags, not on escaped text)", !(o.match(/<[^>]+>/g) || []).some((tg) => / on[a-z]+=/i.test(tg)));
t("no dangerouslySetInnerHTML-style raw injection in the source", !/dangerouslySetInnerHTML/.test((await import("node:fs")).readFileSync("src/components/Markdown.jsx", "utf8").replace(/\/\/.*$/gm, "")));

// typing effect: limited reveal never shows half a marker, and shows the open code block with a caret
o = h("Hi **there** friend", 5);
t("partial reveal: exact text, no stray ** marker", o === '<div class="md"><p class="md-p">Hi <strong>th</strong></p></div>', o);
t("partial reveal never leaves an EMPTY bold/italic/link", !/<(strong|em|a)[^>]*><\/(strong|em|a)>/.test(h("Hi **there** friend", 3)) && h("Hi **there** friend", 3) === '<div class="md"><p class="md-p">Hi </p></div>', h("Hi **there** friend", 3));
t("partial reveal across blocks keeps order", h("# T\n\nabc def", 4).replace(/<[^>]+>/g, "") === "Tabc", h("# T\n\nabc def", 4));
t("partial reveal of a code block is an (open) code block, not raw backticks", !/```/.test(o) && /class="md-code/.test(h("```lua\nprint(1)\nprint(2)", 12)) && /class="caret"/.test(h("```lua\nprint(1)\nprint(2)", 12)));
t("shown=0 renders nothing, full render has everything", h("abc", 0).replace(/<[^>]+>/g, "") === "" && h("abc").includes("abc"));
t("an empty message does not crash", h("") === '<div class="md"></div>' && h(null).includes("md"));
console.log(`markdown ui: ${pass} passed, ${fail} failed`); await vite.close(); process.exit(fail ? 1 : 0);
