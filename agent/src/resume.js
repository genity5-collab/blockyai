// Background execution: if the agent or its VM was interrupted in the middle of a request the user already approved (by sending it),
// pick it up again instead of leaving a half-built game. Bounded: at most 2 automatic resumes per request, never after a Stop, never for old requests.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// msgs: the session's messages, oldest first. A request is "interrupted" when the agent started it (an assistant message exists after it)
// but its last assistant message has no outcome: finished runs always end with complete / incomplete / error / stopped.
export function findInterrupted(msgs, { now = Date.now(), maxAgeMs = 2 * 3600e3 } = {}) {
  const list = Array.isArray(msgs) ? msgs : []; let u = -1;
  list.forEach((m, i) => { if (m.role === "user" && !m.blocked) u = i; });
  if (u < 0) return null;
  const after = list.slice(u + 1);
  if (after.some((m) => m.role === "system" && m.content === "__STOP__")) return null;
  const assistants = after.filter((m) => m.role === "assistant"); if (!assistants.length) return null;     // never started: the normal "unanswered message" path handles it
  const last = assistants.at(-1);
  if (last.outcome) return null;                                                                         // finished
  if (/^Agent error:/.test(String(last.content ?? ""))) return null;                                    // crashed on purpose-reported error: do not loop on it
  if (now - Date.parse(list[u].created_at) > maxAgeMs) return null;
  return { index: u, message: list[u] };
}
export function resumeNote(plan) {
  const items = Array.isArray(plan?.items) ? plan.items : [];
  const list = items.length ? "\nYour plan right now:\n" + items.map((i) => `#${i.id} [${i.done ? "x" : " "}]${i.verified ? " (verified)" : ""} ${i.text}`).join("\n") : "\n(There is no saved plan.)";
  return `\n\n[RESUME] Your previous run on THIS request was interrupted (the VM or agent restarted) before it finished. Do NOT start over and do NOT repeat work that is already done. First read the real state of the game (roblox_get_tree / roblox_find) and compare it with the plan, then continue with what is left. If nothing is left, verify and finish.${list}`;
}
// Remember how many times a request was resumed, on the VM disk, so a request that keeps crashing the agent cannot resume forever.
export async function resumeAllowed(file, messageId, max = 2) {
  let st = {}; try { st = JSON.parse(await readFile(file, "utf8")); } catch {}
  const n = st.id === messageId ? Number(st.n) || 0 : 0;
  if (n >= max) return false;
  await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify({ id: messageId, n: n + 1 })); return true;
}
