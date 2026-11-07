import React, { useState, useEffect } from "react";
import { TriangleAlert } from "lucide-react"; import { web } from "../lib/api.js"; import { useApp } from "../lib/store.jsx";
export default function ConfirmModal({ cmd, onClose }) {
  const { sid, toast } = useApp(); const [snap, setSnap] = useState(true);
  useEffect(() => { const k = (e) => e.key === "Escape" && decide(false); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); });
  const decide = async (approve) => {
    if (approve && snap) await web("queue", { session_id: sid, type: "snapshot_save", payload: { label: "auto before " + cmd.type } });
    await web("confirm_command", { session_id: sid, command_id: cmd.id, approve }); toast(approve ? "Approved" : "Rejected", approve ? "ok" : "warn"); onClose(); };
  const items = cmd.type === "run_lua" ? [cmd.payload?.code?.slice(0, 600)] : cmd.type === "snapshot_restore" ? ["Replace the current Workspace with the saved snapshot"] : [JSON.stringify(cmd.payload).slice(0, 400)];
  return (
    <div className="scrim"><div className="modal glass warn" role="alertdialog" aria-modal="true" aria-label="Warning" style={{ width: "min(560px,100%)" }}>
      <div className="modal-h" style={{ background: "rgba(255,59,78,.1)" }}><TriangleAlert color="var(--red)" /><h3 style={{ margin: 0, color: "var(--red)", letterSpacing: ".1em" }} className="hudt">WARNING</h3></div>
      <div className="modal-b"><p style={{ marginTop: 0 }}>Blocky wants to run <b className="mono">{cmd.type}</b>. This can change or remove things in your place.</p>
        <pre className="code mono err">{items.join("\n")}</pre>
        <label className="check"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /><span>Auto-snapshot first</span></label>
        <div className="row" style={{ gap: 10, justifyContent: "flex-end", marginTop: 14 }}><button className="brick ghost" onClick={() => decide(false)}>Reject</button><button className="brick red" onClick={() => decide(true)}>Approve</button></div></div>
    </div></div>);
}
