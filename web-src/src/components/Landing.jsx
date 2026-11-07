import React, { useEffect, useRef, useState } from "react";
import { Download, Plug, KeyRound, Radar, Check, Plus, ArrowRight, Trash2, Clock } from "lucide-react";
import Logo from "./Logo.jsx"; import { useApp } from "../lib/store.jsx"; import { ago, cx } from "../lib/util.js";
import PluginModal from "./PluginModal.jsx";

function Tiles({ code }) {
  const chars = (code || "").padEnd(6, " ").split("");
  return <div className="tiles" aria-label="Pairing code">{chars.map((c, i) => <div key={i} className={cx("tile", c.trim() && "lit", i === (code || "").length && "next")}>{c.trim()}</div>)}</div>;
}
export default function Landing() {
  const { sessions, sid, data, pairing, createSession, refreshPairing, select, deleteSession, setPairing } = useApp();
  const [showPlugin, setShowPlugin] = useState(false);
  const [left, setLeft] = useState(0); const [burst, setBurst] = useState(false);
  const paired = !!data?.session?.plugin_connected_at;
  useEffect(() => { const t = setInterval(() => setLeft(pairing ? Math.max(0, Math.round((pairing.expires - Date.now()) / 1000)) : 0), 500); return () => clearInterval(t); }, [pairing]);
  useEffect(() => { if (paired) { setBurst(true); setTimeout(() => setBurst(false), 1800); } }, [paired]);
  const mm = String(Math.floor(left / 60)).padStart(2, "0") + ":" + String(left % 60).padStart(2, "0");
  const mine = (sessions ?? []).filter((s) => s.plugin_connected_at);

  return (
    <div className="landing">
      <div className="hero">
        <div className="logo-wrap"><Logo size={112} spin /></div>
        <h1 className="title">Blocky<span>AI</span></h1>
        <p className="tag">Build Roblox games by talking to them.</p>
      </div>

      <div className="steps">
        {[[Download, "Install plugin", "Download the plugin and drop it in your Studio Plugins folder.", <button className="brick sm" onClick={() => setShowPlugin(true)}><Download size={15} />Get Plugin</button>],
          [Plug, "Enable HTTP requests", "In Studio: Game Settings, Security, turn on Allow HTTP Requests.", null],
          [KeyRound, "Enter pairing code", "Open BlockyAI in Studio and type the 6 character code below.", null]].map(([I, h, p, extra], i) => (
          <div key={i} className="step glass hud" style={{ animationDelay: i * 120 + "ms" }}>
            <div className="step-n num">{i + 1}</div><I size={26} className="step-i" /><h3>{h}</h3><p>{p}</p>{extra}
          </div>))}
      </div>

      <div className="connect glass hud">
        {!sid || !pairing ? (
          <div className="center-col">
            <div className="label">Ready when you are</div>
            <button className="brick xl green" onClick={createSession}><Plus size={20} />Start new session</button>
            <p className="muted small">You get a one-time code to link Roblox Studio. No account needed.</p>
          </div>
        ) : burst || paired ? (
          <div className="connected"><div className="burst"><Check size={44} strokeWidth={3} /></div>
            <div className="label" style={{ color: "var(--green)" }}>Connected</div>
            <div className="place">{data?.session?.place_name || "Roblox Studio"}</div></div>
        ) : (
          <div className="center-col">
            <div className="label">Your pairing code</div>
            <Tiles code={pairing.code} />
            <div className="radar-row"><div className="radar"><i /><i /><i /><Radar size={18} /></div><span className="waiting">Waiting for Studio...</span>
              <span className={cx("chip", left < 60 ? "amber" : "blue")}><Clock size={13} /><span className="num">{left > 0 ? mm : "expired"}</span></span></div>
            {left === 0 && <button className="brick sm" onClick={refreshPairing}>New code</button>}
          </div>
        )}
      </div>

      {mine.length > 0 && (
        <div className="recent glass">
          <div className="label" style={{ padding: "10px 14px 4px" }}>Your sessions</div>
          {mine.map((s) => (
            <div key={s.id} className="rec">
              <button className="rec-main" onClick={() => select(s.id)}><span className="rec-t">{s.title}</span><span className="muted small">{s.place_name || "Studio"} &middot; {ago(s.created_at)}</span><ArrowRight size={16} /></button>
              <button className="iconbtn" aria-label="Delete session" onClick={() => confirm("Delete this session?") && deleteSession(s.id)}><Trash2 size={16} /></button>
            </div>))}
        </div>)}
      {showPlugin && <PluginModal onClose={() => setShowPlugin(false)} />}
    </div>
  );
}
