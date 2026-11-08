import React from "react";
import { Coins, Gift } from "lucide-react";
import { tokenTone } from "../lib/tokensui.js";

// The balance in the corner, with a gift dot when today's reward is waiting. Clicking opens the rewards panel.
// Pure view: everything comes from props.
export default function TokenChip({ status, onOpen }) {
  if (!status) return null;
  const tone = tokenTone(status.balance), waiting = !!status.today?.canClaim;
  return (
    <button className={"chip tokenchip " + (tone === "empty" ? "red" : tone === "low" ? "amber" : "blue")} onClick={onOpen} aria-label={`${status.balance} tokens${waiting ? ", daily reward available" : ""}. Open rewards`} title="Tokens and daily rewards">
      <Coins size={14} aria-hidden="true" /><span className="num">{status.balance}</span>
      {waiting && <Gift size={14} aria-hidden="true" className="gift-dot" />}
    </button>
  );
}
