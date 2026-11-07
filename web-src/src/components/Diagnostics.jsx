import React, { useEffect, useState, useCallback } from "react";
import { ArrowLeft, ShieldCheck, Loader2, Server, TerminalSquare, CircleCheck, CircleX, Plug } from "lucide-react";
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
  // Plugin panel: exactly what the Studio plugin reported at pairing and in its self-tests (refreshes every 5 s while this page is open).
  const [plug, setPlug] = useState(null);
  const loadPlug = useCallback(async () => { if (!pick) return; try { setPlug(await web("plugin_status", { session_id: pick })); } catch (e) { setPlug({ error: String(e?.message ?? e) }); } }, [pick]);
  useEffect(() => { setPlug(null); loadPlug(); const t = setInterval(loadPlug, 5000); return () => clearInterval(t); }, [loadPlug]);
  const seenAgo = plug?.plugin_last_seen_at ? Math.max(0, Math.round((Date.now() - new Date(plug.plugin_last_seen_at)) / 1000)) : null;
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


      <div className="glass hud diag-card">
        <div className="diag-row"><Plug size={18} color="var(--blue)" /><b>Studio plugin</b>
          {plug?.error ? <span className="chip red"><CircleX size={14} />{plug.error}</span>
            : seenAgo == null ? <span className="chip amber">never connected</span>
            : seenAgo < 20 ? <span className="chip green"><CircleCheck size={14} />connected, last seen {seenAgo}s ago</span>
            : <span className="chip amber">not seen for {seenAgo}s</span>}</div>
        {plug && !plug.error && (<>
          <div className="diag-kv"><span>Studio version (reported by the plugin)</span><code>{plug.studio_version ?? "not reported"}</code></div>
          <div className="diag-kv"><span>Plugin version</span><code>{plug.plugin_version ?? "not reported"}</code></div>
          <div className="diag-kv"><span>Playtest running</span><code>{String(!!plug.playtest_active)}</code></div>
          <div className="diag-kv"><span>Session tainted (untrusted game content seen)</span><code>{String(!!plug.tainted)}{plug.taint_reason ? " : " + plug.taint_reason : ""}</code></div>
          <div className="diag-kv"><span>Commands in the last hour</span><code>{Object.keys(plug.commands_last_hour ?? {}).length ? Object.entries(plug.commands_last_hour).map(([k, v]) => k + " " + v).join(", ") : "none"}</code></div>
          <div className="diag-lbl">Features this Studio reported</div>
          <div className="diag-feats">{Object.keys(plug.studio_features ?? {}).length === 0 ? <span className="muted small">none reported (the plugin may be older than v4)</span>
            : Object.entries(plug.studio_features).map(([k, v]) => <span key={k} className={"chip " + (v ? "green" : "red")}>{v ? <CircleCheck size={12} /> : <CircleX size={12} />}{k}</span>)}</div>
          <div className="diag-lbl">Self-test results (press RUN SELF-TEST in the plugin's Settings tab)</div>
          {(plug.selftests ?? []).length === 0 && <p className="muted small">No self-test has been run yet. Nothing here is verified until it has.</p>}
          {(plug.selftests ?? []).slice(0, 2).map((t) => (
            <div key={t.id} style={{ marginBottom: 10 }}>
              <div className="diag-row"><span className={"chip " + (t.failed ? "red" : "green")}>{t.passed} passed, {t.failed} failed, {t.skipped} skipped</span>
                <span className="muted small">{new Date(t.created_at).toLocaleString()} | Studio {t.studio_version || "?"} | plugin v{t.plugin_version ?? "?"}</span></div>
              {(t.steps ?? []).map((st, i) => (
                <div key={i} className="diag-kv"><span>{st.name}</span>
                  <code style={{ color: st.status === "fail" ? "var(--red)" : st.status === "skip" || st.status === "fallback" ? "var(--amber)" : "var(--green)" }}>{st.status.toUpperCase()}{st.ms ? " " + st.ms + "ms" : ""}{st.error ? " : " + st.error : ""}</code></div>))}
            </div>))}
        </>)}
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
