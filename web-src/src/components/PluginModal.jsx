import React, { useEffect, useState } from "react";
import { X, Copy, Check, Hammer, ExternalLink } from "lucide-react";
import { useApp } from "../lib/store.jsx";
import { pluginUrl } from "../pluginAsset.js";

export default function PluginModal({ onClose }) {
  const { toast } = useApp(); const [src, setSrc] = useState(""); const [copied, setCopied] = useState(false);
  useEffect(() => { fetch("/BlockyAI.lua").then((r) => r.text()).then(setSrc).catch(() => setSrc("-- could not load plugin")); }, []);
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(src); }
    catch { const t = document.getElementById("plugin-src"); t.select(); document.execCommand("copy"); }
    setCopied(true); toast("Plugin code copied. Paste it into a Script in Studio.", "ok"); setTimeout(() => setCopied(false), 2200);
  };
  if (pluginUrl) return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal glass hud" role="dialog" aria-modal="true" aria-label="Install the plugin" style={{ width: "min(520px,100%)" }}>
        <div className="modal-h"><Hammer size={20} color="var(--blue)" /><h3 style={{ margin: 0, flex: 1 }}>Install the BlockyAI plugin</h3><button className="iconbtn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-b">
          <ol className="how"><li>Click <b>Install from Roblox</b> and press <b>Get</b> on the plugin page.</li><li>Open Studio, turn on <b>Game Settings, Security, Allow HTTP Requests</b>.</li><li>Open <b>BlockyAI</b> in the Plugins tab and enter your pairing code.</li></ol>
          <a className="brick xl green" style={{ width: "100%", margin: "14px 0 0", textDecoration: "none" }} href={pluginUrl} target="_blank" rel="noreferrer"><ExternalLink size={20} />Install from Roblox</a>
        </div></div></div>);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal glass hud" role="dialog" aria-modal="true" aria-label="Get the plugin" style={{ width: "min(780px,100%)" }}>
        <div className="modal-h"><Hammer size={20} color="var(--blue)" /><h3 style={{ margin: 0, flex: 1 }}>Get the BlockyAI plugin</h3><button className="iconbtn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-b">
          <ol className="how">
            <li>Click <b>Copy plugin code</b>.</li>
            <li>In Studio, add a <b>Script</b> (for example in ServerScriptService) and paste the code over everything in it.</li>
            <li>Right-click the Script, choose <b>Save as Local Plugin</b>, then confirm.</li>
            <li>Turn on <b>Game Settings, Security, Allow HTTP Requests</b>. Delete the Script, open the <b>BlockyAI</b> button in the Plugins tab and enter your code.</li>
          </ol>
          <button className="brick xl green" style={{ width: "100%", margin: "14px 0" }} onClick={copy} disabled={!src}>{copied ? <Check size={20} /> : <Copy size={20} />}{copied ? "Copied!" : "Copy plugin code"}</button>
          <textarea id="plugin-src" className="code mono" readOnly value={src || "Loading..."} onFocus={(e) => e.target.select()} spellCheck={false} aria-label="Plugin source code" style={{ width: "100%", height: 220, resize: "vertical" }} />
          <p className="muted small" style={{ margin: "8px 0 0" }}>{src ? src.length.toLocaleString() + " characters" : ""} &middot; The code only talks to BlockyAI and holds no secret keys.</p>
        </div>
      </div>
    </div>);
}
