import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { web, vm, identity } from "./api.js";
import { blip, store as ls } from "./util.js";

const Ctx = createContext(null); export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [sessions, setSessions] = useState(null);
  const [sid, setSid] = useState(() => ls.get("sid", null));
  const [data, setData] = useState(null);         // last poll payload
  const [ping, setPing] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [pairing, setPairing] = useState(null);   // {code, expires}
  const [vmBusy, setVmBusy] = useState(false);
  const [stats, setStats] = useState({ started: Date.now() });
  const seenCmd = useRef(new Map()); const vmTry = useRef(0);
  const sidRef = useRef(sid); sidRef.current = sid;

  const toast = useCallback((text, kind = "info") => { const id = Math.random(); setToasts((t) => [...t.slice(-3), { id, text, kind }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200); }, []);

  const loadSessions = useCallback(async () => { const r = await web("sessions_list"); if (Array.isArray(r)) setSessions(r); return r; }, []);
  useEffect(() => { identity(); loadSessions(); }, [loadSessions]);

  // Cursor poll. Fast while the agent works, slower when idle, paused when the tab is hidden.
  useEffect(() => {
    if (!sid) { setData(null); return; }
    let stop = false, timer;
    const tick = async () => {
      if (stop) return;
      if (!document.hidden) {
        const r = await web("poll", { session_id: sid });
        if (stop) return;
        if (r.error) { if (/not found/.test(r.error)) { ls.set("sid", null); setSid(null); loadSessions(); } }
        else {
          setPing(r.__ms); setData(r);
          for (const c of r.commands ?? []) {                       // blips + toasts when a command finishes
            const prev = seenCmd.current.get(c.id);
            if (prev && prev !== c.status && (c.status === "done" || c.status === "failed")) { blip(c.status === "done" ? "done" : "fail"); if (c.status === "failed") toast(`${c.type} failed${c.error ? ": " + c.error.slice(0, 60) : ""}`, "error"); }
            seenCmd.current.set(c.id, c.status);
          }
        }
      }
      const busy = ["thinking", "working"].includes(data?.session?.agent_state);
      timer = setTimeout(tick, document.hidden ? 4000 : busy ? 900 : 1600);
    };
    tick(); return () => { stop = true; clearTimeout(timer); };
    // eslint-disable-next-line
  }, [sid]);

  const select = (id) => { ls.set("sid", id); setSid(id); setData(null); };
  const createSession = async () => {
    const r = await web("session_create"); if (r.error) return toast(r.error, "error");
    setPairing({ code: r.pairing_code, expires: Date.now() + r.expires_in * 1000 }); await loadSessions(); select(r.session.id); return r;
  };
  const refreshPairing = async () => { if (!sid) return; const r = await web("pairing_refresh", { session_id: sid }); if (r.pairing_code) setPairing({ code: r.pairing_code, expires: Date.now() + r.expires_in * 1000 }); else if (r.error) toast(r.error, "error"); };
  const deleteSession = async (id) => { await web("session_delete", { session_id: id }); if (id === sid) { ls.set("sid", null); setSid(null); } loadSessions(); };

  // Hidden-but-visible-in-chip VM control: start / resume / restart automatically.
  const ensureVm = useCallback(async (force = false) => {
    const id = sidRef.current; if (!id || vmBusy) return; setVmBusy(true);
    try {
      const st = await web("vm_status", { session_id: id }); const db = st.vm_status, live = st.freestyle_state;
      if (!force && db === "running" && live === "running") return;
      if (force || db === "error" || (db === "running" && live && !["running", "starting"].includes(live))) await vm.stop(id, "destroy");
      const r = await vm.start(id); if (r.error) toast("VM is warming up...", "warn");
    } finally { setVmBusy(false); }
  }, [vmBusy, toast]);

  const send = async (text) => {
    if (!sid || !text.trim()) return; ensureVm();
    const r = await web("send_message", { session_id: sid, content: text }); if (r.error) toast(r.error, "error");
    loadSessions();
  };
  const patchSession = async (patch) => { const r = await web("session_update", { session_id: sid, patch }); if (!r.error) setData((d) => d && { ...d, session: r }); };
  const queue = async (type, payload = {}) => { const r = await web("queue", { session_id: sid, type, payload }); if (r.error) toast(r.error, "error"); return r; };

  // Auto-resume: if the VM was suspended/errored and the user is on a live chat, bring it back.
  useEffect(() => { const s = data?.session; if (!s || vmTry.current > 2) return;
    if (s.plugin_connected_at && ["suspended", "error", "stopped"].includes(s.vm_status) && ["thinking", "working"].includes(s.agent_state)) { vmTry.current++; ensureVm(); } }, [data?.session?.vm_status, data?.session?.agent_state]);

  const value = { sessions, sid, data, ping, toasts, pairing, setPairing, stats, toast, select, createSession, refreshPairing, deleteSession, loadSessions, ensureVm, vmBusy, send, patchSession, queue };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
