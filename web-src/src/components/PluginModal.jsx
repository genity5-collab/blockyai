import React, { useEffect, useState } from "react";
import { X, Download, Copy, Check, Hammer } from "lucide-react";
import { useApp } from "../lib/store.jsx";

export default function PluginModal({ onClose }) {
  const { toast } = useApp(); const [src, setSrc] = useState(""); const [copied, setCopied] = useState(false);
  useEffect(() => { fetch("/BlockyAI.lua").then((r) => r.text()).then(setSrc).catch(() => setSrc("-- could not load plugin")); }, []);
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const copy = async () => { await navigator.clipboard.writeText(src); setCopied(true); toast("Plugin code copied", "ok"); setTimeout(() => setCopied(false), 1800); };
  const download = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([src], { type: "text/plain" })); a.download = "BlockyAI.lua"; a.click(); };
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal glass hud" role="dialog" aria-modal="true" aria-label="Get the plugin" style={{ width: "min(760px,100%)" }}>
        <div className="modal-h"><Hammer size={20} color="var(--blue)" /><h3 style={{ margin: 0, flex: 1 }}>Get the BlockyAI plugin</h3><button className="iconbtn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-b">
          <ol className="how">
            <li><b>Download</b> the file below (or copy the code into a new Script).</li>
            <li>Save it as <span className="mono">BlockyAI.lua</span> in <span className="mono">%LOCALAPPDATA%\Roblox\Plugins</span> (Windows) or <span className="mono">~/Documents/Roblox/Plugins</span> (Mac). Restart Studio.</li>
            <li>Or: in Studio make a Script, paste the code, right-click it, <b>Save as Local Plugin</b>.</li>
            <li>Turn on <b>Game Settings, Security, Allow HTTP Requests</b>. Click the BlockyAI button in the Plugins tab and enter your code.</li>
          </ol>
          <div className="row" style={{ gap: 10, margin: "14px 0" }}>
            <button className="brick" onClick={download} disabled={!src}><Download size={16} />Download .lua</button>
            <button className="brick ghost" onClick={copy} disabled={!src}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Copy code"}</button>
          </div>
          <pre className="code mono" tabIndex={0}>{src ? src.slice(0, 1400) + (src.length > 1400 ? "\n-- ... (" + (src.length - 1400) + " more characters, use Download or Copy)" : "") : "Loading..."}</pre>
        </div>
      </div>
    </div>);
}
