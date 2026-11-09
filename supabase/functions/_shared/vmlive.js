// What the provider says about a session's computer, reduced to {live, gone}.
// gone = true ONLY when the provider clearly says it does not exist. A network error, a 5xx or a rate limit tells us nothing, so those stay "unknown".
const GONE_STATES = new Set(["deleted", "destroyed", "terminated"]);
export function liveStateOf(r) {
  const err = r && r.error;
  if (err) {
    const status = Number(err.status ?? err.statusCode) || null, code = String(err.code ?? ""), msg = String(err.message ?? err ?? "");
    if (status === 404 || /vm_not_found/i.test(code) || /not found|vm_not_found/i.test(msg)) return { live: "gone", gone: true };
    return { live: "unknown", gone: false };
  }
  const raw = r && r.data && typeof r.data.state === "string" ? r.data.state.trim().toLowerCase() : "";
  if (!/^[a-z_-]{2,20}$/.test(raw)) return { live: "unknown", gone: false };
  return { live: raw, gone: GONE_STATES.has(raw) };
}
