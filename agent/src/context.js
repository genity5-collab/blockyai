// Phase 1 item 12: keep a long run from growing without limit, and make the Stop check cheap.

export const estimateChars = (msgs) => msgs.reduce((n, m) => n + (typeof m?.content === "string" ? m.content.length : 0), 0);

// Shorten OLD tool results (the "user" messages after the first request) to a head + tail stub until the conversation fits.
// Never touched: the system prompt, the user's original request, the model's own (assistant) messages, and the newest `keepRecent`
// messages. Nothing is dropped or reordered, so the model still sees every step it took. Pure: the input is not changed.
export function compactMessages(msgs, { maxChars = 120000, keepRecent = 6, headChars = 600, tailChars = 300 } = {}) {
  const list = Array.isArray(msgs) ? msgs : [];
  const out = list.map((m) => m);                                            // shallow copy; messages are replaced, never edited
  let total = estimateChars(out), compacted = 0;
  if (total <= maxChars) return { messages: out, compacted, over_budget: false };
  const protectedFrom = Math.max(2, out.length - keepRecent);               // 0 = system, 1 = original request
  for (let i = 2; i < protectedFrom && total > maxChars; i++) {             // oldest first
    const m = out[i];
    if (!m || m.role !== "user" || typeof m.content !== "string") continue;
    const keep = headChars + tailChars;
    if (m.content.length <= keep + 120 || m.content.includes("[shortened:")) continue;   // already small, or already shortened (idempotent)
    const cut = m.content.length - keep;
    const stub = `${m.content.slice(0, headChars)}\n[shortened: ${cut} characters of this older tool result were removed to keep the conversation small. Re-run the tool if you need them.]\n${m.content.slice(-tailChars)}`;
    total -= m.content.length - stub.length; compacted++;
    out[i] = { ...m, content: stub };
  }
  return { messages: out, compacted, over_budget: total > maxChars };
}

// A Stop check that asks the server at most once per `minIntervalMs`, remembers a Stop once seen, and treats a failed query as
// "not stopped" (a flaky network must never end a run, and must not be hammered with retries).
export function makeStopFlag({ ask, now = Date.now, minIntervalMs = 1500 }) {
  let last = -Infinity, stopped = false;
  return async () => {
    if (stopped) return true;
    const t = now();
    if (t - last < minIntervalMs) return false;
    last = t;
    try { if (await ask()) stopped = true; } catch {}
    return stopped;
  };
}
