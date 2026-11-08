import { checkImage, decodeBase64, cleanName, MAX_BYTES } from "../functions/_shared/mediacheck.js";
import fs from "node:fs";
const F = JSON.parse(fs.readFileSync(new URL("./media-fixtures.json", import.meta.url), "utf8"));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const get = (k) => { const d = decodeBase64(F[k]); if (!d.ok) throw new Error(k + ": " + d.error); return d.bytes; };

// real images: type + size decided from the bytes (dimensions are 37x21 for all of them, made by Pillow)
for (const [k, mime] of [["png", "image/png"], ["png_rgba", "image/png"], ["jpeg", "image/jpeg"], ["jpeg_progressive", "image/jpeg"], ["gif", "image/gif"], ["webp_lossy", "image/webp"], ["webp_lossless", "image/webp"]]) {
  const r = checkImage(get(k)); ok(r.ok && r.mime === mime, `${k} is detected as ${mime}`); ok(r.ok && r.width === 37 && r.height === 21, `${k} reports 37x21 (got ${r.width}x${r.height})`);
}
ok(checkImage(get("png_with_trailing_html")).ok, "a valid PNG with junk after it is still just a PNG (the browser ignores the junk)");

// hostile / wrong files are refused with a clear reason
const bad = { png_huge_dims: /too big/, png_bomb_pixels: /too many pixels/, png_zero: /no size/, svg_script: /SVG/, svg_xml: /SVG/, html_as_png: /web page/, text: /not a PNG/, truncated_png: /not a PNG/, truncated_jpeg: /not a PNG/, one_byte: /not a PNG/, exe: /not a PNG/ };
for (const [k, re] of Object.entries(bad)) { const r = checkImage(get(k)); ok(!r.ok && re.test(r.error), `${k} is refused (${r.error})`); }
ok(!checkImage(new Uint8Array(0)).ok && /empty/.test(checkImage(new Uint8Array(0)).error), "empty file refused");
ok(!checkImage(null).ok && !checkImage("abc").ok && !checkImage([1, 2, 3]).ok, "non-byte input refused");
const pngBytes = get("png"); const over = new Uint8Array(MAX_BYTES + 1); over.set(pngBytes);
ok(!checkImage(over).ok && /too large/.test(checkImage(over).error), "file over the size cap refused (valid PNG header, too many bytes)");
const exact = new Uint8Array(MAX_BYTES); exact.set(pngBytes); ok(checkImage(exact).ok, "a file exactly at the cap is accepted");
ok(!decodeBase64(F.big).ok && /too large/.test(decodeBase64(F.big).error), "an oversized upload is refused before it is even decoded");
ok(MAX_BYTES === 4 * 1024 * 1024, "cap is 4 MB");

// base64 handling
ok(decodeBase64(F.png).ok, "valid base64 decodes");
ok(!decodeBase64("data:image/png;base64," + F.png).ok, "a data: prefix is refused with a helpful message");
ok(!decodeBase64("not base64 !!!").ok && !decodeBase64("A").ok && !decodeBase64(5).ok && !decodeBase64(null).ok, "garbage base64 refused");
ok(decodeBase64(F.png.slice(0, 40) + "\n" + F.png.slice(40)).ok, "line breaks inside base64 are tolerated");
ok(!decodeBase64("A".repeat(Math.ceil(MAX_BYTES * 4 / 3) + 100)).ok, "oversized base64 is refused BEFORE decoding");

// names
ok(cleanName('a/b\\c<script>"x".png') === "abcscriptx.png", "path and html characters removed: " + cleanName('a/b\\c<script>"x".png'));
ok(cleanName("") === "image" && cleanName(null) === "image" && cleanName("   ") === "image", "empty name gets a default");
ok(cleanName("x".repeat(500)).length === 60, "name capped at 60");
ok(!/[\u0000-\u001f]/.test(cleanName("a\u0000b\nc")), "control characters removed");
console.log(`mediacheck: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
