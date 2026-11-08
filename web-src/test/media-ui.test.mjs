import { createServer } from "vite"; import React from "react"; import { renderToStaticMarkup as r } from "react-dom/server";
const root = process.cwd();
const vite = await createServer({ root, server: { middlewareMode: true, fs: { strict: false, allow: [root] } }, appType: "custom", logLevel: "error", ssr: { external: ["react", "react-dom", "lucide-react"] },
  resolve: { alias: [{ find: /^.*\/lib\/store\.jsx$/, replacement: new URL("./stub-store.jsx", import.meta.url).pathname }] } });
const E = (await vite.ssrLoadModule("/src/components/Embeds.jsx")).default;
const MC = await vite.ssrLoadModule("/src/lib/mediaCache.js");
let pass = 0, fail = 0; const t = (n, c, d) => { if (c) pass++; else { fail++; console.log("FAIL:", n, d ?? ""); } };
globalThis.__APP__ = { sid: "s1" };
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-9222-222222222222";
const h = (list) => r(React.createElement(E, { list }));

// every original embed kind still renders
let o = h([{ type: "tip", title: "T", body: "hello" }, { type: "code", language: "lua", code: "print(1)" }, { type: "steps", title: "S", items: ["a"] }]);
t("original embeds still render", o.includes("hello") && o.includes("print(1)") && o.includes("emb-code"));

// image: shows a sized loading frame (no layout jump), no broken <img> before the link arrives
o = h([{ type: "image", media_id: A, alt: "a cat", caption: "Cute" }]);
t("an image embed renders a figure with a loading frame", o.includes('class="mfig"') && o.includes("mimg-frame") && o.includes("Cute"));
t("no <img> until the signed link is loaded (nothing points at a wrong host)", !/<img/.test(o));
t("the image embed has no titled box around it", !o.includes("emb-h"));

// gallery
o = h([{ type: "gallery", items: [{ media_id: A, caption: "one" }, { media_id: B, caption: "two" }] }]);
t("gallery renders both frames and captions", (o.match(/mfig/g) || []).length === 2 && o.includes("one") && o.includes("two") && o.includes('data-n="2"'));

// link card
o = h([{ type: "link", kind: "video", title: "Obby <b>tutorial</b>", url: "https://www.youtube.com/watch?v=abc", body: "10 min" }]);
t("link card is an <a> opening in a new tab with safe rel", /<a class="mlink"[^>]*href="https:\/\/www\.youtube\.com\/watch\?v=abc"[^>]*target="_blank"[^>]*rel="noopener noreferrer nofollow"/.test(o), o.slice(0, 300));
t("link card shows the host and the kind label", o.includes("youtube.com") && o.includes("Video"));
t("the title is escaped TEXT, not markup", o.includes("Obby &lt;b&gt;tutorial&lt;/b&gt;") && !o.includes("<b>tutorial"));
t("a link card with a thumbnail has NO button inside the link (invalid HTML, breaks taps)", (() => { const x = h([{ type: "link", url: "https://a.com", title: "x", thumb_media_id: A }]); const a = x.match(/<a [\s\S]*<\/a>/)[0]; return !/<button/.test(a); })());
t("plain link card without thumbnail", !h([{ type: "link", url: "https://a.com/x" }]).includes("mlink-th"));

// hostile text in captions / alt is escaped
o = h([{ type: "image", media_id: A, alt: '"><script>alert(1)</script>', caption: "<img src=x onerror=alert(1)>" }]);
t("caption and alt are escaped, nothing becomes markup", !/<script|<img src=x/.test(o) && o.includes("&lt;img src=x"));
t("source link in a caption is a safe external link", /rel="noopener noreferrer nofollow"/.test(h([{ type: "image", media_id: A, caption: "c", source_url: "https://example.com/p" }])));
t("embeds that are junk do not crash", h([null, "x", { type: "nope" }, {}]) !== undefined && h(undefined) === "" && h([]) === "");

// cache: one network call per picture, even when asked many times at once
let calls = 0; const fakeWeb = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return { url: "https://x/y.png", width: 1, height: 1 }; };
MC._clear(); const rs = await Promise.all([1, 2, 3, 4, 5].map(() => MC.mediaUrl(fakeWeb, "s1", A))); await MC.mediaUrl(fakeWeb, "s1", A);
t("five simultaneous + one later request for the same picture cause ONE server call", calls === 1 && rs.every((x) => x.url === "https://x/y.png"), "calls=" + calls);
await MC.mediaUrl(fakeWeb, "s1", B); await MC.mediaUrl(fakeWeb, "s2", A); t("different picture or different session asks again", calls === 3, "calls=" + calls);
MC.forgetMedia("s1", A); await MC.mediaUrl(fakeWeb, "s1", A); t("forgetting a link (retry) asks again", calls === 4);
let failedOnce = 0; const flaky = async () => { failedOnce++; return failedOnce === 1 ? { error: "not found" } : { url: "https://x/z.png" }; };
MC._clear(); let err = null; try { await MC.mediaUrl(flaky, "s1", A); } catch (e) { err = e; } const again = await MC.mediaUrl(flaky, "s1", A);
t("a failed lookup is NOT cached; the next try can succeed", err && /not found/.test(err.message) && again.url === "https://x/z.png");
console.log(`media ui: ${pass} passed, ${fail} failed`); await vite.close(); process.exit(fail ? 1 : 0);
