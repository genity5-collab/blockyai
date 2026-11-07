// Anonymous identity. A real auth provider can later replace identity() and send a JWT instead of x-client-key.
const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
export function identity() {
  let id = localStorage.getItem("blocky_client_id"), key = localStorage.getItem("blocky_client_key");
  if (!id || !key || key.length < 24) { id = crypto.randomUUID(); key = rand(24); localStorage.setItem("blocky_client_id", id); localStorage.setItem("blocky_client_key", key); }
  return { id, key };
}
export async function call(path, body, method = "POST", qs = "") {
  const { id, key } = identity();
  const t0 = performance.now();
  let r; try { r = await fetch(`/api/${path}${qs}`, {
    method, headers: { "Content-Type": "application/json", "x-client-key": key },
    body: method === "GET" ? undefined : JSON.stringify({ client_id: id, ...body }),
  }); } catch (e) { return { error: "Can't reach the server. Check your connection.", __ms: null }; }
  const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = { error: text.slice(0, 200) }; }
  if (!r.ok && !j.error) j.error = `http ${r.status}`;
  j.__ms = Math.round(performance.now() - t0);
  return j;
}
export const web = (action, body = {}) => call("web-api", { action, ...body });
export const vm = {
  start: (session_id) => call("vm-start", { session_id }),
  stop: (session_id, mode = "suspend") => call("vm-stop", { session_id, mode }),
};
