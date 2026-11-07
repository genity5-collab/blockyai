import { authUser, handle, json, randToken } from "../_shared/lib.ts";
// Web app: create a session + 6-char pairing code (valid 10 min).
Deno.serve(handle(async (req) => {
  const { db, user } = await authUser(req);
  const code = randToken(3).toUpperCase();
  const { data, error } = await db.from("sessions").insert({ user_id: user.id, pairing_code: code }).select().single();
  if (error) return json({ error: error.message }, 500);
  return json({ session_id: data.id, pairing_code: code, expires_in: 600 });
}));
