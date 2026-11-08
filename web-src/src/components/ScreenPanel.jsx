import React, { useEffect, useRef, useState } from "react";
import { Monitor, ShieldAlert, Loader2, MousePointer2 } from "lucide-react";
import { useApp } from "../lib/store.jsx"; import { web } from "../lib/api.js";
import { screenState, nextDelay, frameSrc, ago } from "../lib/screenview.js";

// Asks the server for the AI's current screen. Only the newest picture is kept; a failed or hidden answer REPLACES the picture with a black frame,
// so an old picture can never stay on screen after the server says it is private. Polls fast while the AI works, slow when idle, very slowly when the tab is hidden.
export function useScreen(sid, working) {
  const [res, setRes] = useState(null); const [err, setErr] = useState(null); const seq = useRef(0); const [vis, setVis] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => { const f = () => setVis(!document.hidden); document.addEventListener("visibilitychange", f); return () => document.removeEventListener("visibilitychange", f); }, []);
  useEffect(() => {
    if (!sid) return; let stop = false, timer = null; seq.current = 0; setRes(null); setErr(null);
    const tick = async () => {
      const r = await web("screen_latest", { session_id: sid, since: seq.current }); if (stop) return;
      if (r.error && !r.seq) setErr(r.error);
      else {
        setErr(null);
        if (r.unchanged) setRes((p) => (p && p.shown !== false ? { ...p, ...r, image: p.image, mime: p.mime } : p));
        else { seq.current = r.shown === false ? 0 : r.seq || 0; setRes(r); }          // a hidden frame resets `since`, so the next picture is always fetched in full
      }
      const st = screenState(r.error && !r.seq ? null : r, { error: r.error && !r.seq ? r.error : null });
      timer = setTimeout(tick, nextDelay({ working, visible: typeof document === "undefined" || !document.hidden, kind: st.kind }));
    };
    tick(); return () => { stop = true; clearTimeout(timer); };
  }, [sid, working, vis]);
  return { res, err };
}

export default function ScreenPanel() {
  const { sid, data } = useApp(); const working = ["thinking", "working"].includes(data?.session?.agent_state);
  const { res, err } = useScreen(sid, working); const st = screenState(res, { error: err }); const src = st.kind === "live" ? frameSrc(res) : null;
  const [now, setNow] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setNow(Date.now()), 2000); return () => clearInterval(t); }, []);
  return (<div className="pane screenpane">
    <div className={"screen-frame " + (st.kind === "live" && src ? "live" : "dark")} role="img" aria-label={st.kind === "live" ? `The AI's screen: ${st.title || st.host || "a web page"}` : st.text}>
      {st.kind === "live" && src && <img src={src} alt="" draggable="false" />}
      {st.kind === "waiting" && <div className="screen-msg"><Monitor size={34} color="var(--blue)" /><h4>The AI's screen</h4><p>When the AI opens a website to look at designs or use a free tool, you'll watch it here, live.</p></div>}
      {st.kind === "private" && <div className="screen-msg fixing"><ShieldAlert size={34} color="var(--amber)" /><h4>Fixing it…</h4><p>The AI is on a page that may show something private, so this view is hidden. It will go back to a normal page by itself.</p>{st.hiddenFor && <span className="chip amber">{st.hiddenFor}</span>}</div>}
      {st.kind === "error" && <div className="screen-msg"><Loader2 size={30} className="spin" color="var(--blue)" /><h4>One moment…</h4><p>{st.text}</p></div>}
      {st.kind === "live" && !src && <div className="screen-msg"><Loader2 size={30} className="spin" color="var(--blue)" /></div>}
    </div>
    <div className="screen-foot">
      {st.activity ? <span className="screen-act"><MousePointer2 size={13} aria-hidden="true" /> {st.activity}</span> : <span className="muted small">Idle</span>}
      <span className="muted small screen-meta">{st.kind === "live" ? [st.host, res?.updated_at && ago(res.updated_at, now)].filter(Boolean).join(" · ") : st.kind === "private" && res?.updated_at ? ago(res.updated_at, now) : ""}</span>
    </div>
  </div>);
}
