import React, { useEffect, useMemo, useRef, useState } from "react";
import LockedShot from "./LockedShot.jsx";
import ScreenPanel from "./ScreenPanel.jsx";
import { History, Terminal, Image as Img, Undo2, Pause, Play, Download, Search, ChevronRight, Trash2, ArrowDownToLine, Sparkles, Columns2, Package, Monitor } from "lucide-react";
import Icon from "./Icon.jsx"; import { useApp } from "../lib/store.jsx"; import { web } from "../lib/api.js"; import { clock, cx } from "../lib/util.js"; import ScriptViewer from "./ScriptViewer.jsx"; import { Templates } from "./Build.jsx";

const SRC = { ai: ["violet", "AI"], user: ["green", "USER"], bulk: ["amber", "BULK"] };
const ACT = { set: "SlidersHorizontal", create: "Box", delete: "Trash2", move: "Move", write_script: "FilePen", patch_script: "Wrench" };

function Diff({ before, after }) {
  const f = (v) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 1));
  const a = f(before).split("\n"), b = f(after).split("\n");
  return <div className="diff mono">{a.filter((l) => l !== "" || a.length > 1).map((l, i) => <div key={"a" + i} className="rm">- {l}</div>)}{b.filter((l) => l !== "" || b.length > 1).map((l, i) => <div key={"b" + i} className="add">+ {l}</div>)}</div>;
}
function EditLog() {
  const { data, sid, toast } = useApp(); const [paused, setPaused] = useState(false); const [snap, setSnap] = useState([]); const [filter, setFilter] = useState("all"); const [q, setQ] = useState(""); const [open, setOpen] = useState({}); const [flash, setFlash] = useState({}); const known = useRef(new Set());
  useEffect(() => { if (!paused) setSnap(data?.edit_log ?? []); }, [data?.edit_log, paused]);
  useEffect(() => { const f = {}; snap.forEach((e) => { if (known.current.size && !known.current.has(e.id)) f[e.id] = 1; known.current.add(e.id); }); if (Object.keys(f).length) { setFlash(f); setTimeout(() => setFlash({}), 1400); } }, [snap]);
  const rows = snap.filter((e) => (filter === "all" || e.source === filter) && (!q || (e.target + e.action).toLowerCase().includes(q.toLowerCase())));
  const undo = async (id) => { const r = await web("undo_edit", { session_id: sid, edit_id: id }); toast(r.error || "Undo queued (auto-snapshot taken)", r.error ? "error" : "ok"); };
  const undoBatch = async (b) => { for (const e of snap.filter((x) => x.batch_id === b && !x.undone)) await undo(e.id); };
  const exp = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" })); a.download = "blockyai-edit-log.json"; a.click(); };
  return (<div className="pane">
    <div className="toolbar"><div className="srch"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter path or action" aria-label="Filter log" /></div>
      <button className="iconbtn sm" onClick={() => setPaused(!paused)} title={paused ? "Resume" : "Pause"} aria-label={paused ? "Resume" : "Pause"}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>
      <button className="iconbtn sm" onClick={exp} title="Export" aria-label="Export"><Download size={15} /></button></div>
    <div className="fl">{["all", "ai", "user", "bulk"].map((f) => <button key={f} className={cx("qchip", filter === f && "on")} onClick={() => setFilter(f)}>{f}</button>)}</div>
    <div className="list" aria-live="polite">
      {rows.length === 0 && <div className="empty"><History size={34} color="var(--blue)" /><h4>No edits yet</h4><p>Say something to Blocky and every change shows up here live.</p></div>}
      {rows.map((e) => { const [c, l] = SRC[e.source] || SRC.ai; const o = open[e.id];
        return (<div key={e.id} className={cx("row-e", flash[e.id] && "flash", e.undone && "undone")}>
          <button className="row-h" onClick={() => setOpen({ ...open, [e.id]: !o })} aria-expanded={!!o}><ChevronRight size={14} className={o ? "rot" : ""} /><span className={"chip " + c} style={{ padding: "1px 8px" }}>{l}</span><Icon name={ACT[e.action] || "Box"} size={14} /><span className="mono path">{e.target}</span><span className="muted small mono">{clock(e.created_at)}</span></button>
          {o && <div className="row-b"><Diff before={e.before} after={e.after} /><div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="brick sm ghost" disabled={e.undone} onClick={() => undo(e.id)}><Undo2 size={13} />{e.undone ? "Undone" : "Undo"}</button>
            {e.batch_id && <button className="brick sm ghost" onClick={() => undoBatch(e.batch_id)}><Undo2 size={13} />Undo batch</button>}</div></div>}
        </div>); })}
    </div></div>);
}
function Console() {
  const { data } = useApp(); const [auto, setAuto] = useState(true); const [cleared, setCleared] = useState(0); const [view, setView] = useState(null); const end = useRef(null);
  const logs = (data?.playtest_logs ?? []).filter((l) => l.id > cleared); const errs = logs.filter((l) => l.level === "error").length;
  useEffect(() => { if (auto) end.current?.scrollIntoView({ block: "end" }); }, [logs.length, auto]);
  const lvl = (l) => ({ error: "var(--red)", warn: "var(--amber)", warning: "var(--amber)", info: "var(--blue)" }[l] || "var(--mut)");
  const link = (m) => { const x = /((?:Workspace|ServerScriptService|StarterPlayer|ReplicatedStorage|StarterGui)[\w.]*)(?::(\d+))?/.exec(m || ""); return x ? { path: x[1], line: +x[2] || 1 } : null; };
  return (<div className="pane"><div className="toolbar"><span className="label" style={{ flex: 1 }}>Playtest Output {errs > 0 && <span className="badge">{errs}</span>}</span>
    <button className={cx("iconbtn sm", auto && "on")} onClick={() => setAuto(!auto)} title="Auto-scroll" aria-label="Auto-scroll"><ArrowDownToLine size={15} /></button>
    <button className="iconbtn sm" onClick={() => setCleared(Math.max(0, ...((data?.playtest_logs ?? []).map((l) => l.id))))} title="Clear" aria-label="Clear"><Trash2 size={15} /></button></div>
    <div className="list term mono" aria-live="polite">
      {logs.length === 0 && <div className="empty"><Terminal size={34} color="var(--blue)" /><h4>Console is quiet</h4><p>Press Play in Studio and the Output appears here, color coded.</p></div>}
      {logs.map((l) => { const k = link(l.message); return <div key={l.id} className="ln" style={{ color: lvl(l.level) }}><span className="muted">{clock(l.created_at)}</span> {k ? <button className="plink" onClick={() => setView(k)}>{l.message}</button> : l.message}</div>; })}
      <div ref={end} /></div>
    {view && <ScriptViewer path={view.path} line={view.line} onClose={() => setView(null)} />}</div>);
}
function Shots() {
  const { data } = useApp(); const shots = data?.screenshots ?? [];
  return (<div className="pane"><div className="list">
    {shots.length === 0 && <div className="empty"><Img size={34} color="var(--blue)" /><h4>No screenshots</h4><p>Ask Blocky to build something and it will look at it from several angles. Studio asks you to allow screenshots once; if you decline, Blocky falls back to a text description.</p></div>}
    <div className="masonry">{shots.map((s) => <div key={s.id} className="shot"><LockedShot shot={{ ...s, label: "Screenshot " + clock(s.created_at) }} /></div>)}</div></div>
  </div>);
}
export default function RightPanel({ forceTab }) {
  const { data } = useApp(); const [t, setT] = useState("log"); const tab = forceTab || t; const errs = (data?.playtest_logs ?? []).filter((l) => l.level === "error").length;
  return (<div className="rp"><div className="tabs" role="tablist">
    {[["log", History, "Edit log"], ["console", Terminal, "Console"], ["screen", Monitor, "Screen"], ["shots", Img, "Shots"], ["tpl", Package, "Templates"]].map(([k, I, n]) => <button key={k} role="tab" aria-selected={tab === k} className={cx("tab", tab === k && "on")} onClick={() => setT(k)}><I size={15} />{n}{k === "console" && errs > 0 && <span className="badge">{errs}</span>}</button>)}</div>
    {tab === "log" && <EditLog />}{tab === "console" && <Console />}{tab === "screen" && <ScreenPanel />}{tab === "shots" && <Shots />}{tab === "tpl" && <Templates />}</div>);
}
