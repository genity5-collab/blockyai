import React, { useState } from "react";
import { Info, Lightbulb, TriangleAlert, CircleCheck, ListOrdered, ListChecks, Copy, Check, Code2, Table2, Image as ImageIcon, Images, Link2 } from "lucide-react";
import { ImageEmbed, GalleryEmbed, LinkCard, Lightbox } from "./MediaEmbeds.jsx";

// Renders AI "embeds". All values are plain strings shown as TEXT (React escapes them). Nothing is ever executed or injected as HTML.
const META = {
  info: { icon: Info, color: "var(--blue)" }, tip: { icon: Lightbulb, color: "var(--violet)" },
  warning: { icon: TriangleAlert, color: "var(--amber)" }, success: { icon: CircleCheck, color: "var(--green)" },
  steps: { icon: ListOrdered, color: "var(--blue)" }, checklist: { icon: ListChecks, color: "var(--green)" },
  code: { icon: Code2, color: "var(--blue)" }, table: { icon: Table2, color: "var(--violet)" },
  image: { icon: ImageIcon, color: "var(--blue)" }, gallery: { icon: Images, color: "var(--blue)" }, link: { icon: Link2, color: "var(--blue)" },
};

function CodeEmbed({ e }) {
  const [ok, setOk] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(e.code); setOk(true); setTimeout(() => setOk(false), 1600); } catch { /* clipboard blocked */ } };
  return (<div className="emb-code"><div className="emb-code-h"><span className="mono">{e.language || "lua"}</span>
    <button className="iconbtn sm" onClick={copy} aria-label="Copy code">{ok ? <Check size={14} /> : <Copy size={14} />}</button></div>
    <pre className="mono"><code>{e.code}</code></pre></div>);
}

export default function Embeds({ list }) {
  const [pic, setPic] = useState(null);
  if (!Array.isArray(list) || !list.length) return null;
  return (<div className="embeds"><Lightbox pic={pic} onClose={() => setPic(null)} />{list.map((e, i) => {
    if (!e || typeof e !== "object") return null;       // never let one bad entry blank the whole chat
    // Pictures and link cards are shown bare (no titled box) so they read as part of the reply.
    if (e.type === "image") return <ImageEmbed key={i} e={e} onOpen={setPic} />;
    if (e.type === "gallery") return <GalleryEmbed key={i} e={e} onOpen={setPic} />;
    if (e.type === "link") return <LinkCard key={i} e={e} />;
    const m = META[e.type] || META.info; const Ic = m.icon;
    return (<div key={i} className={"embed e-" + e.type} style={{ "--ec": m.color }}>
      <div className="emb-h"><Ic size={16} /><b>{e.title || e.type}</b></div>
      {e.type === "code" && <CodeEmbed e={e} />}
      {e.type === "steps" && <ol className="emb-steps">{(e.items || []).map((t, k) => <li key={k}><span className="n">{k + 1}</span><span>{t}</span></li>)}</ol>}
      {e.type === "checklist" && <ul className="emb-list">{(e.items || []).map((t, k) => <li key={k}><Check size={14} /><span>{t}</span></li>)}</ul>}
      {e.type === "table" && <div className="emb-tw"><table><thead><tr>{(e.columns || []).map((c, k) => <th key={k}>{c}</th>)}</tr></thead>
        <tbody>{(e.rows || []).map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>}
      {["info", "tip", "warning", "success"].includes(e.type) && <p className="emb-body">{e.body}</p>}
    </div>);
  })}</div>);
}
