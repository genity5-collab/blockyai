import React, { useEffect, useState } from "react";
import { ChevronRight, RefreshCw, Folder, Box, FileCode } from "lucide-react";
import { useApp } from "../lib/store.jsx"; import { web } from "../lib/api.js"; import { cx } from "../lib/util.js"; import ScriptViewer from "./ScriptViewer.jsx";

function Node({ n, depth, onScript }) {
  const [o, setO] = useState(depth < 1); const kids = n.children ?? []; const isScript = /Script$/.test(n.class || n.className || "");
  return (<div><button className="tn" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => (isScript ? onScript(n) : setO(!o))} aria-expanded={kids.length ? o : undefined}>
    {kids.length ? <ChevronRight size={13} className={o ? "rot" : ""} /> : <span style={{ width: 13 }} />}{isScript ? <FileCode size={14} color="var(--violet)" /> : kids.length ? <Folder size={14} color="var(--blue)" /> : <Box size={14} color="var(--mut)" />}
    <span>{n.name}</span><span className="muted small">{n.class || n.className}</span></button>{o && kids.map((k, i) => <Node key={i} n={k} depth={depth + 1} onScript={onScript} />)}</div>);
}
export default function Explorer() {
  const { data, sid, queue } = useApp(); const [tree, setTree] = useState(null); const [busy, setBusy] = useState(false); const [script, setScript] = useState(null);
  const last = (data?.commands ?? []).find((c) => c.type === "get_tree" && c.status === "done");
  useEffect(() => { if (last?.result) setTree(last.result); }, [last?.id]);
  const refresh = async () => { setBusy(true); await queue("get_tree", { path: "game", depth: 3 }); setTimeout(() => setBusy(false), 1500); };
  useEffect(() => { if (!tree && data?.plugin_online) refresh(); }, [data?.plugin_online]);
  const root = tree && (Array.isArray(tree) ? { name: "game", class: "DataModel", children: tree } : tree);
  const sp = (n) => setScript({ path: n.path || n.name, line: 1 });
  return (<div className="pane full"><div className="toolbar"><span className="label" style={{ flex: 1 }}>Explorer mirror</span><button className="brick sm" onClick={refresh} disabled={busy}><RefreshCw size={14} className={busy ? "spin" : ""} />Refresh</button></div>
    <div className="list">{!root ? <div style={{ padding: 14, display: "grid", gap: 8 }}>{[1, 2, 3, 4, 5].map((i) => <div key={i} className="skel" style={{ height: 26, width: 100 - i * 9 + "%" }} />)}</div> : <Node n={root} depth={0} onScript={sp} />}</div>
    {script && <ScriptViewer path={script.path} line={script.line} onClose={() => setScript(null)} />}</div>);
}
