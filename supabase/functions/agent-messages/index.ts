import { authAgent, handle, json } from "../_shared/lib.ts";
import { tokenDb, accountForSession } from "../_shared/tokendb.ts";
import { chargeAiWork } from "../_shared/tokenflow.js";

// Embeds are DATA the website renders. Only these shapes are accepted; every string is length-capped.
const KINDS = new Set(["info", "tip", "warning", "success", "steps", "code", "table", "checklist"]);
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const OUTCOMES = new Set(["complete", "incomplete", "stopped", "error"]);
const outcomeOf = (v: unknown) => (OUTCOMES.has(String(v)) ? String(v) : null);
export function cleanEmbeds(raw: unknown) {
  if (!Array.isArray(raw)) return null;
  const out: any[] = [];
  for (const e of raw.slice(0, 6)) {
    if (!e || typeof e !== "object" || !KINDS.has((e as any).type)) continue;
    const x = e as any, base: any = { type: x.type, title: str(x.title, 80) };
    if (x.type === "code") { base.language = str(x.language || "lua", 16); base.code = str(x.code, 6000); }
    else if (x.type === "table") { base.columns = (Array.isArray(x.columns) ? x.columns : []).slice(0, 6).map((c: unknown) => str(c, 40)); base.rows = (Array.isArray(x.rows) ? x.rows : []).slice(0, 30).map((r: unknown) => (Array.isArray(r) ? r : []).slice(0, 6).map((c) => str(c, 120))); }
    else if (x.type === "steps" || x.type === "checklist") { base.items = (Array.isArray(x.items) ? x.items : []).slice(0, 12).map((i: unknown) => str(i, 200)); }
    else { base.body = str(x.body, 800); }
    out.push(base);
  }
  return out.length ? out : null;
}
// GET ?after=<iso> -> new user messages. POST -> write assistant/tool message, or PATCH-style update with id.
Deno.serve(handle(async (req) => {
  const { db, session } = await authAgent(req);
  if (req.method === "GET") {
    const after = new URL(req.url).searchParams.get("after") ?? "1970-01-01";
    // Messages the token gate refused (blocked = true) are NEVER handed to the agent: it must not spend model time on them.
    const { data } = await db.from("messages").select("*").eq("session_id", session.id).eq("blocked", false).gt("created_at", after).order("created_at");
    return json(data);
  }
  const b = await req.json();
  if (b.state) await db.from("sessions").update({ agent_state: b.state, last_active_at: new Date().toISOString() }).eq("id", session.id);
  // AI work is billed on the server, from the moment the user's message was accepted until the agent reports it is finished (3 tokens per started
  // minute). It can take the balance to 0 but never below, and it never interrupts a build in progress.
  if (b.state === "idle" || b.state === "error") {
    try {
      // Every run that has not been billed yet, oldest first. Normally exactly one (the server accepts one message at a time), but if an idle report
      // was ever missed, the earlier run is still billed, only up to the start of the next one so no minute is charged twice.
      const { data: runs } = await db.from("messages").select("id,run_started_at").eq("session_id", session.id).eq("role", "user").not("run_started_at", "is", null).is("run_billed_at", null).order("run_started_at", { ascending: true }).limit(5);
      const acct = (runs?.length ?? 0) > 0 ? await accountForSession(db, session) : null;
      for (let i = 0; i < (runs?.length ?? 0); i++) {
        const run = runs![i];
        // claim the run first so a second "idle" report cannot bill it twice
        const { data: claimed } = await db.from("messages").update({ run_billed_at: new Date().toISOString() }).eq("id", run.id).is("run_billed_at", null).select("id").maybeSingle();
        if (!claimed || !acct) continue;
        const end = i + 1 < runs!.length ? new Date(runs![i + 1].run_started_at).getTime() : Date.now();
        await chargeAiWork({ db: tokenDb(db, acct), seconds: Math.max(0, (end - new Date(run.run_started_at).getTime()) / 1000), runId: run.id });
      }
    } catch (_e) { /* billing must never break the agent's reply */ }
  }
  if (b.id) { // streaming update of an existing message
    const { data } = await db.from("messages").update({ content: b.content, tool_calls: b.tool_calls, ...(b.embeds !== undefined ? { embeds: cleanEmbeds(b.embeds) } : {}), ...(b.outcome !== undefined ? { outcome: outcomeOf(b.outcome) } : {}) }).eq("id", b.id).eq("session_id", session.id).select().single();
    return json(data);
  }
  if (b.content === undefined) return json({ ok: true });
  if (!["assistant","tool","system"].includes(b.role)) return json({ error: "bad role" }, 400);
  const { data } = await db.from("messages").insert({ session_id: session.id, role: b.role, content: b.content, tool_calls: b.tool_calls ?? null, embeds: cleanEmbeds(b.embeds), outcome: outcomeOf(b.outcome) }).select().single();
  return json(data);
}));
