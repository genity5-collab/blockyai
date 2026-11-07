import { api } from "./api.js";
import { handleUserMessage } from "./loop.js";

// On boot, pick up any user message that has NO assistant reply yet (the user may have typed while the VM was starting).
// Then poll for new ones. Polling is the reliable path; the web app also polls, so no Realtime dependency.
const history = [];
const handled = new Set();
let cursor = "1970-01-01T00:00:00Z";
console.log("[blockyai-agent] started");

async function tick() {
  const msgs = await api.messagesAfter(cursor);
  if (!Array.isArray(msgs)) { if (msgs?.error) console.error("messages:", msgs.error); return; }
  // First pass after boot: replay history into context, and only ANSWER the trailing unanswered user message(s).
  const firstRun = cursor.startsWith("1970");
  let lastAssistantIdx = -1; msgs.forEach((m, i) => { if (m.role === "assistant") lastAssistantIdx = i; });
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]; cursor = m.created_at;
    if (handled.has(m.id)) continue; handled.add(m.id);
    if (m.role === "assistant") { history.push({ role: "assistant", content: m.content }); continue; }
    if (m.role !== "user") continue;
    if (firstRun && i < lastAssistantIdx) { history.push({ role: "user", content: m.content }); continue; }   // already answered earlier
    const sess = await api.data("session");
    await api.setState("thinking");
    try { await handleUserMessage(history.slice(-20), m.content, { maxIterations: sess?.max_iterations ?? 12 }); }
    catch (e) { console.error("handle:", e.message); await api.say("assistant", "Agent error: " + String(e.message).slice(0, 200), null, "error"); }
    history.push({ role: "user", content: m.content });
  }
}
for (;;) { try { await tick(); } catch (e) { console.error("tick", e.message); } await new Promise((r) => setTimeout(r, 1500)); }
