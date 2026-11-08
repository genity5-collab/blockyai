import React from "react";
import { LogIn, LogOut } from "lucide-react";
import { useAccountCtx } from "../lib/accountContext.jsx";
import { initials, safeAvatar } from "../lib/login.js";

// Sign in with Discord. Optional: the app works anonymously. Signing in links this browser to an account so its sessions follow it to other devices.
export default function Account() {
  const { acct, busy, signIn, signOut } = useAccountCtx();
  return <AccountView acct={acct} busy={busy} onSignIn={signIn} onSignOut={signOut} />;
}

// Pure view: everything it shows comes from props, so it can be rendered and tested without a network.
export function AccountView({ acct, busy, onSignIn, onSignOut }) {
  if (acct === undefined) return <span className="chip hide-sm" aria-busy="true" style={{ opacity: 0.5 }}>…</span>;
  if (!acct) return <button className="brick sm blue" onClick={onSignIn} disabled={busy} title="Sign in with Discord to keep your sessions across devices"><LogIn size={14} />{busy ? "Opening Discord…" : "Sign in"}</button>;
  const av = safeAvatar(acct.avatar_url);
  return (
    <span className="chip" title={`Signed in with Discord as ${acct.name}`} style={{ gap: 8 }}>
      {av ? <img src={av} alt="" width={20} height={20} style={{ borderRadius: "50%" }} /> : <b aria-hidden="true" style={{ display: "inline-grid", placeItems: "center", width: 20, height: 20, borderRadius: "50%", background: "var(--s2)", fontSize: 10 }}>{initials(acct.name)}</b>}
      <span className="hide-sm" style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acct.name}</span>
      <button className="iconbtn" style={{ width: 24, height: 24 }} onClick={onSignOut} disabled={busy} title="Sign out on this browser" aria-label="Sign out"><LogOut size={13} /></button>
    </span>
  );
}
