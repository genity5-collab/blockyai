import { authAgent, handle, json } from "../_shared/lib.ts";
// Long-poll a command's result (up to ~25s per call).
Deno.serve(handle(async (req) => {
  const { db, session } = await authAgent(req);
  const id = new URL(req.url).searchParams.get("id")!;
  const end = Date.now() + 25_000;
  while (Date.now() < end) {
    const { data } = await db.from("commands").select("id,type,status,result,error").eq("id", id).eq("session_id", session.id).maybeSingle();
    if (!data) return json({ error: "not found" }, 404);
    if (["done","failed","cancelled"].includes(data.status)) return json(data);
    await new Promise((r) => setTimeout(r, 700));
  }
  return json({ id, status: "pending" });
}));
