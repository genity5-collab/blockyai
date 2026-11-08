import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { ImageOff, ExternalLink, PlayCircle, FileText, Download, Globe, X, Loader2 } from "lucide-react";
import { web } from "../lib/api.js";
import { mediaUrl, forgetMedia } from "../lib/mediaCache.js";
import { useApp } from "../lib/store.jsx";

// Pictures the AI showed. They are loaded from OUR storage through a short-lived signed link (the page's security policy allows only our own
// hosts), never from the open web. Everything the AI wrote (alt, caption, title) is shown as text.
export function useMedia(id) {
  const { sid } = useApp(); const [st, setSt] = useState({ status: "loading" });
  const load = useCallback((retry) => {
    let dead = false; setSt({ status: "loading" });
    mediaUrl(web, sid, id).then((r) => { if (!dead) setSt({ status: "ok", ...r }); }, (e) => { if (!dead) setSt({ status: "error", error: String(e.message || e) }); });
    return () => { dead = true; };
  }, [sid, id]);
  useEffect(() => load(), [load]);
  const retry = () => { forgetMedia(sid, id); load(); };
  return [st, retry];
}

function Frame({ st, w, h, children }) {
  // Reserve the picture's real shape while it loads so the chat does not jump.
  const ratio = w && h ? `${w} / ${h}` : "16 / 9";
  return <div className="mimg-frame" style={{ aspectRatio: ratio, maxHeight: 360 }}>{children}</div>;
}

export function MediaImage({ id, alt, onOpen, compact }) {
  const [st, retry] = useMedia(id); const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [st.url]);
  if (st.status === "loading") return <Frame w={0} h={0}><div className="mimg-ph"><Loader2 size={20} className="spin" /></div></Frame>;
  if (st.status === "error" || bad) return <Frame><div className="mimg-ph err"><ImageOff size={20} /><span>Picture unavailable</span><button type="button" className="md-copy" onClick={(e) => { e.stopPropagation(); setBad(false); retry(); }}>Retry</button></div></Frame>;
  const img = <img src={st.url} alt={alt || ""} width={st.width} height={st.height} loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setBad(true)} />;
  // Inside a link card the whole card is the link, so the picture is plain (a button inside a link is invalid and breaks taps on phones).
  if (!onOpen) return <span className={"mimg-btn plain" + (compact ? " compact" : "")}>{img}</span>;
  return <button type="button" className={"mimg-btn" + (compact ? " compact" : "")} onClick={() => onOpen({ url: st.url, alt })} aria-label={"Enlarge picture: " + (alt || "image")}>{img}</button>;
}

export function Lightbox({ pic, onClose }) {
  useEffect(() => { if (!pic) return; const k = (e) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); const o = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { removeEventListener("keydown", k); document.body.style.overflow = o; }; }, [pic]);
  if (!pic) return null;
  // Rendered at the page root (a portal). Inside the chat it would be trapped in the chat's own layer and the bottom tab bar would sit on top of it.
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Picture" onClick={onClose}>
      <button type="button" className="lightbox-x" onClick={onClose} aria-label="Close"><X size={20} /></button>
      <img src={pic.url} alt={pic.alt || ""} referrerPolicy="no-referrer" onClick={(e) => e.stopPropagation()} />
      {pic.alt ? <div className="lightbox-cap" onClick={(e) => e.stopPropagation()}>{pic.alt}</div> : null}
    </div>,
    document.body
  );
}

const KIND = { video: [PlayCircle, "Video"], doc: [FileText, "Docs"], download: [Download, "Download"], page: [Globe, "Page"] };
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }

export function LinkCard({ e }) {
  if (!e.url) return null;
  const [Ic, label] = KIND[e.kind] || KIND.page;
  return (
    <a className={"mlink" + (e.thumb_media_id ? " has-thumb" : "")} href={e.url} target="_blank" rel="noopener noreferrer nofollow">
      {e.thumb_media_id ? <div className="mlink-th"><MediaImage id={e.thumb_media_id} alt={e.title} compact onOpen={null} /><span className="mlink-play"><Ic size={22} /></span></div> : <div className="mlink-ic"><Ic size={22} /></div>}
      <div className="mlink-tx"><div className="mlink-k">{label} <span>{hostOf(e.url)}</span></div><b>{e.title || hostOf(e.url) || e.url}</b>{e.body ? <p>{e.body}</p> : null}</div>
      <ExternalLink size={16} className="mlink-go" aria-hidden="true" />
    </a>
  );
}

export function ImageEmbed({ e, onOpen }) {
  if (!e.media_id) return null;
  return (
    <figure className="mfig">
      <MediaImage id={e.media_id} alt={e.alt || e.title} onOpen={onOpen} />
      {(e.caption || e.title) ? <figcaption>{e.caption || e.title}{e.source_url ? <> <a href={e.source_url} target="_blank" rel="noopener noreferrer nofollow">source</a></> : null}</figcaption> : null}
    </figure>
  );
}

export function GalleryEmbed({ e, onOpen }) {
  return (
    <div className="mgal" data-n={Array.isArray(e.items) ? e.items.length : 0}>
      {(Array.isArray(e.items) ? e.items : []).filter((it) => it && it.media_id).map((it) => <figure key={it.media_id} className="mfig"><MediaImage id={it.media_id} alt={it.alt || it.caption} onOpen={onOpen} compact />{it.caption ? <figcaption>{it.caption}</figcaption> : null}</figure>)}
    </div>
  );
}
