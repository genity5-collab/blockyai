import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, MessageSquare, FolderTree, Save, Camera, Settings, FileCode } from "lucide-react"; import { useApp } from "../lib/store.jsx";
export default function Palette({ onClose, setView }) {
  const { data, queue, send } = useApp(); const [q, setQ] = useState(""); const [i, setI] = useState(0); const ref = useRef(null); useEffect(() => ref.current?.focus(), []);
  const items = useMemo(() => [
    ...[["chat", "Go to Chat", MessageSquare], ["explorer", "Go to Explorer", FolderTree], ["snaps", "Go to Snapshots", Save], ["shots", "Go to Screenshots", Camera], ["settings", "Open Settings", Settings]].map(([v, n, I]) => ({ n, I, run: () => setView(v) })),
    { n: "Save a snapshot now", I: Save, run: () => queue("snapshot_save", { label: "palette " + new Date().toLocaleTimeString() }) },
    { n: "Ask Blocky to playtest", I: MessageSquare, run: () => send("Start a playtest and tell me what happens.") },
    { n: "Ask Blocky to fix errors", I: MessageSquare, run: () => send("Look at the Output for errors and fix them.") },
    ...(data?.snapshots ?? []).map((s) => ({ n: "Snapshot: " + s.label, I: Save, run: () => setView("snaps") })),
    ...[...new Set((data?.edit_log ?? []).map((e) => e.target).filter((t) => /Script/i.test(t || "")))].slice(0, 20).map((t) => ({ n: "Script: " + t, I: FileCode, run: () => setView("explorer") })),
  ].filter((x) => x.n.toLowerCase().includes(q.toLowerCase())).slice(0, 12), [q, data]);
  const go = (it) => { it?.run(); onClose(); };
  return (<div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal glass hud" style={{ width: "min(580px,100%)" }} role="dialog" aria-label="Command palette">
    <div className="modal-h"><Search size={18} color="var(--blue)" /><input ref={ref} className="plain" style={{ flex: 1, fontSize: 16 }} value={q} placeholder="Search commands, snapshots, scripts..." onChange={(e) => { setQ(e.target.value); setI(0); }} onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); } if (e.key === "Enter") go(items[i]); }} aria-label="Search" /><kbd>Esc</kbd></div>
    <div className="modal-b" style={{ padding: 8 }}>{items.length === 0 && <div className="empty"><p>Nothing matches.</p></div>}{items.map((it, n) => <button key={n} className={"pal" + (n === i ? " on" : "")} onMouseEnter={() => setI(n)} onClick={() => go(it)}><it.I size={16} />{it.n}</button>)}</div></div></div>);
}
