import React, { useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck, Loader2, Server, TerminalSquare, CircleCheck, CircleX } from "lucide-react";
import { useApp } from "../lib/store.jsx";
import { web, call } from "../lib/api.js";

// /#/diagnostics. Shows RAW output only: whatever the VM returned, character for character. Nothing here is summarised or invented.
export default function Diagnostics() {
  const { sid, sessions, select } = useApp();
  const [busy, setBusy] = useState(false); const [res, setRes] = useState(null);
  const [pick, setPick] = useState(sid);
  useEffect(() => { if (sid) setPick(sid); }, [sid]);
  const sess = (sessions ?? []).find((s) => s.id === pick);

  const verify = async () => {
    if (!pick) return; setBusy(true); setRes(null);
    const r = await call("vm-verify", { session_id: pick }); setRes(r); setBusy(false);
  };
  const back = () => { location.hash = ""; };
  const ok = res?.exec && !res.exec.error && res.exec.exit_code === 0;
  const state = res?.freestyle?.state;

  return (
    <div className="diag">
      <div className="diag-top"><button className="iconbtn" onClick={back} aria-label="Back"><ArrowLeft size={18} /></button>
        <h2><ShieldCheck size={22} color="var(--blue)" /> Diagnostics</h2></div>

      <div className="glass hud diag-card">
        <div className="diag-row"><Server size={18} color="var(--blue)" /><b>Session</b>
          <select value={pick ?? ""} onChange={(e) => { setPick(e.target.value); setRes(null); }}>
            {(sessions ?? []).length === 0 && <option value="">No sessions yet</option>}
            {(sessions ?? []).map((s) => <option key={s.id} value={s.id}>{(s.title || "Untitled").slice(0, 40)} ({s.vm_id ? "has VM" : "no VM"})</option>)}
          </select></div>
        <div className="diag-kv"><span>vm_id (from our database)</span><code>{sess?.vm_id ?? "none yet"}</code></div>
        <div className="diag-kv"><span>vm_status (from our database)</span><code>{sess?.vm_status ?? "-"}</code></div>
        <button className="brick green xl" onClick={verify} disabled={busy || !pick || !sess?.vm_id} style={{ marginTop: 12 }}>
          {busy ? <Loader2 size={18} className="spin" /> : <TerminalSquare size={18} />}{busy ? "Running on the VM..." : "Verify VM"}</button>
        {!sess?.vm_id && pick && <p className="muted small" style={{ marginTop: 8 }}>This session has no VM yet. Open it from the home screen so it starts, then come back.</p>}
      </div>

      {res && (<>
        <div className="glass hud diag-card">
          <div className="diag-row"><b>Result</b>
            {res.error ? <span className="chip red"><CircleX size={14} />error</span>
              : ok ? <span className="chip green"><CircleCheck size={14} />command ran on the VM (exit 0)</span>
              : <span className="chip amber">exit {String(res.exec?.exit_code ?? "?")}</span>}</div>
          <div className="diag-kv"><span>vm_id</span><code>{res.vm_id ?? "none"}</code></div>
          <div className="diag-kv"><span>Freestyle state</span><code>{res.freestyle?.error ? "error: " + res.freestyle.error : state ?? "-"}</code></div>
          {res.freestyle?.snapshotId && <div className="diag-kv"><span>snapshot</span><code>{res.freestyle.snapshotId}</code></div>}
          {res.freestyle?.resources && <div className="diag-kv"><span>resources</span><code>{res.freestyle.resources.cpu} CPU, {Math.round(res.freestyle.resources.memory / 1024)} GB RAM</code></div>}
          {res.exec?.ms != null && <div className="diag-kv"><span>round trip</span><code>{res.exec.ms} ms</code></div>}
          {res.error && <pre className="diag-raw err">{res.error}</pre>}
        </div>

        {res.command && <div className="glass hud diag-card">
          <div className="diag-row"><b>Raw output</b><span className="muted small">$ {res.command}</span></div>
          {res.exec?.error ? <pre className="diag-raw err">{res.exec.error}</pre> : (<>
            <div className="diag-lbl">stdout</div><pre className="diag-raw">{res.exec?.stdout || "(empty)"}</pre>
            <div className="diag-lbl">stderr</div><pre className="diag-raw err">{res.exec?.stderr || "(empty)"}</pre>
            <div className="diag-lbl">exit code</div><pre className="diag-raw">{String(res.exec?.exit_code)}</pre></>)}
        </div>}

        {res.agent && <div className="glass hud diag-card">
          <div className="diag-row"><b>Agent loop inside this VM</b><span className="muted small">systemctl is-active blockyai-agent; ps ... node src/index.js</span></div>
          <pre className="diag-raw">{res.agent.error ?? (res.agent.stdout || "(empty)")}</pre>
        </div>}
      </>)}
    </div>);
}
