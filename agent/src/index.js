import { api } from "./api.js";
import { clampIterations, handleUserMessage, attachmentContext } from "./loop.js";

// On boot, pick up any user message that has NO assistant reply yet (the user may have typed while the VM was starting).
// Then poll for new ones. Polling is the reliable path; the web app also polls, so no Realtime dependency.
let stopRequested = false;
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
    if (m.role === "system" && m.content === "__STOP__") { stopRequested = true; continue; }
    if (m.role !== "user") continue;
    if (firstRun && i < lastAssistantIdx) { history.push({ role: "user", content: m.content }); continue; }   // already answered earlier
    const sess = await api.data("session");
    await api.setState("thinking");
    let text = m.content || "";
    if (Array.isArray(m.attachment_ids) && m.attachment_ids.length) { try { text += attachmentContext(await api.attachments(m.attachment_ids)); } catch (e) { console.error("attachments:", e.message); } }
    if (!text.trim()) continue;
    try { stopRequested = false;
      await handleUserMessage(history.slice(-20), text, { messageId: m.id, maxIterations: clampIterations(sess?.max_iterations), shouldStop: async () => { const r = await api.messagesAfter(m.created_at); return Array.isArray(r) && r.some((x) => x.role === "system" && x.content === "__STOP__"); } }); }
    catch (e) { console.error("handle:", e.message); await api.say("assistant", "Agent error: " + String(e.message).slice(0, 200), null, "error"); }
    history.push({ role: "user", content: text });
  }
}
for (;;) { try { await tick(); } catch (e) { console.error("tick", e.message); } await new Promise((r) => setTimeout(r, 1500)); }
