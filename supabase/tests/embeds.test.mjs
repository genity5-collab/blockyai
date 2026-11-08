import { cleanEmbeds, mediaIdsIn, safeHttpUrl, isMediaId } from "../functions/_shared/embeds.js";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-9222-222222222222", EVIL = "99999999-9999-4999-9999-999999999999";
const own = new Set([A, B]);

// existing kinds behave exactly as before
let r = cleanEmbeds([{ type: "tip", title: "T", body: "b" }, { type: "code", code: "print(1)" }, { type: "steps", items: ["a", "b"] }, { type: "table", columns: ["x"], rows: [["1"]] }, { type: "checklist", items: ["z"] }]);
ok(r.length === 5 && r[0].body === "b" && r[1].language === "lua" && r[2].items.length === 2 && r[3].rows[0][0] === "1", "all 8 original embed kinds still work");
ok(cleanEmbeds("nope") === null && cleanEmbeds(null) === null && cleanEmbeds([]) === null && cleanEmbeds([{ type: "bogus" }]) === null, "junk input gives null");

// image embeds
r = cleanEmbeds([{ type: "image", media_id: A, title: "Cat", alt: "a cat", caption: "c", source_url: "https://example.com/cat.png" }], own);
ok(r?.[0].type === "image" && r[0].media_id === A && r[0].alt === "a cat" && r[0].source_url === "https://example.com/cat.png", "an owned image embed is kept");
ok(cleanEmbeds([{ type: "image", media_id: EVIL, alt: "x" }], own) === null, "an image that is NOT in this session is dropped (cannot show someone else's picture)");
ok(cleanEmbeds([{ type: "image", media_id: A }], new Set()) === null, "with no owned media, every image is dropped");
ok(cleanEmbeds([{ type: "image", media_id: "../../etc/passwd" }, { type: "image", media_id: "not-a-uuid" }, { type: "image" }, { type: "image", media_id: 5 }], own) === null, "non-uuid media ids are dropped");
ok(cleanEmbeds([{ type: "image", media_id: A.toUpperCase() }], own)?.[0].media_id === A, "uppercase id is normalised and still matches");
ok(cleanEmbeds([{ type: "image", media_id: A, source_url: "javascript:alert(1)" }], own)[0].source_url === undefined, "a javascript: source url is removed, the image stays");
ok(cleanEmbeds([{ type: "image", media_id: A, alt: "x".repeat(900), caption: "y".repeat(900) }], own)[0].alt.length === 200, "alt and caption are length-capped");
ok(!("html" in cleanEmbeds([{ type: "image", media_id: A, html: "<script>" , onerror: "x"}], own)[0]) && !("onerror" in cleanEmbeds([{ type: "image", media_id: A, onerror: "x" }], own)[0]), "unknown fields are not copied through");

// gallery
r = cleanEmbeds([{ type: "gallery", items: [{ media_id: A, alt: "1" }, { media_id: EVIL, alt: "2" }, { media_id: B, caption: "3" }, null, { media_id: "x" }] }], own);
ok(r?.[0].items.length === 2 && r[0].items[1].media_id === B, "gallery keeps only owned pictures");
ok(cleanEmbeds([{ type: "gallery", items: [{ media_id: EVIL }] }], own) === null, "a gallery with no owned pictures is dropped");
ok(cleanEmbeds([{ type: "gallery", items: Array.from({ length: 30 }, () => ({ media_id: A })) }], own)[0].items.length === 8, "gallery capped at 8");

// link cards (this is how videos are shown: a card that opens in a new tab, never an embedded player)
r = cleanEmbeds([{ type: "link", kind: "video", title: "Obby tutorial", url: "https://www.youtube.com/watch?v=abc", body: "10 min", thumb_media_id: A }], own);
ok(r?.[0].url === "https://www.youtube.com/watch?v=abc" && r[0].kind === "video" && r[0].thumb_media_id === A, "a video link card with a thumbnail");
ok(cleanEmbeds([{ type: "link", url: "javascript:alert(1)" }, { type: "link", url: "data:text/html,<script>" }, { type: "link", url: "file:///etc/passwd" }, { type: "link", url: "//evil.com" }, { type: "link", url: "ftp://x.com" }, { type: "link" }], own) === null, "unsafe link cards are dropped");
ok(cleanEmbeds([{ type: "link", url: "https://a.com", thumb_media_id: EVIL }], own)[0].thumb_media_id === undefined, "a thumbnail from another session is removed, the link stays");
ok(cleanEmbeds([{ type: "link", url: "https://a.com", kind: "<b>" }], own)[0].kind === "page", "unknown link kind falls back to page");

// url safety
for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:image/svg+xml,<svg>", "vbscript:x", "file:///x", "ftp://a.com", "//a.com", "https://user:pw@a.com", 'https://a.com/"onmouseover="x', "https://a.com/<script>", "https://a.com/a b", "", null, undefined, 5, "https://" + "a".repeat(900) + ".com"]) ok(safeHttpUrl(bad) === null, "refused: " + String(bad).slice(0, 40));
ok(safeHttpUrl("https://create.roblox.com/docs?x=1#y") === "https://create.roblox.com/docs?x=1#y" && safeHttpUrl("http://a.com") === "http://a.com/", "normal links pass");
ok(isMediaId(A) && !isMediaId("abc") && !isMediaId(null) && !isMediaId(A + "x"), "isMediaId");

// mediaIdsIn finds every id so the server can verify ownership in one query
const ids = mediaIdsIn([{ type: "image", media_id: A }, { type: "gallery", items: [{ media_id: B }, { media_id: "bad" }] }, { type: "link", thumb_media_id: EVIL.toUpperCase() }, null, "x"]);
ok(ids.length === 3 && ids.includes(A) && ids.includes(B) && ids.includes(EVIL), "mediaIdsIn collects image, gallery and thumb ids (lower-cased, deduped)");
ok(mediaIdsIn(null).length === 0 && mediaIdsIn("x").length === 0, "mediaIdsIn tolerates junk");
ok(cleanEmbeds(Array.from({ length: 20 }, () => ({ type: "tip", body: "x" }))).length === 6, "at most 6 embeds per message");
console.log(`embeds: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
