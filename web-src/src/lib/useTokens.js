import { useEffect, useState, useCallback, useRef } from "react";
import { call } from "./api.js";
import { claimMessage } from "./tokensui.js";

// Token state for the signed-in user. The SERVER decides every price; this only asks and displays.
export function useTokens(signedIn, toast) {
  const [status, setStatus] = useState(null);       // null = not loaded / signed out
  const [claiming, setClaiming] = useState(false);
  const alive = useRef(true); useEffect(() => () => { alive.current = false; }, []);

  const refresh = useCallback(async () => { const r = await call("tokens", { action: "status" }); if (alive.current && !r?.error) setStatus(r); return r; }, []);
  useEffect(() => { if (signedIn) refresh(); else setStatus(null); }, [signedIn]);
  // The balance changes while the AI works (it is billed when a run ends), so refresh it now and then while the tab is open.
  useEffect(() => { if (!signedIn) return; const t = setInterval(() => { if (!document.hidden) refresh(); }, 20000); return () => clearInterval(t); }, [signedIn, refresh]);

  const claim = useCallback(async () => {
    setClaiming(true); const r = await call("tokens", { action: "claim" }); setClaiming(false);
    const m = claimMessage(r?.error && !r.reason ? null : r); toast?.(m.text, m.kind); await refresh(); return r;
  }, [refresh, toast]);

  // Show one screenshot: costs 2 tokens, charged by the server. Returns { url } or { error, out_of_tokens }.
  const viewScreenshot = useCallback(async (id) => {
    const view_id = (crypto.randomUUID?.() ?? String(Math.random()).slice(2)) + "";
    const r = await call("tokens", { action: "view_screenshot", id, view_id });
    if (typeof r?.balance === "number") setStatus((s) => (s ? { ...s, balance: r.balance } : s));
    return r;
  }, []);

  return { status, claiming, claim, refresh, viewScreenshot };
}
