import React from "react";
import Logo from "./Logo.jsx"; import JoinPanel from "./JoinPanel.jsx";

// Full-screen sign-in shown automatically to a brand-new visitor, before the plugin pairing screen (like a social app's login page).
// Pure view: App decides WHEN to show it (shouldShowGate); this only draws it.
export default function SignInGate({ busy, onDiscord, onSkip }) {
  return (
    <div className="landing" role="dialog" aria-modal="true" aria-label="Sign in to BlockyAI" style={{ justifyContent: "center" }}>
      <div className="hero">
        <div className="logo-wrap"><Logo size={96} spin /></div>
        <h1 className="title">Blocky<span>AI</span></h1>
        <p className="tag">Build Roblox games by talking to them.</p>
      </div>
      <div className="connect glass hud" style={{ maxWidth: 440, width: "100%" }}>
        <JoinPanel acct={null} busy={busy} onDiscord={onDiscord} onAnonymous={onSkip} />
      </div>
    </div>
  );
}
