import React, { useState } from "react";
import { Lock, Coins, ImageOff } from "lucide-react";
import { useTokensCtx } from "../lib/tokensContext.jsx";

// A screenshot the site has not shown yet. Showing it costs tokens (charged by the server); the image is kept in memory while the page stays open,
// so looking at it again in this visit is free. Reloading the page and opening it again charges again.
const cache = new Map();   // screenshot id -> signed url, for THIS page visit only

export function useShot(id) {
  const { viewScreenshot } = useTokensCtx();
  const [url, setUrl] = useState(() => cache.get(id) ?? null);
  const [state, setState] = useState(cache.has(id) ? "shown" : "locked");   // locked | loading | shown | broke | out
  const [msg, setMsg] = useState("");
  const reveal = async () => {
    if (state === "loading" || url) return url;
    setState("loading"); const r = await viewScreenshot(id);
    if (r?.url) { cache.set(id, r.url); setUrl(r.url); setState("shown"); return r.url; }
    if (r?.out_of_tokens) { setState("out"); setMsg(r.error || "Credits Usage Limit Reached. Come Back Tomorrow."); return null; }
    setState("broke"); setMsg(r?.error || "Could not load this screenshot"); return null;
  };
  return { url, state, msg, reveal };
}

// Pure view of one tile.
export function ShotTile({ state, url, label, msg, onReveal, cost = 2 }) {
  if (state === "shown" && url) return <img className="shot-big" src={url} alt={label || "Screenshot"} />;
  const out = state === "out", broke = state === "broke";
  return (
    <button className={"shot-lock" + (out ? " out" : "")} onClick={onReveal} disabled={state === "loading" || out} aria-label={out ? msg : `Show screenshot${label ? ": " + label : ""} for ${cost} tokens`}>
      {broke ? <ImageOff size={22} aria-hidden="true" /> : <Lock size={22} aria-hidden="true" />}
      <b>{out ? "Out of tokens" : broke ? "Try again" : state === "loading" ? "Loading…" : "Show screenshot"}</b>
      <span className="muted small">{out ? msg : broke ? msg : <><Coins size={12} aria-hidden="true" style={{ verticalAlign: "-1px" }} /> {cost} tokens</>}</span>
    </button>
  );
}

export default function LockedShot({ shot }) {
  const { url, state, msg, reveal } = useShot(shot.id);
  return <ShotTile state={state} url={url} label={shot.label} msg={msg} onReveal={reveal} />;
}
