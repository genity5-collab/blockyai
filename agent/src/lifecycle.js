// Run lifecycle decisions that must not depend on the model's good behaviour.
//
//  - isMutatingTool: did this tool change the game? Built on the SAME read-only list the server uses (supabase/functions/_shared/policy.js),
//    so the agent and the server can never disagree about what counts as an edit. Unknown tool names count as mutating (fail safe).
//  - currentTurn: the user message this run is answering (plan_create stamps it on the plan so a plan can be tied to its message).
import { READ_ONLY } from "../../supabase/functions/_shared/policy.js";

export const currentTurn = { messageId: null };
// A short line the screen shows once in its activity text (for example "Noted: ..." when the AI saves something to memory), so the user can watch it take notes.
export const screenNote = { text: "" };

// Tools that are not Studio commands at all (VM, planning, local search). They never change the game.
const NON_STUDIO = /^(vm_|plan_|local_|sync_mirror$)/;
// Agent tool name -> Studio command type. "roblox_get_tree" -> "get_tree"; bare names (build_model, mirror, ...) are already command types.
const toCommand = (name) => String(name).replace(/^roblox_/, "");
// roblox_get_edit_log reads the website's edit log, not Studio.
const EXTRA_READ = new Set(["get_edit_log"]);
// push_changed sends scripts INTO Studio (it is a VM tool name, but it mutates the game).
const VM_BUT_MUTATING = new Set(["push_changed"]);

export function isMutatingTool(name) {
  const n = String(name ?? "");
  if (VM_BUT_MUTATING.has(n)) return true;
  if (NON_STUDIO.test(n)) return false;
  const c = toCommand(n);
  if (EXTRA_READ.has(c)) return false;
  if (c === "playtest_start") return false;         // a test run reads the game; it is in the server's ALLOWED_DURING_PLAYTEST for the same reason
  return !READ_ONLY.has(c);
}
