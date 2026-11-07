import React, { useEffect, useState } from "react";
import { X, FileCode, Check, Ban } from "lucide-react"; import { useApp } from "../lib/store.jsx";
const KW = /\b(local|function|end|if|then|else|elseif|for|while|do|return|in|and|or|not|nil|true|false|repeat|until|break|continue)\b/g;
function hl(line) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const ci = line.indexOf("--"); const code = ci >= 0 ? line.slice(0, ci) : line; const com = ci >= 0 ? line.slice(ci) : "";
  let h = esc(code).replace(/("[^"]*"|'[^']*')/g, '<s class="t-s">$1</s>').replace(KW, '<s class="t-k">$1</s>').replace(/\b(\d+\.?\d*)\b/g, '<s class="t-n">$1</s>');
  return h + (com ? `<s class="t-c">${esc(com)}</s>` : "");
}
export default function ScriptViewer({ path, line = 1, onClose }) {
  const { data, queue } = useApp(); const [src, setSrc] = useState(null); const [newer, setNewer] = useState(null);
  useEffect(() => { queue("read_script", { path }); }, [path]);
  const cmd = (data?.commands ?? []).find((c) => c.type === "read_script" && c.payload?.path === path && c.status === "done");
  useEffect(() => { const t = cmd?.result; if (t != null) setSrc(typeof t === "string" ? t : t.source ?? JSON.stringify(t, null, 2)); }, [cmd?.id]);
  const patch = (data?.commands ?? []).find((c) => ["write_script", "patch_script"].includes(c.type) && c.payload?.path === path && c.status === "pending");
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const lines = (src ?? "").split("\n"); const proposed = patch?.payload?.source?.split("\n");
  return (<div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal glass hud" role="dialog" aria-modal="true" aria-label={"Script " + path}>
    <div className="modal-h"><FileCode size={18} color="var(--violet)" /><b className="mono" style={{ flex: 1 }}>{path}</b>{patch && <><span className="chip amber">patch pending</span><button className="brick sm green"><Check size={13} />Accept</button><button className="brick sm red"><Ban size={13} />Reject</button></>}<button className="iconbtn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
    <div className="modal-b" style={{ padding: 0 }}>{src == null ? <div style={{ padding: 18 }}><div className="skel" style={{ height: 120 }} /></div> :
      <div className={proposed ? "sbs" : ""}><pre className="src mono">{lines.map((l, i) => <div key={i} className={i + 1 === line ? "hl" : ""}><span className="gut">{i + 1}</span><span dangerouslySetInnerHTML={{ __html: hl(l) || " " }} /></div>)}</pre>
        {proposed && <pre className="src mono new">{proposed.map((l, i) => <div key={i} className={l !== lines[i] ? "chg" : ""}><span className="gut">{i + 1}</span><span dangerouslySetInnerHTML={{ __html: hl(l) || " " }} /></div>)}</pre>}</div>}</div>
  </div></div>);
}
