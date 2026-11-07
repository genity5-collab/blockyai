import React, { useEffect, useState } from "react";
import { X, Copy, Check, Hammer, ExternalLink, RefreshCw, History } from "lucide-react";
import { web } from "../lib/api.js";
import { useApp } from "../lib/store.jsx";
import { pluginUrl } from "../pluginAsset.js";

export default function PluginModal({ onClose }) {
  const { toast } = useApp(); const [src, setSrc] = useState(""); const [copied, setCopied] = useState(false);
  const [ver, setVer] = useState(null); const [rel, setRel] = useState(null); const [showRegen, setShowRegen] = useState(false);
  useEffect(() => { fetch("/plugin-version.json", { cache: "no-store" }).then((r) => r.json()).then(setVer).catch(() => setVer(null)); web("plugin_info").then((r) => { if (!r.error) setRel(r); }); }, []);
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
          {ver && <div className="verrow"><span className="chip blue">plugin v{ver.version}</span><span className="muted small">{ver.lines.toLocaleString()} lines &middot; built {new Date(ver.built_at).toLocaleString()}</span>
            {rel?.latest && rel.latest > ver.version && <span className="chip amber">server expects v{rel.latest}: rebuild and redeploy</span>}</div>}
          <ol className="how">
            <li>Click <b>Copy plugin code</b>.</li>
            <li>In Studio, add a <b>Script</b> (for example in ServerScriptService) and paste the code over everything in it.</li>
            <li>Right-click the Script, choose <b>Save as Local Plugin</b>, then confirm.</li>
            <li>Turn on <b>Game Settings, Security, Allow HTTP Requests</b>. Delete the Script, open the <b>BlockyAI</b> button in the Plugins tab and enter your code.</li>
            <li>For real screenshots, allow screenshot capture when Studio asks (once). If you decline, Blocky uses a text description of the scene instead.</li>
            <li>Updating? Paste the new code over the old plugin and Save as Local Plugin again. The plugin shows a yellow banner when a newer version exists, but it never downloads or runs code by itself.</li>
          </ol>
          <button className="brick xl green" style={{ width: "100%", margin: "14px 0" }} onClick={copy} disabled={!src}>{copied ? <Check size={20} /> : <Copy size={20} />}{copied ? "Copied!" : "Copy plugin code"}</button>
          <textarea id="plugin-src" className="code mono" readOnly value={src || "Loading..."} onFocus={(e) => e.target.select()} spellCheck={false} aria-label="Plugin source code" style={{ width: "100%", height: 220, resize: "vertical" }} />
          <button className="qchip" style={{ marginTop: 10 }} onClick={() => setShowRegen(!showRegen)}><RefreshCw size={14} />Regenerate plugin</button>
          {showRegen && <div className="regen"><p className="small" style={{ margin: "0 0 6px" }}>The plugin is built from tested source files, not by this button (a browser must never hold the key that commits to GitHub). To produce a new version:</p>
            <pre className="mono small">{"1. Edit plugin/src/*.luau and raise PLUGIN_VERSION in src/main.luau\n2. cd plugin && node build.mjs\n3. git push  (Render redeploys; this page then serves the new file)"}</pre>
            <p className="muted small" style={{ margin: "6px 0 0" }}>Currently deployed: {ver ? "v" + ver.version : "unknown"}. Ask Blocky's builder session (not this chat) to make the change and run those steps.</p></div>}
          {rel?.releases?.length > 0 && <div className="relist"><div className="label"><History size={13} /> Changelog</div>{rel.releases.slice(0, 6).map((r) => <div key={r.version} className="small"><b>v{r.version}</b> {r.label}<div className="muted">{r.changelog}</div></div>)}</div>}
          <p className="muted small" style={{ margin: "8px 0 0" }}>{src ? src.length.toLocaleString() + " characters" : ""} &middot; The code only talks to BlockyAI and holds no secret keys.</p>
        </div>
      </div>
    </div>);
}
