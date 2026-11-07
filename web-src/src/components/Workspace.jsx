import React, { useEffect, useState } from "react";
import { MessageSquare, FolderTree, Save, Camera, Settings, Plus, Search, RotateCcw, Menu, X, ListTree, Terminal, History } from "lucide-react";
import Logo from "./Logo.jsx"; import { useApp } from "../lib/store.jsx"; import { cx, fmtDur, ago } from "../lib/util.js";
import Chat from "./Chat.jsx"; import RightPanel from "./RightPanel.jsx"; import Explorer from "./Explorer.jsx";
import { SnapshotsView, ShotsView } from "./Views.jsx"; import SettingsPanel from "./SettingsPanel.jsx"; import Palette from "./Palette.jsx";

const NAV = [["chat", MessageSquare, "Chat"], ["explorer", FolderTree, "Explorer"], ["snaps", Save, "Snapshots"], ["shots", Camera, "Screenshots"], ["settings", Settings, "Settings"]];

export default function Workspace() {
  const { data, ping, ensureVm, vmBusy, stats, createSession, sessions, select, sid } = useApp();
  const [view, setView] = useState("chat"); const [pal, setPal] = useState(false); const [sheet, setSheet] = useState(null); const [now, setNow] = useState(Date.now());
  const [rw, setRw] = useState(() => +localStorage.getItem("blocky_rw") || 400);
  const s = data?.session; const online = !!data?.plugin_online;
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const k = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPal((p) => !p); } if (e.key === "Escape") { setPal(false); setSheet(null); } }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);

  const vmState = vmBusy ? "starting" : (s?.vm_status === "running" ? "running" : s?.vm_status === "starting" ? "starting" : s?.vm_status === "suspended" ? "suspended" : s?.vm_status === "error" ? "error" : "idle");
  const vmChip = { running: ["green", "VM running"], starting: ["amber", "VM starting"], suspended: ["violet", "VM suspended"], error: ["red", "VM error"], idle: ["blue", "VM ready"] }[vmState];
  const cmds = data?.commands ?? []; const q = cmds.filter((c) => c.status === "pending").length, r = cmds.filter((c) => c.status === "running").length, d = cmds.filter((c) => c.status === "done").length, f = cmds.filter((c) => c.status === "failed").length;
  const iter = cmds.filter((c) => new Date(c.created_at) > new Date(Date.now() - 600000)).length;
  const errs = (data?.playtest_logs ?? []).filter((l) => l.level === "error").length;

  const startResize = (e) => { e.preventDefault(); const move = (ev) => { const w = Math.max(300, Math.min(640, window.innerWidth - ev.clientX)); setRw(w); localStorage.setItem("blocky_rw", w); }; const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); };

  return (
    <div className="ws">
      <header className="topbar glass">
        <div className="brand"><Logo size={30} /><b className="brand-t">Blocky<span>AI</span></b></div>
        <span className="chip blue place" title="Place name">{s?.place_name || "Studio"}</span>
        <span className={cx("chip", online ? "green" : "red")}><i className={cx("dot", online && "pulse")} />{online ? "Live" : "Offline"}</span>
        <span className={cx("chip hide-sm", vmChip[0])}><i className={cx("dot", vmState === "starting" && "pulse")} />{vmChip[1]}</span>
        <span className="chip hide-sm"><span className="num">{ping ?? "--"}</span>ms</span>
        <div style={{ flex: 1 }} />
        <button className="brick sm ghost hide-sm" onClick={() => setPal(true)}><Search size={14} />Search <kbd>Ctrl K</kbd></button>
        <button className="brick sm amber" onClick={() => ensureVm(true)} disabled={vmBusy} title="Destroy and restart the agent VM"><RotateCcw size={14} />Restart VM</button>
        <select className="sel hide-sm" value={sid} onChange={(e) => select(e.target.value)} aria-label="Switch session">{(sessions ?? []).filter((x) => x.plugin_connected_at).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
        <button className="iconbtn" onClick={() => { createSession(); }} title="New session" aria-label="New session"><Plus size={18} /></button>
      </header>

      <div className="cols" style={{ "--rw": rw + "px" }}>
        <nav className="rail glass" aria-label="Sections">
          {NAV.map(([k, I, n]) => <button key={k} className={cx("iconbtn", view === k && "on")} onClick={() => setView(k)} title={n} aria-label={n} aria-current={view === k}><I size={20} /></button>)}
        </nav>
        <main className="center glass hud">
          {view === "chat" && <Chat />}{view === "explorer" && <Explorer />}{view === "snaps" && <SnapshotsView />}{view === "shots" && <ShotsView />}{view === "settings" && <SettingsPanel />}
        </main>
        <div className="grip" onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label="Resize panel" />
        <aside className="right glass hud"><RightPanel /></aside>
      </div>

      <footer className="strip glass">
        <span className="stat"><i className="dot" style={{ color: "var(--dim)" }} /><span className="label">Queued</span><b className="num">{q}</b></span>
        <span className="stat"><i className={cx("dot", r && "pulse")} style={{ color: "var(--blue)" }} /><span className="label">Running</span><b className="num">{r}</b></span>
        <span className="stat"><i className="dot" style={{ color: "var(--green)" }} /><span className="label">Done</span><b className="num">{d}</b></span>
        <span className="stat"><i className="dot" style={{ color: "var(--red)" }} /><span className="label">Failed</span><b className="num">{f}</b></span>
        <div style={{ flex: 1 }} />
        <span className="stat hide-sm"><span className="label">Agent</span><b className="num">{iter}/{(s?.max_iterations ?? 12) * 3}</b></span>
        <span className="stat"><span className="label">Session</span><b className="num">{fmtDur(now - stats.started)}</b></span>
      </footer>

      <nav className="tabbar glass" aria-label="Mobile">
        <button className={cx(!sheet && view === "chat" && "on")} onClick={() => { setSheet(null); setView("chat"); }}><MessageSquare size={20} />Chat</button>
        <button className={cx(sheet === "log" && "on")} onClick={() => setSheet(sheet === "log" ? null : "log")}><History size={20} />Log</button>
        <button className={cx(sheet === "console" && "on")} onClick={() => setSheet(sheet === "console" ? null : "console")}><Terminal size={20} />{errs > 0 && <span className="badge">{errs}</span>}Console</button>
        <button className={cx(view === "settings" && "on")} onClick={() => { setSheet(null); setView("settings"); }}><Settings size={20} />Settings</button>
      </nav>
      {sheet && <div className="sheet glass"><button className="iconbtn sheet-x" onClick={() => setSheet(null)} aria-label="Close"><X size={18} /></button><RightPanel forceTab={sheet} /></div>}
      {pal && <Palette onClose={() => setPal(false)} setView={setView} />}
    </div>);
}
