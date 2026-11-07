import React, { useState } from "react";
import { TriangleAlert, Volume2, Zap, Layers, Gauge, Eye } from "lucide-react";
import { useApp } from "../lib/store.jsx"; import { store } from "../lib/util.js";
function Switch({ on, set, label, danger }) { return <button role="switch" aria-checked={on} aria-label={label} className={"sw" + (on ? " on" : "") + (danger ? " danger" : "")} onClick={() => set(!on)}><i /></button>; }
export default function SettingsPanel() {
  const { data, patchSession, deleteSession, sid } = useApp(); const s = data?.session; const [sound, setSound] = useState(store.get("sound", false)); const [reduce, setReduce] = useState(store.get("reduce", false));
  if (!s) return <div style={{ padding: 20 }} className="skel" />;
  return (<div className="pane full"><div className="list" style={{ padding: 18, display: "grid", gap: 14, alignContent: "start" }}>
    <div className="set"><div><b><Zap size={16} /> Allow run_lua</b><p className="muted small">Lets the agent run arbitrary Lua in your Studio. Every run still asks you first.</p>
      {s.run_lua_enabled && <p className="warnline"><TriangleAlert size={14} /> Dangerous: this can change or delete anything in your place.</p>}</div>
      <Switch danger on={s.run_lua_enabled} set={(v) => (!v || confirm("Enable run_lua? The agent can run any Lua code in your Studio (you still approve each run)."))  && patchSession({ run_lua_enabled: v })} label="Allow run_lua" /></div>
    <div className="set"><div><b><Layers size={16} /> Live sync</b><p className="muted small">Keep the Explorer mirror and edit log updating in real time.</p></div><Switch on={s.live_sync !== false} set={(v) => patchSession({ live_sync: v })} label="Live sync" /></div>
    <div className="set col"><div className="row"><b style={{ flex: 1 }}><Gauge size={16} /> Max agent iterations</b><span className="num big-n">{s.max_iterations}</span></div><input type="range" min="1" max="40" value={s.max_iterations} onChange={(e) => patchSession({ max_iterations: +e.target.value })} aria-label="Max iterations" /><p className="muted small">How many tool steps Blocky may take per message while fixing things.</p></div>
    <div className="set col"><div className="row"><b style={{ flex: 1 }}><Layers size={16} /> Batch size cap</b><span className="num big-n">{s.max_batch_size}</span></div><input type="range" min="1" max="100" value={s.max_batch_size} onChange={(e) => patchSession({ max_batch_size: +e.target.value })} aria-label="Batch size cap" /></div>
    <div className="set"><div><b><Volume2 size={16} /> UI sounds</b><p className="muted small">Subtle blips when commands finish or fail. Off by default.</p></div><Switch on={sound} set={(v) => { setSound(v); store.set("sound", v); }} label="Sound" /></div>
    <div className="set"><div><b><Eye size={16} /> Reduced motion</b><p className="muted small">Calms the animated grid and effects.</p></div><Switch on={reduce} set={(v) => { setReduce(v); store.set("reduce", v); document.documentElement.classList.toggle("reduce", v); document.querySelector(".app")?.classList.toggle("reduce", v); }} label="Reduced motion" /></div>
    <button className="brick red" onClick={() => confirm("Delete this session and its VM?") && deleteSession(sid)}>Delete this session</button></div></div>);
}
