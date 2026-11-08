import React, { useState, useRef, useEffect } from "react";
import { Copy, Check } from "lucide-react";
import { parseBlocks, textLen, truncateBlocks } from "../lib/markdown.js";

// Copy that also works inside phone browsers that block navigator.clipboard (falls back to a hidden textarea).
export async function copyText(text) {
  try { if (navigator.clipboard?.writeText && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall through */ }
  try {
    const t = document.createElement("textarea"); t.value = text; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
    document.body.appendChild(t); t.focus(); t.select(); t.setSelectionRange(0, text.length); const ok = document.execCommand("copy"); document.body.removeChild(t); return !!ok;
  } catch { return false; }
}

// Everything below renders parsed DATA as React text nodes. There is no dangerouslySetInnerHTML anywhere.
function Inline({ nodes }) {
  return nodes.map((n, i) => {
    if (n.t === "text") return <React.Fragment key={i}>{n.v}</React.Fragment>;
    if (n.t === "code") return <code key={i} className="md-ic mono">{n.v}</code>;
    if (n.t === "bold") return <strong key={i}><Inline nodes={n.c} /></strong>;
    if (n.t === "em") return <em key={i}><Inline nodes={n.c} /></em>;
    if (n.t === "link") return <a key={i} className="md-a" href={n.href} target="_blank" rel="noopener noreferrer nofollow"><Inline nodes={n.c} /></a>;
    return null;
  });
}

function CodeBlock({ lang, v, open }) {
  const [state, setState] = useState("idle"); const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => { const ok = await copyText(v); setState(ok ? "ok" : "fail"); clearTimeout(timer.current); timer.current = setTimeout(() => setState("idle"), 1800); };
  return (
    <div className="md-code emb-code">
      <div className="emb-code-h"><span className="mono">{lang || "code"}</span>
        <button type="button" className={"md-copy" + (state === "ok" ? " ok" : state === "fail" ? " bad" : "")} onClick={copy} aria-label="Copy code" disabled={!v}>
          {state === "ok" ? <Check size={14} /> : <Copy size={14} />}<span>{state === "ok" ? "Copied" : state === "fail" ? "Select & copy" : "Copy"}</span></button></div>
      <pre className="mono" tabIndex={0}><code>{v}</code>{open && <span className="caret" />}</pre>
    </div>
  );
}

// `shown` = how many visible characters to reveal (for the typing effect). Omit to show everything.
export default function Markdown({ text, shown }) {
  const all = React.useMemo(() => parseBlocks(text), [text]);
  const blocks = shown == null ? all : truncateBlocks(all, shown);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        if (b.t === "code") return <CodeBlock key={i} lang={b.lang} v={b.v} open={b.open} />;
        if (b.t === "h") { const H = "h" + (b.n + 2 > 6 ? 6 : b.n + 2); return <H key={i} className={"md-h md-h" + b.n}><Inline nodes={b.c} /></H>; }
        if (b.t === "p") return <p key={i} className="md-p"><Inline nodes={b.c} /></p>;
        if (b.t === "quote") return <blockquote key={i} className="md-q"><Inline nodes={b.c} /></blockquote>;
        if (b.t === "hr") return <hr key={i} className="md-hr" />;
        if (b.t === "ul" || b.t === "ol") { const L = b.t; return <L key={i} className="md-l">{b.items.map((it, k) => <li key={k} style={it.depth ? { marginLeft: it.depth * 14 } : undefined}><Inline nodes={it.c} /></li>)}</L>; }
        return null;
      })}
    </div>
  );
}
export { textLen, parseBlocks };
