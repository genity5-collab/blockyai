// Turns a failure to start the AI's computer into a plain reason for the user. The provider's own text (billing, quota names) is never shown.
//   capacity: the provider has no room for us right now (quota or rate limit). Trying again will not help soon.
//   busy:     a short hiccup (timeout, network, 5xx). Trying again is worth it.
//   agent:    the computer started but the AI program on it did not.
//   error:    anything else.
const MSG = {
  capacity: "The AI computer can't start right now because the service is at capacity. Please try again later.",
  busy: "The AI computer is taking longer than usual to start. Trying again in a moment.",
  agent: "The AI computer started but the AI did not wake up. Trying again.",
  error: "The AI computer could not start. Please try again in a minute.",
};
export function explainVmError(err) {
  let text = "", status = null, code = "";
  try { if (err && typeof err === "object") { text = String(err.message ?? ""); status = Number(err.status ?? err.statusCode) || null; code = String(err.code ?? ""); } else text = String(err ?? ""); } catch { text = ""; }
  const t = text.toLowerCase();
  let reason = "error";
  if (status === 429 || /limit_exceeded/i.test(code) || /limit_exceeded|allowance|quota|rate.?limit|\b429\b/.test(t)) reason = "capacity";
  else if (/agent service failed/.test(t)) reason = "agent";
  else if (status === 502 || status === 503 || status === 504 || /fetch failed|timed? ?out|timeout|econnreset|econnrefused|enotfound|socket|network|unavailable|bad gateway/.test(t)) reason = "busy";
  return { reason, retry: reason !== "capacity", message: MSG[reason] };
}
