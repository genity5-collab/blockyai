import { authAgent, handle, json } from "../_shared/lib.ts";
// Passthrough to Free.ai. The VM never holds the LLM key. Only self-hosted models are allowed,
// and any response whose source is not "self_hosted" is rejected (protects the startup token contract).
const ALLOW = new Set(["qwen7b", "qwen-coder"]);
Deno.serve(handle(async (req) => {
  await authAgent(req);
  const body = await req.json();
  if (!ALLOW.has(body.model)) return json({ error: "model not allowed" }, 400);
  const r = await fetch("https://api.free.ai/v1/chat/", {
    method: "POST", signal: AbortSignal.timeout(55000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("BLOCKY_LLM_API_KEY")}` },
    body: JSON.stringify({ model: body.model, messages: body.messages, temperature: body.temperature ?? 0.15, max_tokens: Math.min(body.max_tokens ?? 3000, 6000) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: `llm http ${r.status}` }, 502);
  if (j?.free_ai_usage?.source !== "self_hosted") return json({ error: "refused: non self-hosted model" }, 502);
  return json({ content: j.choices?.[0]?.message?.content ?? "", usage: j.free_ai_usage });
}));
