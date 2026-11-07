import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, FlaskConical, Play, Loader2, CircleCheck, CircleX, Circle } from "lucide-react";
import { useApp } from "../lib/store.jsx"; import { call } from "../lib/api.js"; import { cx } from "../lib/util.js";

// /#/capability. Five real build tests. A test shows PASS only when the server's judge says every rule is proven by recorded tool results.
// The agent's own words are never used. Needs Studio paired: without it Run reports the real reason.
export default function Capability() {
  const { sid, data, toast, agentBusy } = useApp();
  const [tests, setTests] = useState([]); const [state, setState] = useState({});   // id -> { message_id, verdict, error }
  const timers = useRef({});
  useEffect(() => { call("capability-test", { action: "list" }).then((r) => Array.isArray(r) && setTests(r)); return () => Object.values(timers.current).forEach(clearInterval); }, []);
  const back = () => { location.hash = ""; };
  const connected = !!data?.session?.plugin_connected_at;

  const poll = (id, message_id) => {
    clearInterval(timers.current[id]);
    const tick = async () => {
      const v = await call("capability-test", { action: "verdict", session_id: sid, test: id, message_id });
      setState((s) => ({ ...s, [id]: { ...s[id], verdict: v.error ? null : v, error: v.error } }));
      if (v.error || (!v.running && v.tool_calls > 0)) clearInterval(timers.current[id]);
    };
    tick(); timers.current[id] = setInterval(tick, 2500);
  };
  const run = async (id) => {
    const r = await call("capability-test", { action: "run", session_id: sid, test: id });
    if (r.error) { setState((s) => ({ ...s, [id]: { error: r.error } })); return toast(r.error, r.busy ? "warn" : "error"); }
    setState((s) => ({ ...s, [id]: { message_id: r.message_id, verdict: null } })); poll(id, r.message_id);
  };
  const passCount = Object.values(state).filter((s) => s.verdict?.pass).length;

  return (
    <div className="diag">
      <div className="diag-top"><button className="iconbtn" onClick={back} aria-label="Back"><ArrowLeft size={18} /></button>
        <h2><FlaskConical size={22} color="var(--blue)" /> Capability tests</h2><span className="chip blue" style={{ marginLeft: "auto" }}>{passCount}/{tests.length} passed</span></div>
      <p className="muted small" style={{ margin: "0 4px 12px" }}>Each test sends a real build request to Blocky and then checks the recorded tool results. A test passes only if every rule below is proven. Studio must be open and paired.</p>
      {!sid && <div className="glass hud diag-card"><p>Open a session first, then come back.</p></div>}
      {sid && !connected && <div className="glass hud diag-card"><span className="chip amber">Studio not paired</span><p className="small muted" style={{ marginTop: 8 }}>These tests build in a real game. Pair the plugin from the home screen. Running now would report the real error.</p></div>}
      {tests.map((t) => { const st = state[t.id] || {}; const v = st.verdict; const running = v?.running || (st.message_id && !v);
        return (
          <div className="glass hud diag-card" key={t.id}>
            <div className="diag-row"><b>{t.title}</b>
              {v?.ran && !v.running && (v.pass ? <span className="chip green"><CircleCheck size={14} />PASS</span> : <span className="chip red"><CircleX size={14} />FAIL</span>)}
              {running && <span className="chip violet"><Loader2 size={13} className="spin" />running</span>}
              {!st.message_id && !st.error && <span className="chip">not run</span>}
              <button className="brick sm green" style={{ marginLeft: "auto" }} onClick={() => run(t.id)} disabled={!sid || !connected || agentBusy}><Play size={14} />Run</button></div>
            <p className="small muted" style={{ margin: "6px 0" }}>{t.prompt}</p>
            {st.error && <pre className="diag-raw err">{st.error}</pre>}
            {v && <ul className="rules">{v.rules.map((r) => (
              <li key={r.id} className={cx(r.pass ? "ok" : "bad")}>{r.pass ? <CircleCheck size={14} color="var(--green)" /> : v.running ? <Circle size={14} color="var(--mute)" /> : <CircleX size={14} color="var(--red)" />}
                <span>{r.text}</span><code className="muted">{r.evidence}</code></li>))}</ul>}
            {v && <div className="small muted">{v.tool_calls} tool call(s) recorded for this prompt</div>}
          </div>); })}
    </div>);
}
