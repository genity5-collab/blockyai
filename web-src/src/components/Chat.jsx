import React, { useEffect, useMemo, useRef, useState } from "react";
import Markdown, { textLen, parseBlocks } from "./Markdown.jsx";
import { Send, Camera, Play, Wrench, Hammer, MousePointerClick, Cuboid, Paperclip, X, FileText, Square, Loader2, Upload } from "lucide-react";
import { useApp } from "../lib/store.jsx"; import { cx } from "../lib/util.js"; import { CommandCard, BatchCard, OutcomeBadge } from "./Cards.jsx"; import ConfirmModal from "./ConfirmModal.jsx"; import Embeds from "./Embeds.jsx"; import { PlanCard, ShotStrip, ModeSwitch } from "./Build.jsx";

function Typewriter({ text, live }) {
  // The message is parsed as a whole and rendered as formatted blocks. The typing effect only limits how many visible characters are shown,
  // so a code fence or bold marker is never shown half-built.
  const total = React.useMemo(() => textLen(parseBlocks(text)), [text]);
  const [n, setN] = useState(live ? 0 : total);
  useEffect(() => { if (!live) { setN(total); return; } const t = setInterval(() => setN((x) => { if (x >= total) { clearInterval(t); return x; } return Math.min(total, x + Math.max(2, Math.ceil(total / 90))); }), 22); return () => clearInterval(t); }, [text, live, total]);
  return <><Markdown text={text} shown={n >= total ? undefined : n} />{n < total && <span className="caret" />}</>;
}
const CHIPS = [[Play, "Playtest", "Start a playtest and tell me what happens."], [Wrench, "Fix errors", "Look at the Output for errors and fix them."], [Camera, "Screenshot", null], [Hammer, "Build me a...", "Build me a "]];

export default function Chat() {
  const { data, send, stop, upload, agentBusy, queue, toast } = useApp(); const [files, setFiles] = useState([]); const [drag, setDrag] = useState(false); const fileIn = useRef(null); const [text, setText] = useState(""); const box = useRef(null); const end = useRef(null); const [confirm, setConfirm] = useState(null); const seen = useRef(new Set()); const first = useRef(true);
  const msgs = (data?.messages ?? []).filter((m) => m.role !== "system"); const cmds = data?.commands ?? []; const state = data?.session?.agent_state;
  const thinking = ["thinking", "working"].includes(state) && msgs[msgs.length - 1]?.role === "user" || state === "thinking";
  const pending = cmds.filter((c) => c.needs_confirm && !c.confirmed && c.status === "pending");
  useEffect(() => { if (pending[0] && !confirm) setConfirm(pending[0]); }, [pending[0]?.id]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs.length, msgs[msgs.length - 1]?.content, thinking, cmds.length]);
  useEffect(() => { msgs.forEach((m) => seen.current.add(m.id)); first.current = false; }, [msgs.length]);

  const attMeta = (id) => (data?.attachments ?? []).find((a) => a.id === id);
  const addFiles = async (list) => {
    for (const f of Array.from(list).slice(0, 6 - files.length)) {
      const tmp = { tmp: Math.random(), name: f.name || "pasted-image.png", kind: f.type?.startsWith("image/") ? "image" : "text", uploading: true, preview: f.type?.startsWith("image/") ? URL.createObjectURL(f) : null };
      setFiles((x) => [...x, tmp]);
      const r = await upload(f);
      if (r?.error) { toast(r.error, "error"); setFiles((x) => x.filter((y) => y.tmp !== tmp.tmp)); }
      else setFiles((x) => x.map((y) => (y.tmp === tmp.tmp ? { ...y, ...r, uploading: false } : y)));
    }
  };
  const submit = async () => {
    const t = text.trim(); const ready = files.filter((f) => f.id && !f.uploading);
    if (files.some((f) => f.uploading) || (!t && !ready.length)) return;
    const ok = await send(t, ready.map((f) => f.id));
    if (ok) { setText(""); setFiles([]); if (box.current) box.current.style.height = "auto"; }
    box.current?.focus();
  };
  const onPaste = (e) => { const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/")); if (imgs.length) { e.preventDefault(); addFiles(imgs); } };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); };
  const onKey = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); submit(); } };
  const useSel = async () => { const r = await queue("get_selection"); toast(r?.id ? "Asked Studio for your selection. Tell Blocky what to do with it." : "Could not request selection", r?.id ? "ok" : "error"); if (r?.id) setText((t) => (t ? t + " " : "") + "Use my current Studio selection: "); box.current?.focus(); };
  const chip = async (c) => { if (c[1] === "Screenshot") { const r = await queue("screenshot"); toast("Asked for a screenshot (Studio plugins may not allow this)", "warn"); return r; } if (c[1] === "Build me a...") { setText(c[2]); box.current?.focus(); } else send(c[2]); };
  const cmdsFor = (m) => (m.tool_calls ?? []).map((tc) => cmds.find((c) => c.id === tc.command_id) || tc);

  return (
    <div className="chat" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }} onDrop={onDrop}>
      {drag && <div className="dropzone"><Upload size={26} style={{ marginRight: 10 }} />DROP IMAGES OR FILES</div>}
      <div className="msgs" aria-live="polite" aria-label="Conversation">
        {msgs.length === 0 && (
          <div className="empty big"><div className="blocks"><Cuboid size={54} color="var(--blue)" /><Cuboid size={38} color="var(--violet)" /><Cuboid size={28} color="var(--green)" /></div>
            <h4>Say something to Blocky!</h4><p>Describe what you want in your game. Try "Add a spawn pad with a glowing neon edge".</p></div>)}
        {msgs.map((m) => m.role === "user" ? (
          <div key={m.id} className="msg user"><div className="bub user-b">
            {(m.attachment_ids ?? []).length > 0 && <div className="atts">{m.attachment_ids.map((id) => { const a = attMeta(id); return <div className="att" key={id}><span className="ai">{a?.kind === "image" ? <Camera size={18} /> : <FileText size={18} />}</span><span className="nm">{a?.name || "file"}<small>{a?.kind === "image" ? "image" : "file"}</small></span></div>; })}</div>}
            {m.content}</div></div>
        ) : (
          <div key={m.id} className="msg ai"><div className="av"><Cuboid size={18} /></div>
            <div className="bub ai-b">
              {m.content && <div className="txt"><Typewriter text={m.content} live={!first.current && !seen.current.has(m.id)} /></div>}
              {cmdsFor(m).map((c, i) => c.type === "batch" ? <BatchCard key={c.id || i} cmd={c} /> : <CommandCard key={c.id || i} cmd={c} />)}
              <Embeds list={m.embeds} />
              <OutcomeBadge outcome={m.outcome} />
            </div></div>))}
        <PlanCard /><ShotStrip />
        {thinking && <div className="msg ai"><div className="av"><Cuboid size={18} /></div><div className="bub ai-b"><div className="bounce" aria-label="Blocky is thinking"><i /><i /><i /></div></div></div>}
        <div ref={end} />
      </div>
      <div className="composer">
        <ModeSwitch />
        <div className="chips-row">{CHIPS.map((c) => <button key={c[1]} className="qchip" onClick={() => chip(c)}>{React.createElement(c[0], { size: 14 })}{c[1]}</button>)}
          <button className="qchip sel" onClick={useSel}><MousePointerClick size={14} />Use my Studio selection</button></div>
        {files.length > 0 && <div className="atts" style={{ padding: "0 4px" }}>{files.map((f) => <div className={"att" + (f.uploading ? " up" : "")} key={f.id || f.tmp}>
            {f.preview ? <img src={f.preview} alt="" /> : <span className="ai"><FileText size={18} /></span>}
            <span className="nm">{f.name}<small>{f.uploading ? "reading..." : f.kind === "image" ? "image ready" : "file ready"}</small></span>
            <button className="x" onClick={() => setFiles((x) => x.filter((y) => (y.id || y.tmp) !== (f.id || f.tmp)))} aria-label={"Remove " + f.name}><X size={14} /></button></div>)}</div>}
        <input ref={fileIn} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,.lua,.luau,.txt,.md,.json,.csv,.log,.xml,.html,.css,.js,.ts" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <div className="inbox"><button className="iconbtn" onClick={() => fileIn.current?.click()} disabled={files.length >= 6} aria-label="Attach image or file" title="Attach image or file"><Paperclip size={18} /></button><textarea ref={box} value={text} rows={1} onPaste={onPaste} placeholder={agentBusy ? "Blocky is working... type to change course or add something, it reads it right away" : "Tell Blocky what to build or fix..."} onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px"; }} onKeyDown={onKey} aria-label="Message" />
          {agentBusy && <button className="brick red send" onClick={stop} aria-label="Stop" title="Stop everything"><Square size={16} /></button>}
          <button className="brick green send" onClick={submit} disabled={!text.trim() && !files.some((f) => f.id)} aria-label={agentBusy ? "Send and change course" : "Send"} title={agentBusy ? "Send now: Blocky reads it at its next step" : "Send"}><Send size={18} /></button></div>
        <div className="hint small muted"><kbd>Enter</kbd> or <kbd>Ctrl Enter</kbd> to send &middot; <kbd>Shift Enter</kbd> new line</div>
      </div>
      {confirm && <ConfirmModal cmd={cmds.find((c) => c.id === confirm.id) || confirm} onClose={() => setConfirm(null)} />}
    </div>);
}
