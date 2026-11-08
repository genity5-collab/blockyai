// The agent writes a "Working..." line into the chat while it works. If that line is replayed to the model as its own earlier reply,
// the model copies it and ends the turn with just "Working...", and the user never gets an answer. So these rows are not given back to the agent.
const WAIT = /^\s*(working|thinking)\s*(\.{1,3}|…)?\s*$/i;
export function isPlaceholder(m) {
  if (!m || m.role !== "assistant") return false;
  if (Array.isArray(m.tool_calls) && m.tool_calls.length) return false;          // it carries real tool cards: that is work, not a placeholder
  const c = typeof m.content === "string" ? m.content : "";
  return c.trim() === "" || WAIT.test(c);
}
export const dropPlaceholders = (rows) => (Array.isArray(rows) ? rows : []).filter((m) => m && !isPlaceholder(m));
