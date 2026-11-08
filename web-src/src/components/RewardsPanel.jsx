import React from "react";
import { Coins, Gift, Check, X, Lock, Clock } from "lucide-react";
import { weekView } from "../lib/tokensui.js";

// Balance, the claim button and the Mon..Sun table. Missed days are shown as lost. Pure view: everything comes from props.
export default function RewardsPanel({ status, claiming, onClaim, onClose }) {
  if (!status) return null;
  const days = weekView(status.week, status.today?.canClaim), c = status.costs || {};
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label="Tokens and daily rewards" onClick={onClose}>
      <div className="modal glass hud" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><Coins size={18} color="var(--blue)" aria-hidden="true" /><b style={{ flex: 1 }}>Tokens</b><button className="iconbtn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-b" style={{ display: "grid", gap: 14 }}>
          <div className="row" style={{ gap: 10, alignItems: "baseline" }}><span className="num big-n">{status.balance}</span><span className="muted">/ {status.max} tokens</span></div>
          <div className="week" role="list" aria-label="This week's daily rewards">
            {days.map((d) => (
              <div key={d.name} role="listitem" className={"wd " + d.state} aria-label={`${d.name}: ${d.reward} tokens, ${d.state === "past" ? "missed" : d.state === "claimed" ? "claimed" : d.state === "today" ? "available today" : "upcoming"}`}>
                <span className="wd-n">{d.name}</span><b className="num">{d.reward}</b>
                <span className="wd-i" aria-hidden="true">{d.state === "claimed" ? <Check size={14} /> : d.state === "past" ? <Lock size={13} /> : d.state === "today" ? <Gift size={14} /> : <Clock size={13} />}</span>
              </div>))}
          </div>
          {status.today?.canClaim
            ? <button className="brick xl green" onClick={onClaim} disabled={claiming}><Gift size={20} />{claiming ? "Claiming…" : `Claim +${status.today.reward} tokens`}</button>
            : <p className="muted small">Today's reward is claimed. Come back tomorrow. Missed days can't be claimed later.</p>}
          <p className="muted small">Costs: {c.message} per message, +{c.per35Words} per 35 words, {c.aiMinute} per minute of AI work, {c.screenshot} per screenshot you view. You always get topped up to 5 each day.</p>
        </div>
      </div>
    </div>
  );
}
