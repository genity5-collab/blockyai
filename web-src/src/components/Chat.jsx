import React, { useEffect, useMemo, useRef, useState } from "react";
import { Send, Camera, Play, Wrench, Hammer, MousePointerClick, Cuboid } from "lucide-react";
import { useApp } from "../lib/store.jsx"; import { cx } from "../lib/util.js"; import { CommandCard, BatchCard } from "./Cards.jsx"; import ConfirmModal from "./ConfirmModal.jsx";

function Typewriter({ text, live }) {
  const [n, setN] = useState(live ? 0 : text.length); const ref = useRef(text);
  useEffect(() => { if (!live) { setN(text.length); return; } const t = setInterval(() => setN((x) => { if (x >= text.length) { clearInterval(t); return x; } return Math.min(text.length, x + Math.max(2, Math.ceil((text.length - x) / 14))); }), 22); return () => clearInterval(t); }, [text, live]);
  return <>{text.slice(0, n)}{n < text.length && <span className="caret" />}</>;
}
const CHIPS = [[Play, "Playtest", "Start a playtest and tell me what happens."], [Wrench, "Fix errors", "Look at the Output for errors and fix them."], [Camera, "Screenshot", null], [Hammer, "Build me a...", "Build me a "]];

export default function Chat() {
  const { data, send, queue, toast } = useApp(); const [text, setText] = useState(""); const box = useRef(null); const end = useRef(null); const [confirm, setConfirm] = useState(null); const seen = useRef(new Set()); const first = useRef(true);
  const msgs = (data?.messages ?? []).filter((m) => m.role !== "system"); const cmds = data?.commands ?? []; const state = data?.session?.agent_state;
  const thinking = ["thinking", "working"].includes(state) && msgs[msgs.length - 1]?.role === "user" || state === "thinking";
  const pending = cmds.filter((c) => c.needs_confirm && !c.confirmed && c.status === "pending");
  useEffect(() => { if (pending[0] && !confirm) setConfirm(pending[0]); }, [pending[0]?.id]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs.length, msgs[msgs.length - 1]?.content, thinking, cmds.length]);
  useEffect(() => { msgs.forEach((m) => seen.current.add(m.id)); first.current = false; }, [msgs.length]);

  const submit = () => { const t = text.trim(); if (!t) return; setText(""); send(t); box.current?.focus(); };
  const onKey = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); submit(); } };
  const useSel = async () => { const r = await queue("get_selection"); toast(r?.id ? "Asked Studio for your selection. Tell Blocky what to do with it." : "Could not request selection", r?.id ? "ok" : "error"); if (r?.id) setText((t) => (t ? t + " " : "") + "Use my current Studio selection: "); box.current?.focus(); };
  const chip = async (c) => { if (c[1] === "Screenshot") { const r = await queue("screenshot"); toast("Asked for a screenshot (Studio plugins may not allow this)", "warn"); return r; } if (c[1] === "Build me a...") { setText(c[2]); box.current?.focus(); } else send(c[2]); };
  const cmdsFor = (m) => (m.tool_calls ?? []).map((tc) => cmds.find((c) => c.id === tc.command_id) || tc);

  return (
    <div className="chat">
      <div className="msgs" aria-live="polite" aria-label="Conversation">
        {msgs.length === 0 && (
          <div className="empty big"><div className="blocks"><Cuboid size={54} color="var(--blue)" /><Cuboid size={38} color="var(--violet)" /><Cuboid size={28} color="var(--green)" /></div>
            <h4>Say something to Blocky!</h4><p>Describe what you want in your game. Try "Add a spawn pad with a glowing neon edge".</p></div>)}
        {msgs.map((m) => m.role === "user" ? (
          <div key={m.id} className="msg user"><div className="bub user-b">{m.content}</div></div>
        ) : (
          <div key={m.id} className="msg ai"><div className="av"><Cuboid size={18} /></div>
            <div className="bub ai-b">
              {m.content && <div className="txt"><Typewriter text={m.content} live={!first.current && !seen.current.has(m.id)} /></div>}
              {cmdsFor(m).map((c, i) => c.type === "batch" ? <BatchCard key={c.id || i} cmd={c} /> : <CommandCard key={c.id || i} cmd={c} />)}
            </div></div>))}
        {thinking && <div className="msg ai"><div className="av"><Cuboid size={18} /></div><div className="bub ai-b"><div className="bounce" aria-label="Blocky is thinking"><i /><i /><i /></div></div></div>}
        <div ref={end} />
      </div>
      <div className="composer">
        <div className="chips-row">{CHIPS.map((c) => <button key={c[1]} className="qchip" onClick={() => chip(c)}>{React.createElement(c[0], { size: 14 })}{c[1]}</button>)}
          <button className="qchip sel" onClick={useSel}><MousePointerClick size={14} />Use my Studio selection</button></div>
        <div className="inbox"><textarea ref={box} value={text} rows={1} placeholder="Tell Blocky what to build or fix..." onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px"; }} onKeyDown={onKey} aria-label="Message" />
          <button className="brick green send" onClick={submit} disabled={!text.trim()} aria-label="Send"><Send size={18} /></button></div>
        <div className="hint small muted"><kbd>Enter</kbd> or <kbd>Ctrl Enter</kbd> to send &middot; <kbd>Shift Enter</kbd> new line</div>
      </div>
      {confirm && <ConfirmModal cmd={cmds.find((c) => c.id === confirm.id) || confirm} onClose={() => setConfirm(null)} />}
    </div>);
}
