// Discord login helpers for the site. Pure functions (no React, no network) so they can be tested directly.

const RESULTS = new Set(["ok", "cancelled", "expired", "failed"]);

// The server sends the browser back to /?login=ok#/route. Returns one of the four known values, or null for anything else.
export function readLoginResult(search) {
  try {
    if (typeof search !== "string") return null;
    const v = new URLSearchParams(search).get("login");
    return RESULTS.has(v) ? v : null;
  } catch { return null; }
}

// Same page with the ?login= parameter removed (other query params and the #hash route are kept) so a refresh doesn't show the message again.
export function cleanLoginUrl(pathname, search, hash) {
  const p = new URLSearchParams(search || ""); p.delete("login");
  const q = p.toString();
  return (pathname || "/") + (q ? "?" + q : "") + (hash || "");
}

export function loginMessage(result, name) {
  switch (result) {
    case "ok": return { kind: "success", text: name ? `Signed in as ${name}` : "Signed in with Discord" };
    case "cancelled": return { kind: "info", text: "Discord sign-in was cancelled" };
    case "expired": return { kind: "error", text: "That sign-in link expired. Please try again." };
    case "failed": return { kind: "error", text: "Discord sign-in failed. Please try again." };
    default: return null;
  }
}

export const initials = (name) => {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((w) => w[0].toUpperCase()).join("") : "?";
};

// An avatar is only ever shown if it comes from Discord's own CDN over https.
export const safeAvatar = (u) => (typeof u === "string" && /^https:\/\/cdn\.discordapp\.com\/avatars\/\d+\/[A-Za-z0-9_]+\.png(\?size=\d+)?$/.test(u) ? u : null);
