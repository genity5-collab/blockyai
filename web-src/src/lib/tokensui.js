// Token UI helpers: pure functions (no React, no network) so they can be tested directly. Prices and rules live on the server; this only presents them.

// The Mon..Sun table. Days before today can never be claimed again; today is claimable once; later days are upcoming.
export function weekView(week, canClaimToday) {
  if (!Array.isArray(week)) return [];
  const todayIdx = week.findIndex((d) => d && d.today);
  return week.map((d, i) => {
    const state = todayIdx === -1 ? "upcoming" : i < todayIdx ? "past" : i === todayIdx ? (canClaimToday ? "today" : "claimed") : "upcoming";
    return { name: String(d?.name ?? ""), reward: Number(d?.reward) || 0, state, claimable: state === "today" };
  });
}

export const tokenTone = (n) => { const v = Number(n); return !Number.isFinite(v) || v <= 0 ? "empty" : v < 5 ? "low" : "ok"; };

export function claimMessage(r) {
  if (!r || typeof r !== "object") return { kind: "error", text: "Could not claim your reward. Please try again." };
  if (r.ok) return r.added > 0 ? { kind: "success", text: `+${r.added} tokens claimed` } : { kind: "info", text: "Your balance is full (100), nothing to add today" };
  switch (r.reason) {
    case "already_claimed": return { kind: "info", text: "You already claimed today's reward. Come back tomorrow." };
    case "missed": return { kind: "info", text: "That day has passed. Missed rewards can't be claimed." };
    case "not_yet": return { kind: "info", text: "That reward isn't available yet." };
    default: return { kind: "error", text: "Could not claim your reward. Please try again." };
  }
}
