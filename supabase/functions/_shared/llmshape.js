// Pure helpers for llm-proxy so they can be tested without Deno. (.js so both Deno and Node import it, like policy.js.)
// Free.ai returns OpenAI-style: choices[0].finish_reason is "stop" normally and "length" when max_tokens cut the reply off (verified with a real call).
export const DEFAULT_MAX_TOKENS = 3500;
export const HARD_MAX_TOKENS = 12000;           // absolute ceiling the proxy will ever request, whatever the agent asks for
export const clampMaxTokens = (n) => { const v = Math.floor(Number(n)); return Number.isFinite(v) && v > 0 ? Math.min(v, HARD_MAX_TOKENS) : DEFAULT_MAX_TOKENS; };
export function shapeCompletion(j) {
  const c = j?.choices?.[0] ?? {};
  const u = j?.usage ?? {};
  const fr = typeof c.finish_reason === "string" ? c.finish_reason : "unknown";
  return {
    content: c.message?.content ?? "",
    finish_reason: fr,
    truncated: fr === "length",
    usage: { prompt_tokens: Number(u.prompt_tokens) || 0, completion_tokens: Number(u.completion_tokens) || 0, total_tokens: Number(u.total_tokens) || 0, tokens_charged: Number(j?.free_ai_usage?.tokens_charged) || 0 },
    model: j?.free_ai_usage?.model ?? j?.model ?? null,
    source: j?.free_ai_usage?.source ?? null,
  };
}
