// Signed image links, cached per picture so polling and re-renders never ask the server twice.
// A link lasts 1 hour; we reuse it for 50 minutes. Concurrent requests for the same id share one network call.
const TTL = 50 * 60 * 1000; const cache = new Map(); const inflight = new Map();
export function mediaUrl(web, sessionId, id) {
  const key = sessionId + ":" + id; const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return Promise.resolve(hit.v);
  if (inflight.has(key)) return inflight.get(key);
  const p = web("media_url", { session_id: sessionId, id }).then((r) => {
    inflight.delete(key);
    if (r && r.url) { cache.set(key, { t: Date.now(), v: r }); return r; }
    throw new Error((r && r.error) || "image unavailable");
  }, (e) => { inflight.delete(key); throw e; });
  inflight.set(key, p); return p;
}
export const forgetMedia = (sessionId, id) => cache.delete(sessionId + ":" + id);
export const _clear = () => { cache.clear(); inflight.clear(); };
