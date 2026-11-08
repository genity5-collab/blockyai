// Embeds are DATA the website renders as text/images. Only these shapes are accepted; every string is length-capped.
// `ownedMedia` is the set of media ids that belong to THIS session. An image embed pointing anywhere else is dropped.
const KINDS = new Set(["info", "tip", "warning", "success", "steps", "code", "table", "checklist", "image", "gallery", "link"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const str = (v, n) => String(v ?? "").slice(0, n);
export const isMediaId = (v) => typeof v === "string" && UUID.test(v);

// Only plain web links. Never javascript:, data:, file:, or anything with credentials or odd characters.
export function safeHttpUrl(v) {
  const s = String(v ?? "").trim(); if (s.length > 800 || /[\s<>"'`\\]/.test(s)) return null;
  let u; try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  return u.href;
}

export function cleanEmbeds(raw, ownedMedia = new Set()) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const e of raw.slice(0, 6)) {
    if (!e || typeof e !== "object" || !KINDS.has(e.type)) continue;
    const x = e, base = { type: x.type, title: str(x.title, 80) };
    if (x.type === "code") { base.language = str(x.language || "lua", 16); base.code = str(x.code, 6000); }
    else if (x.type === "table") { base.columns = (Array.isArray(x.columns) ? x.columns : []).slice(0, 6).map((c) => str(c, 40)); base.rows = (Array.isArray(x.rows) ? x.rows : []).slice(0, 30).map((r) => (Array.isArray(r) ? r : []).slice(0, 6).map((c) => str(c, 120))); }
    else if (x.type === "steps" || x.type === "checklist") { base.items = (Array.isArray(x.items) ? x.items : []).slice(0, 12).map((i) => str(i, 200)); }
    else if (x.type === "image") {
      if (!isMediaId(x.media_id) || !ownedMedia.has(String(x.media_id).toLowerCase())) continue;          // unknown or someone else's picture: dropped
      base.media_id = String(x.media_id).toLowerCase(); base.alt = str(x.alt || x.title, 200); base.caption = str(x.caption, 300);
      const src = safeHttpUrl(x.source_url); if (src) base.source_url = src;
    }
    else if (x.type === "gallery") {
      const items = (Array.isArray(x.items) ? x.items : []).slice(0, 8).filter((i) => i && isMediaId(i.media_id) && ownedMedia.has(String(i.media_id).toLowerCase()))
        .map((i) => ({ media_id: String(i.media_id).toLowerCase(), alt: str(i.alt || i.caption, 200), caption: str(i.caption, 200) }));
      if (!items.length) continue; base.items = items;
    }
    else if (x.type === "link") {
      const url = safeHttpUrl(x.url); if (!url) continue;                                                     // a link card needs a safe url
      base.url = url; base.body = str(x.body, 300); base.kind = ["video", "page", "doc", "download"].includes(x.kind) ? x.kind : "page";
      if (isMediaId(x.thumb_media_id) && ownedMedia.has(String(x.thumb_media_id).toLowerCase())) base.thumb_media_id = String(x.thumb_media_id).toLowerCase();
    }
    else { base.body = str(x.body, 800); }
    out.push(base);
  }
  return out.length ? out : null;
}

// Every media id mentioned in a raw embeds list (so the caller can ask the database which of them belong to the session).
export function mediaIdsIn(raw) {
  const ids = new Set(); if (!Array.isArray(raw)) return [];
  for (const e of raw.slice(0, 6)) {
    if (!e || typeof e !== "object") continue;
    if (isMediaId(e.media_id)) ids.add(e.media_id.toLowerCase());
    if (isMediaId(e.thumb_media_id)) ids.add(e.thumb_media_id.toLowerCase());
    if (Array.isArray(e.items)) for (const i of e.items.slice(0, 8)) if (i && isMediaId(i.media_id)) ids.add(i.media_id.toLowerCase());
  }
  return [...ids];
}
