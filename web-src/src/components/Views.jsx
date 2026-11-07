import React, { useState } from "react";
import { Save, RotateCcw, Camera, Plus } from "lucide-react";
import { useApp } from "../lib/store.jsx"; import { web } from "../lib/api.js"; import { ago, clock } from "../lib/util.js";

export function SnapshotsView() {
  const { data, queue, toast } = useApp(); const snaps = data?.snapshots ?? []; const [label, setLabel] = useState("");
  const save = async () => { const r = await queue("snapshot_save", { label: label || "manual " + new Date().toLocaleTimeString() }); if (r?.id) { toast("Snapshot requested", "ok"); setLabel(""); } };
  return (<div className="pane full"><div className="toolbar"><input className="plain" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Snapshot name (optional)" aria-label="Snapshot name" /><button className="brick sm green" onClick={save}><Plus size={14} />Save snapshot</button></div>
    <div className="list">{snaps.length === 0 && <div className="empty"><Save size={36} color="var(--blue)" /><h4>No snapshots yet</h4><p>Save one before big changes. Blocky also auto-saves one before destructive edits.</p></div>}
      {snaps.map((s) => <div key={s.id} className="snap"><Save size={18} color="var(--green)" /><div style={{ flex: 1 }}><b>{s.label}</b><div className="muted small">{ago(s.created_at)} ago</div></div>
        <button className="brick sm amber" onClick={async () => { if (confirm("Restore this snapshot? It replaces the current Workspace.")) { await queue("snapshot_restore", { snapshot_id: s.id }); toast("Restore queued. Approve it in the dialog.", "warn"); } }}><RotateCcw size={13} />Restore</button></div>)}</div></div>);
}
export function ShotsView() {
  const { data, queue, toast } = useApp(); const shots = data?.screenshots ?? [];
  return (<div className="pane full"><div className="toolbar"><span className="label" style={{ flex: 1 }}>Screenshots</span><button className="brick sm" onClick={async () => { await queue("screenshot"); toast("Requested. Studio plugins usually can't capture images.", "warn"); }}><Camera size={14} />Capture</button></div>
    <div className="list">{shots.length === 0 ? <div className="empty"><Camera size={36} color="var(--blue)" /><h4>No screenshots</h4><p>Roblox plugins can't take screenshots, so verification uses the tree, scripts and Output instead.</p></div>
      : <div className="masonry">{shots.map((s) => <a key={s.id} className="shot" href={s.url} target="_blank" rel="noreferrer"><img src={s.url} alt={clock(s.created_at)} loading="lazy" /></a>)}</div>}</div></div>);
}
