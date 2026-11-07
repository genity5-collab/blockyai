// Validates one llm_calls row. Pure, so it is tested without Deno. The agent is semi-trusted (its token is session-scoped), so every field is clamped.
const FINISH = new Set(["stop", "length", "tool_calls", "content_filter", "unknown"]);
const int = (v, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : null; };
export function llmRow(b, sessionId) {
  const s = (v, n) => (v == null ? null : String(v).replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, n));
  return {
    session_id: sessionId,
    run_id: s(b?.run_id, 60),
    message_id: typeof b?.message_id === "string" && /^[0-9a-f-]{36}$/i.test(b.message_id) ? b.message_id : null,
    iteration: int(b?.iteration, 1000) ?? 0,
    finish_reason: FINISH.has(b?.finish_reason) ? b.finish_reason : "unknown",
    prompt_tokens: int(b?.prompt_tokens, 10_000_000), completion_tokens: int(b?.completion_tokens, 10_000_000), chars: int(b?.chars, 100_000_000),
  };
}
