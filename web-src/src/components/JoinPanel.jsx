import React from "react";
import { Plus, ShieldCheck, Sparkles } from "lucide-react";
import DiscordIcon from "./DiscordIcon.jsx";

// The "Ready when you are" panel on the landing page. Discord sign-in is the main way in; anonymous use stays available.
// Pure view: everything comes from props, so it renders and tests without a network.
//   acct: undefined = still loading, null = signed out, { name } = signed in
export default function JoinPanel({ acct, busy, onDiscord, onStart }) {
  if (acct === undefined) return <div className="center-col" aria-busy="true"><div className="label">Ready when you are</div><div className="skel" style={{ width: 260, height: 54, borderRadius: 14 }} /></div>;
  if (acct) {
    const name = String(acct.name ?? "").trim();
    return (
      <div className="center-col">
        <div className="label"><Sparkles size={15} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 6 }} />{name ? `Welcome back, ${name}` : "Welcome back"}</div>
        <button className="brick xl green" onClick={onStart} disabled={busy}><Plus size={20} />Start new session</button>
        <p className="muted small">You get a one-time code to link Roblox Studio. Your sessions stay with your Discord account.</p>
      </div>
    );
  }
  return (
    <div className="center-col">
      <div className="label">Sign in to continue</div>
      <button className="brick xl blue" onClick={onDiscord} disabled={busy}><DiscordIcon size={22} />{busy ? "Opening Discord…" : "Continue with Discord"}</button>
      <p className="muted small trust"><ShieldCheck size={15} aria-hidden="true" />Sign in to continue. Your sessions follow your account across devices. We only store your Discord name and avatar, never your email.</p>
    </div>
  );
}
