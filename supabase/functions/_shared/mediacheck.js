// Verifies an image that the agent uploads. The type is decided from the FILE'S OWN BYTES, never from the name or the claimed mime type.
// Only raster formats a browser can show safely are accepted. SVG is refused on purpose: it can carry scripts and external references.
export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_SIDE = 8192;                 // pixels, per side
export const MAX_PIXELS = 40_000_000;         // decompression-bomb guard

const u16be = (b, o) => (b[o] << 8) | b[o + 1];
const u32be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const u24le = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const eq = (b, o, s) => { for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false; return true; };

function pngInfo(b) {
  if (b.length < 33 || !(b[0] === 0x89 && eq(b, 1, "PNG") && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a)) return null;
  if (!eq(b, 12, "IHDR")) return null;
  return { mime: "image/png", ext: "png", width: u32be(b, 16), height: u32be(b, 20) };
}
function gifInfo(b) {
  if (b.length < 10 || !(eq(b, 0, "GIF87a") || eq(b, 0, "GIF89a"))) return null;
  return { mime: "image/gif", ext: "gif", width: u16le(b, 6), height: u16le(b, 8) };
}
function jpegInfo(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    let m = b[i + 1]; if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
    const len = u16be(b, i + 2); if (len < 2) return null;
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: "image/jpeg", ext: "jpg", height: u16be(b, i + 5), width: u16be(b, i + 7) };
    i += 2 + len;
  }
  return null;
}
function webpInfo(b) {
  if (b.length < 30 || !eq(b, 0, "RIFF") || !eq(b, 8, "WEBP")) return null;
  const t = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (t === "VP8X") return { mime: "image/webp", ext: "webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (t === "VP8L") { if (b[20] !== 0x2f) return null; const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { mime: "image/webp", ext: "webp", width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
  if (t === "VP8 ") { if (!(b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)) return null; return { mime: "image/webp", ext: "webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }; }
  return null;
}

// -> { ok:true, mime, ext, width, height, size } or { ok:false, error }
export function checkImage(bytes) {
  if (!(bytes instanceof Uint8Array)) return { ok: false, error: "no file data" };
  if (bytes.length === 0) return { ok: false, error: "the file is empty" };
  if (bytes.length > MAX_BYTES) return { ok: false, error: `the file is too large (${bytes.length} bytes, max ${MAX_BYTES})` };
  const info = pngInfo(bytes) || jpegInfo(bytes) || gifInfo(bytes) || webpInfo(bytes);
  if (!info) {
    const head = new TextDecoder().decode(bytes.slice(0, 200)).toLowerCase();
    if (head.includes("<svg") || head.includes("<?xml")) return { ok: false, error: "SVG is not accepted (it can carry scripts). Convert it to PNG first." };
    if (head.includes("<html") || head.includes("<!doctype")) return { ok: false, error: "that is a web page, not an image" };
    return { ok: false, error: "not a PNG, JPEG, GIF or WebP image" };
  }
  const { width, height } = info;
  if (!(width > 0 && height > 0)) return { ok: false, error: "the image has no size" };
  if (width > MAX_SIDE || height > MAX_SIDE) return { ok: false, error: `the image is too big (${width}x${height}, max ${MAX_SIDE} per side)` };
  if (width * height > MAX_PIXELS) return { ok: false, error: `the image has too many pixels (${width * height}, max ${MAX_PIXELS})` };
  return { ok: true, ...info, size: bytes.length };
}

// Decodes base64 strictly (no data: prefix, no whitespace games) with a size cap applied BEFORE decoding.
export function decodeBase64(s) {
  if (typeof s !== "string") return { ok: false, error: "data must be a base64 string" };
  const clean = s.replace(/\s+/g, "");
  if (clean.length > Math.ceil(MAX_BYTES * 4 / 3) + 8) return { ok: false, error: "the file is too large" };
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) return { ok: false, error: "data is not valid base64 (send the raw base64, without a data: prefix)" };
  try { const bin = atob(clean); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return { ok: true, bytes: out }; }
  catch { return { ok: false, error: "data is not valid base64" }; }
}

// Names are only ever shown as text and used in a storage path built from a UUID, but they are cleaned anyway.
export const cleanName = (n) => String(n ?? "image").replace(/[\u0000-\u001f\u007f<>"'`\\/:*?|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "image";
