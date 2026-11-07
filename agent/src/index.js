import { api } from "./api.js";
import { handleUserMessage } from "./loop.js";
// Listen for new user messages. Polling (Realtime is optional; polling is the reliable fallback).
let cursor = new Date().toISOString();
const history = [];
console.log("[blockyai-agent] started");
async function tick() {
  const sess = await api.data("session");
  const msgs = await api.messagesAfter(cursor);
  if (!Array.isArray(msgs)) return;
  for (const m of msgs) {
    cursor = m.created_at;
    if (m.role !== "user") continue;
    await api.setState("thinking");
    try { await handleUserMessage(history.slice(-20), m.content, { maxIterations: sess?.max_iterations ?? 12 }); }
    catch (e) { await api.say("assistant", "Agent error: " + String(e.message).slice(0, 200), null, "error"); }
    history.push({ role: "user", content: m.content });
  }
}
for (;;) { try { await tick(); } catch (e) { console.error("tick", e.message); } await new Promise((r) => setTimeout(r, 1500)); }
