import { authOwner, handle, json } from "../_shared/lib.ts";
import { TESTS, evaluate } from "../_shared/acceptance.ts";

// Capability Test page backend. Actions:
//   list    -> the 5 tests with their prompts
//   run     -> sends the test prompt as a normal user message (so the real agent loop runs it), returns that message's id
//   verdict -> evaluates the recorded tool calls + plan for that message. The agent's own words are never consulted.
Deno.serve(handle(async (req) => {
  const b = await req.json().catch(() => ({}));
  const { db, session } = await authOwner(req, b.session_id);
  if (b.action === "list") return json(Object.entries(TESTS).map(([id, t]) => ({ id, title: t.title, prompt: t.prompt })));
  if (!session) return json({ error: "session_id required" }, 400);
  const test = String(b.test ?? ""); if (!TESTS[test]) return json({ error: "unknown test" }, 400);

  if (b.action === "run") {
    if (!session.plugin_connected_at) return json({ error: "Pair Studio first. These tests build in a real game." }, 400);
    if (["thinking", "working"].includes(session.agent_state)) return json({ error: "Blocky is busy. Wait or press Stop.", busy: true }, 409);
    const { data, error } = await db.from("messages").insert({ session_id: session.id, role: "user", content: TESTS[test].prompt }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    await db.from("sessions").update({ agent_state: "thinking", last_active_at: new Date().toISOString() }).eq("id", session.id);
    return json({ ok: true, message_id: data.id });
  }
  if (b.action === "verdict") {
    const mid = String(b.message_id ?? ""); if (!/^[0-9a-f-]{36}$/i.test(mid)) return json({ error: "message_id required" }, 400);
    const { data: calls } = await db.from("tool_calls").select("name,ok,error,args_summary,result_summary,seq").eq("session_id", session.id).eq("message_id", mid).order("seq").limit(500);
    const since = (await db.from("messages").select("created_at").eq("id", mid).maybeSingle()).data?.created_at ?? "1970-01-01";
    const { data: plan } = await db.from("agent_plans").select("status,items,target_path").eq("session_id", session.id).gte("created_at", since).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const v = evaluate(test, (calls ?? []) as any, (plan ?? null) as any);
    return json({ ...v, tool_calls: (calls ?? []).length, running: ["thinking", "working"].includes(session.agent_state) });
  }
  return json({ error: "unknown action" }, 400);
}));
