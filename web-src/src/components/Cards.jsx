import React, { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import Icon from "./Icon.jsx"; import { FamilyBadge } from "./Build.jsx"; import { web } from "../lib/api.js"; import { CMD_META, cx } from "../lib/util.js"; import { useApp } from "../lib/store.jsx";

const target = (c) => { const p = c.payload || c.args || {}; return p.path || p.name || p.parent || p.label || p.query || p.class || ""; };
export function CommandCard({ cmd }) {
  const [open, setOpen] = useState(false); const type = cmd.type || (cmd.name || "").replace(/^roblox_/, ""); const fam = cmd.family || (/^vm_|^sync_mirror$|^push_changed$/.test(cmd.name || "") ? "vm" : (cmd.name || "").startsWith("roblox_") || cmd.type ? "roblox" : null); const [ic, label] = CMD_META[type] || ["Box", type];
  const status = cmd.status || "queued"; const st = status === "pending" ? "queued" : status;
  return (
    <div className={cx("cmd", st)}>
      <button className="cmd-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="stripe" /><Icon name={ic} size={16} /><b>{label}</b><FamilyBadge family={fam} /><span className="mono cmd-t">{target(cmd)}</span>
        <span className="cmd-s label">{st}</span><ChevronDown size={15} className={open ? "rot" : ""} />
      </button>
      {open && <div className="cmd-b">
        <div className="label">Payload</div><pre className="mono">{JSON.stringify(cmd.payload ?? cmd.args ?? {}, null, 2)}</pre>
        {cmd.result != null && <><div className="label">Result</div><pre className="mono">{JSON.stringify(cmd.result, null, 2).slice(0, 2500)}</pre></>}
        {cmd.error && <><div className="label" style={{ color: "var(--red)" }}>Error</div><pre className="mono err">{cmd.error}</pre></>}
      </div>}
    </div>);
}
export function BatchCard({ cmd }) {
  const { sid } = useApp(); const list = cmd.payload?.commands ?? []; const total = Math.max(1, list.length);
  const done = cmd.status === "done" ? total : cmd.status === "running" ? Math.min(total - 1, cmd.result?.progress ?? Math.floor(total / 2)) : cmd.status === "failed" ? cmd.result?.progress ?? 0 : 0;
  const cancel = (id) => web("cancel_command", { session_id: sid, command_id: id });
  return (
    <div className={cx("cmd batch", cmd.status === "pending" ? "queued" : cmd.status)}>
      <div className="cmd-h static"><span className="stripe" /><Icon name="Layers" size={16} /><b>Batch</b><span className="mono cmd-t">{total} operations</span><span className="cmd-s label">{cmd.status === "pending" ? "queued" : cmd.status}</span>
        {["pending", "running"].includes(cmd.status) && <button className="brick sm red" onClick={() => cancel(cmd.id)}><X size={13} />Cancel</button>}</div>
      <div className="segs" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>{Array.from({ length: Math.min(total, 40) }, (_, i) => <i key={i} className={cx(i < done && "on", i === done && cmd.status === "running" && "cur", cmd.status === "failed" && i === done && "bad")} style={{ transitionDelay: i * 25 + "ms" }} />)}</div>
    </div>);
}
