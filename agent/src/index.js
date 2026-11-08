import { makeRunWatcher } from "./context.js";
// tools.js MUST load before tools-vm.js: the two import each other, and tools-vm.js loaded first leaves tools.js reading VM_EXTRA_TOOLS before it exists.
// WORK is defined in tools.js (tools-vm.js only imports it). test/phase7-entry.test.js starts this file for real, so a bad import here cannot reach a snapshot.
import { WORK } from "./tools.js";
import { fileMemory } from "./tools-vm.js";
import { findInterrupted, resumeNote, resumeAllowed } from "./resume.js";
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
  const interrupted = firstRun ? findInterrupted(msgs) : null;      // a request the agent started but never finished (VM restart / crash)
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]; cursor = m.created_at;
    if (handled.has(m.id)) continue; handled.add(m.id);
    if (m.role === "assistant") { history.push({ role: "assistant", content: m.content }); continue; }
    if (m.role === "system" && m.content === "__STOP__") { stopRequested = true; continue; }
    if (m.role !== "user") continue;
    const resuming = !!(interrupted && i === interrupted.index);
    if (resuming && !(await resumeAllowed(`${WORK}/.resume.json`, m.id))) {
      history.push({ role: "user", content: m.content });
      await api.say("assistant", "I was interrupted on your last request and could not resume it automatically. Tell me to continue and I will pick it up from the plan.", null, "idle", null, "incomplete"); continue;
    }
    if (firstRun && i < lastAssistantIdx && !resuming) { history.push({ role: "user", content: m.content }); continue; }   // already answered earlier
    const sess = await api.data("session");
    await api.setState("thinking");
    let text = m.content || "";
    if (Array.isArray(m.attachment_ids) && m.attachment_ids.length) { try { text += attachmentContext(await api.attachments(m.attachment_ids)); } catch (e) { console.error("attachments:", e.message); } }
    if (!text.trim()) continue;
    if (resuming) { let plan = null; try { plan = (await api.plan("get"))?.plan; } catch {} text += resumeNote(plan); }
    const watcher = makeRunWatcher({ fetchAfter: (c) => api.messagesAfter(c), since: m.created_at, handled });
    try { stopRequested = false;
      // One watcher serves Stop AND "the user typed something new while I was working" (read between steps, never lost, never run twice).
      await handleUserMessage(history.slice(-20), text, { messageId: m.id, maxIterations: clampIterations(sess?.max_iterations), shouldStop: watcher.shouldStop, memory: fileMemory, resume: resuming,
        pollNew: async () => { const out = []; for (const x of await watcher.takeFresh()) { let t = x.content || ""; if (Array.isArray(x.attachment_ids) && x.attachment_ids.length) { try { t += attachmentContext(await api.attachments(x.attachment_ids)); } catch {} } if (t.trim()) out.push({ id: x.id, text: t }); } return out; } }); }
    catch (e) { console.error("handle:", e.message); await api.say("assistant", "Agent error: " + String(e.message).slice(0, 200), null, "error"); }
    history.push({ role: "user", content: text });
    for (const x of watcher.taken) history.push({ role: "user", content: x.content || "" });   // messages the user typed mid-run, in order, so the next turn remembers them
  }
}
for (;;) { try { await tick(); } catch (e) { console.error("tick", e.message); } await new Promise((r) => setTimeout(r, 1500)); }
