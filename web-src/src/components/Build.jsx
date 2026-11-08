import React, { useEffect, useMemo, useState } from "react";
import LockedShot, { useShot, ShotTile } from "./LockedShot.jsx";
import { CheckCircle2, Circle, Loader2, Camera, Columns2, Gamepad2, MessageSquare, Package, Trash2, Copy, Check, ExternalLink, ShieldCheck, ListChecks } from "lucide-react";
import { useApp } from "../lib/store.jsx"; import { web } from "../lib/api.js"; import { cx } from "../lib/util.js";

// ---------- live plan checklist (shown in chat while the agent works) ----------
export function PlanCard() {
  const { data } = useApp(); const plan = data?.plan; if (!plan || !Array.isArray(plan.items) || !plan.items.length) return null;
  const done = plan.items.filter((i) => i.done).length, total = plan.items.length; const pct = Math.round((done / total) * 100);
  const live = plan.status === "active" && ["thinking", "working"].includes(data?.session?.agent_state);
  const firstOpen = plan.items.findIndex((i) => !i.done);
  return (
    <div className={cx("plan", plan.status)} role="group" aria-label={`Plan: ${done} of ${total} done`}>
      <div className="plan-h"><ListChecks size={16} color="var(--violet)" /><b>{plan.title || "Plan"}</b>
        <span className="mono muted">{done}/{total}</span><span className={"chip " + (plan.status === "complete" ? "green" : plan.status === "abandoned" ? "red" : "violet")}>{plan.status}</span></div>
      <div className="segs" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><i style={{ width: pct + "%" }} /></div>
      <ol className="plan-l">
        {plan.items.map((it, idx) => (
          <li key={it.id} className={cx(it.done && "done", it.verified && "ver", live && idx === firstOpen && "now")}>
            {it.done ? <CheckCircle2 size={15} color="var(--green)" /> : live && idx === firstOpen ? <Loader2 size={15} className="spin" color="var(--blue)" /> : <Circle size={15} color="var(--mute)" />}
            <span>{it.text}</span>{it.verified && <span className="chip green" title="Checked with a screenshot or playtest"><ShieldCheck size={11} />verified</span>}
            {it.note && <small className="muted">{it.note}</small>}
          </li>))}
      </ol>
    </div>);
}

// ---------- VM vs Studio badge for tool calls ----------
export function FamilyBadge({ family }) {
  if (!family || family === "local") return null;
  return <span className={"chip " + (family === "vm" ? "violet" : "blue")} title={family === "vm" ? "Ran in the private sandbox. Does not change your game." : "Changed (or read) your live Studio game."}>{family === "vm" ? "VM" : "STUDIO"}</span>;
}

// ---------- 3D progress strip + before/after slider ----------
export function ShotStrip() {
  const { data } = useApp(); const shots = data?.screenshots ?? []; const [sel, setSel] = useState(null); const [cmp, setCmp] = useState(false); const [pos, setPos] = useState(50);
  if (!shots.length) return null;
  const ordered = [...shots].reverse(); const first = ordered[0], last = ordered[ordered.length - 1]; const cur = sel ? shots.find((s) => s.id === sel) : last;
  // Screenshots are LOCKED until opened: showing one costs 2 tokens (charged by the server). Before/after opens two, so it costs 4.
  return (
    <div className="shotstrip" aria-label="Build progress screenshots">
      <div className="shot-h"><Camera size={15} color="var(--blue)" /><b>3D progress</b><span className="muted small">{shots.length} view{shots.length > 1 ? "s" : ""}</span>
        {ordered.length > 1 && <button className={cx("qchip", cmp && "on")} onClick={() => setCmp(!cmp)}><Columns2 size={14} />Before / after</button>}</div>
      {cmp && ordered.length > 1 ? (
        <BeforeAfter before={first} after={last} pos={pos} setPos={setPos} />
      ) : cur && <LockedShot key={cur.id} shot={{ ...cur, label: cur.label || "Latest view" }} />}
      <div className="thumbs">{ordered.map((s) => <button key={s.id} className={cx("th", cur?.id === s.id && "on")} onClick={() => { setCmp(false); setSel(s.id); }} title={s.label || "view"} aria-label={"Select view" + (s.label ? ": " + s.label : "")}><Camera size={16} aria-hidden="true" />{s.label ? <small>{s.label}</small> : <small>view</small>}</button>)}</div>
    </div>);
}
// Before/after needs both images, so it reveals both (2 tokens each).
function BeforeAfter({ before, after, pos, setPos }) {
  const a = useShot(after.id), b = useShot(before.id);
  if (!a.url || !b.url) return (
    <div className="ba-lock">
      <ShotTile state={a.state === "shown" && !b.url ? b.state : a.state} url={null} label="Before and after" msg={a.msg || b.msg} cost={4}
        onReveal={async () => { await Promise.all([a.reveal(), b.reveal()]); }} />
    </div>);
  return (
    <div className="ba" style={{ "--p": pos + "%" }}>
      <img src={a.url} alt="After" /><div className="ba-top"><img src={b.url} alt="Before" /></div>
      <span className="ba-l">BEFORE</span><span className="ba-r">AFTER</span><i className="ba-h" />
      <input type="range" min="0" max="100" value={pos} onChange={(e) => setPos(+e.target.value)} aria-label="Before and after slider" />
    </div>);
}

// ---------- Game Builder mode switch + quick-start cards ----------
export const GENRES = [
  ["obby", "Obby", "10 stages, checkpoints, timer GUI"], ["tycoon", "Tycoon", "Droppers, conveyor, upgrades, cash"], ["simulator", "Simulator", "Click to collect, pets, rebirth"],
  ["racing", "Racing", "Track, laps, vehicle seats, boost"], ["horror", "Horror", "Dark map, scares, flashlight, objectives"], ["rpg", "RPG", "Quests, NPCs, inventory, combat"], ["shooter", "Shooter", "Weapons, hit validation on the server, rounds"],
];
export function ModeSwitch() {
  const { data, patchSession, send, agentBusy, toast } = useApp(); const mode = data?.session?.mode || "chat"; const genre = data?.session?.genre;
  const set = (m) => patchSession({ mode: m });
  const start = async (g) => {
    if (agentBusy) return toast("Blocky is busy. Wait or press Stop.", "warn");
    await patchSession({ mode: "game", genre: g[0] });
    send(`Game Builder: make a complete ${g[1]} game. ${g[2]}. Follow the Game Builder steps: design doc in NOTES.md, scaffold, systems with linted scripts, world, playtest, then a report. Ask me at most 3 questions only if something blocks you.`);
  };
  return (
    <div className="modesw">
      <div className="seg2" role="tablist" aria-label="Chat mode">
        <button role="tab" aria-selected={mode === "chat"} className={cx(mode === "chat" && "on")} onClick={() => set("chat")}><MessageSquare size={14} />Chat</button>
        <button role="tab" aria-selected={mode === "game"} className={cx(mode === "game" && "on")} onClick={() => set("game")}><Gamepad2 size={14} />Game Builder</button>
      </div>
      {mode === "game" && <div className="genres" aria-label="Quick start">{GENRES.map((g) => <button key={g[0]} className={cx("gcard", genre === g[0] && "on")} onClick={() => start(g)} disabled={agentBusy}><b>{g[1]}</b><small>{g[2]}</small></button>)}</div>}
    </div>);
}

// ---------- Templates tab ----------
export function Templates() {
  const { sid, toast, send, agentBusy } = useApp(); const [list, setList] = useState(null);
  const load = async () => { const r = await web("templates_list", { session_id: sid }); setList(Array.isArray(r) ? r : []); };
  useEffect(() => { if (sid) load(); }, [sid]);
  const use = (t) => { if (agentBusy) return toast("Blocky is busy.", "warn"); send(`Use build_from_template with template "${t.name}" and place it somewhere sensible in my game. Verify it with screenshots.`); };
  const del = async (t) => { const r = await web("template_delete", { session_id: sid, name: t.name }); toast(r.error || `Deleted ${t.name}`, r.error ? "error" : "ok"); load(); };
  if (list === null) return <div className="pane"><div className="empty"><Loader2 className="spin" /></div></div>;
  return (
    <div className="pane"><div className="list">
      {list.length === 0 && <div className="empty"><Package size={34} color="var(--blue)" /><h4>No templates yet</h4><p>Ask Blocky to build something good, then say "save that as a template called tree".</p></div>}
      {list.map((t) => (
        <div className="tpl" key={t.id}><div className="tpl-i"><Package size={18} /></div>
          <div className="tpl-b"><b>{t.name}</b><small className="muted">{t.description || (t.kind === "game" ? "game scaffold" : "model")} &middot; {t.instance_count} parts</small></div>
          {t.builtin && <span className="chip blue">built-in</span>}
          <button className="brick sm" onClick={() => use(t)} disabled={agentBusy}>Use</button>
          {!t.builtin && <button className="iconbtn sm" onClick={() => del(t)} aria-label={"Delete " + t.name}><Trash2 size={15} /></button>}
        </div>))}
    </div></div>);
}
