import { authAgent, handle, json } from "../_shared/lib.ts";
import { tokenDb, accountForSession } from "../_shared/tokendb.ts";
import { chargeAiWork } from "../_shared/tokenflow.js";

import { cleanEmbeds, mediaIdsIn } from "../_shared/embeds.js";
const OUTCOMES = new Set(["complete", "incomplete", "stopped", "error"]);
const outcomeOf = (v: unknown) => (OUTCOMES.has(String(v)) ? String(v) : null);
// Which of the media ids named in an embeds list really belong to this session (an image embed can only show the session's own pictures).
async function ownedMediaOf(db: any, sessionId: string, raw: unknown) {
  const ids = mediaIdsIn(raw); if (!ids.length) return new Set<string>();
  const { data } = await db.from("media").select("id").eq("session_id", sessionId).in("id", ids);
  return new Set<string>((data ?? []).map((r: { id: string }) => String(r.id).toLowerCase()));
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
    const { data } = await db.from("messages").update({ content: b.content, tool_calls: b.tool_calls, ...(b.embeds !== undefined ? { embeds: cleanEmbeds(b.embeds, await ownedMediaOf(db, session.id, b.embeds)) } : {}), ...(b.outcome !== undefined ? { outcome: outcomeOf(b.outcome) } : {}) }).eq("id", b.id).eq("session_id", session.id).select().single();
    return json(data);
  }
  if (b.content === undefined) return json({ ok: true });
  if (!["assistant","tool","system"].includes(b.role)) return json({ error: "bad role" }, 400);
  const { data } = await db.from("messages").insert({ session_id: session.id, role: b.role, content: b.content, tool_calls: b.tool_calls ?? null, embeds: cleanEmbeds(b.embeds, await ownedMediaOf(db, session.id, b.embeds)), outcome: outcomeOf(b.outcome) }).select().single();
  return json(data);
}));
