import { authAgent, handle, json } from "../_shared/lib.ts";

// Plans live on the SERVER so the agent cannot talk its way out of unfinished work. The agent loop asks this function
// "may I finish?" and obeys the answer. Actions: create | update | get | can_finish.
const MAX_ITEMS = 30;
const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, n);

// A completion is only accepted when ALL items are done, at least one item is a verification, and any named target is not an empty container.
export function evaluateCompletion(plan: any, targetDescendants: number | null) {
  const reasons: string[] = [];
  const items: any[] = plan?.items ?? [];
  if (!plan) return { ok: true, reasons };                       // no plan = a plain chat answer, nothing to enforce
  const open = items.filter((i) => !i.done);
  if (open.length) reasons.push(`${open.length} checklist item(s) are not done: ${open.slice(0, 5).map((i) => `#${i.id} ${i.text}`).join("; ")}`);
  if (items.length && !items.some((i) => i.verified)) reasons.push("no checklist item is marked verified. Verify the result (screenshots/playtest), then plan_update with verified:true.");
  if (plan.target_path && targetDescendants !== null && targetDescendants < 5)
    reasons.push(`the target ${plan.target_path} has only ${targetDescendants} descendants (minimum 5). An empty container is not a finished build. Keep building.`);
  return { ok: reasons.length === 0, reasons };
}

// An item is addressed by its number. Models often send the item's text instead, so accept "3", 3, "#3", the exact text, or a UNIQUE text match.
export function findItem(items: any[], ref: unknown): any | null {
  const raw = String(ref ?? "").trim();
  const num = Number(raw.replace(/^#/, ""));
  if (raw !== "" && Number.isInteger(num)) { const byId = items.find((x) => x.id === num); if (byId) return byId; }
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const q = norm(raw);
  if (!q) return null;
  const exact = items.filter((x) => norm(x.text) === q);
  if (exact.length === 1) return exact[0];
  const partial = items.filter((x) => norm(x.text).includes(q) || q.includes(norm(x.text)));
  return partial.length === 1 ? partial[0] : null; // ambiguous means no match, never a guess
}

Deno.serve(handle(async (req) => {
  const { db, session } = await authAgent(req);
  const b = await req.json().catch(() => ({}));
  const action = String(b.action ?? "");

  const active = async () => (await db.from("agent_plans").select("*").eq("session_id", session.id).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle()).data;

  if (action === "create") {
    const raw = Array.isArray(b.items) ? b.items : [];
    if (raw.length < 2 || raw.length > MAX_ITEMS) return json({ error: `a plan needs 2..${MAX_ITEMS} items` }, 400);
    const items = raw.map((t: any, i: number) => ({ id: i + 1, text: clip(typeof t === "string" ? t : t?.text, 200), done: false, verified: false, note: "" })).filter((i: any) => i.text);
    if (items.length < 2) return json({ error: "items must be non-empty strings" }, 400);
    await db.from("agent_plans").update({ status: "abandoned", updated_at: new Date().toISOString() }).eq("session_id", session.id).eq("status", "active");
    const { data, error } = await db.from("agent_plans").insert({
      session_id: session.id, message_id: /^[0-9a-f-]{36}$/i.test(String(b.message_id ?? "")) ? b.message_id : null,
      title: clip(b.title || "Plan", 80), items, target_path: b.target_path ? clip(b.target_path, 200) : null,
    }).select().single();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, plan: data });
  }

  if (action === "update") {
    const plan = await active();
    if (!plan) return json({ error: "no active plan. Call plan_create first." }, 400);
    const items = plan.items.map((i: any) => ({ ...i }));
    for (const u of Array.isArray(b.updates) ? b.updates.slice(0, 40) : []) {
      const it = findItem(items, u.id);
      if (!it) return json({ error: `no checklist item matches ${JSON.stringify(String(u.id).slice(0, 80))}. Use the NUMBER. Items: ${items.map((x: any) => `#${x.id} ${x.text}`).join(" | ").slice(0, 900)}` }, 400);
      if (typeof u.done === "boolean") it.done = u.done;
      if (typeof u.verified === "boolean") it.verified = u.verified;
      if (u.note != null) it.note = clip(u.note, 240);
      if (it.verified && !it.done) it.done = true;
    }
    if (b.add_items) for (const t of (Array.isArray(b.add_items) ? b.add_items : []).slice(0, 10)) if (items.length < MAX_ITEMS) items.push({ id: items.length + 1, text: clip(t, 200), done: false, verified: false, note: "" });
    if (b.target_path) plan.target_path = clip(b.target_path, 200);
    const { data } = await db.from("agent_plans").update({ items, target_path: plan.target_path, updated_at: new Date().toISOString() }).eq("id", plan.id).select().single();
    return json({ ok: true, plan: data });
  }

  if (action === "get") return json({ plan: await active() });

  if (action === "can_finish") {
    const plan = await active();
    const n = b.target_descendants == null ? null : Number(b.target_descendants);
    const r = evaluateCompletion(plan, Number.isFinite(n as number) ? n : null);
    if (r.ok && plan) await db.from("agent_plans").update({ status: "complete", updated_at: new Date().toISOString() }).eq("id", plan.id);
    return json({ ...r, plan_id: plan?.id ?? null, target_path: plan?.target_path ?? null });
  }
  return json({ error: "unknown action" }, 400);
}));
