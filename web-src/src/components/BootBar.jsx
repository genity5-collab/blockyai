import React, { useEffect, useRef, useState } from "react";
import { bootBar } from "../lib/screenview.js";

// The percentage while the AI's computer starts. The steps are the server's real ones (it records each one as it finishes); the bar only moves forward,
// creeps during a slow step, and shows 100 only once the server says ready. When it reaches 100 it stays a moment, then disappears.
export default function BootBar({ session, busy }) {
  const starting = session?.vm_status === "starting" || busy;
  const prev = useRef(0); const [now, setNow] = useState(Date.now()); const [gone, setGone] = useState(!starting);   // already starting when the page opens: show the bar at once, no empty first frame
  useEffect(() => { if (!starting) return; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, [starting]);
  const b = bootBar(starting ? { ...session, vm_status: "starting" } : session, prev.current, now);
  if (b && !b.done) prev.current = Math.max(prev.current, b.pct);
  useEffect(() => {
    if (b && !b.done) { setGone(false); return; }
    if (b?.done && !gone) { const t = setTimeout(() => { setGone(true); prev.current = 0; }, 1400); return () => clearTimeout(t); }
    if (!b) prev.current = 0;
  }, [b?.done, b?.pct, !!b]);
  if (gone || !b) return null;
  return (<div className={"bootbar" + (b.done ? " done" : "")} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={b.pct} aria-label="Starting the AI's computer">
    <span className="bb-label">{b.label}</span><span className="bb-track"><i className="bb-fill" style={{ width: b.pct + "%" }} /></span><span className="bb-pct">{b.pct}%</span></div>);
}
