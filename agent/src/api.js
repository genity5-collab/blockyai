// All VM -> backend traffic goes through the scoped agent-* edge functions.
// The VM only knows BLOCKY_AGENT_TOKEN (session-bound, short-lived). No service key, no Freestyle key, no LLM key.
import { readFileSync } from "node:fs";
function loadEnv() {
  const e = { ...process.env };
  try { for (const l of readFileSync("/etc/blockyai.env", "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) e[m[1]] = m[2]; } } catch {}
  return e;
}
export const ENV = loadEnv();
const base = ENV.BLOCKY_API, tok = ENV.BLOCKY_AGENT_TOKEN;
const H = { "Content-Type": "application/json", "x-agent-token": tok ?? "" };
async function call(path, opts = {}) {
  const r = await fetch(`${base}/${path}`, { ...opts, headers: { ...H, ...(opts.headers ?? {}) } });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { error: t.slice(0, 200) }; }
  if (!r.ok && !j.error) j.error = `http ${r.status}`;
  return j;
}
export const api = {
  messagesAfter: (after) => call(`agent-messages?after=${encodeURIComponent(after)}`),
  say: (role, content, tool_calls, state, embeds) => call("agent-messages", { method: "POST", body: JSON.stringify({ role, content, tool_calls, state, embeds }) }),
  update: (id, content, tool_calls, embeds, state) => call("agent-messages", { method: "POST", body: JSON.stringify({ id, content, tool_calls, embeds, state }) }),
  attachments: (ids) => call(`agent-data?kind=attachments&ids=${ids.join(",")}`),
  setState: (state) => call("agent-messages", { method: "POST", body: JSON.stringify({ state }) }),
  command: (type, payload) => call("agent-command", { method: "POST", body: JSON.stringify({ type, payload }) }),
  result: (id) => call(`agent-result?id=${id}`),
  data: (kind, limit = 100) => call(`agent-data?kind=${kind}&limit=${limit}`),
  plan: (action, body = {}) => call("agent-plan", { method: "POST", body: JSON.stringify({ action, ...body }) }),
  template: (action, body = {}) => call("agent-template", { method: "POST", body: JSON.stringify({ action, ...body }) }),
  logToolCall: (row) => call("agent-toolcall", { method: "POST", body: JSON.stringify(row) }),
  llm: (messages, model = "qwen-coder") => call("llm-proxy", { method: "POST", body: JSON.stringify({ model, messages, max_tokens: 3500 }) }),
};
