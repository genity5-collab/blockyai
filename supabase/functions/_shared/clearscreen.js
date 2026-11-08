// When the AI's screen goes away (the session is deleted, or its VM is destroyed or paused), its last picture must go too:
// the stored file(s) in the private 'screen' bucket AND the row the website reads. Otherwise the last thing the AI looked at stays on our servers
// (and on the user's screen) with nothing left to ever delete it.
// Never throws: clearing the screen must not stop a session from being deleted. It reports ok:false so the caller can log it.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function clearScreen(db, sessionId) {
  if (typeof sessionId !== "string" || !UUID.test(sessionId)) return { ok: false, removed: 0, error: "bad session id" };   // the id becomes part of a storage path: only a real UUID is accepted
  let ok = true, removed = 0, error = null;
  try {
    const bucket = db.storage.from("screen");
    for (let round = 0; round < 20; round++) {                                 // storage lists at most 100 names per call
      const { data, error: le } = await bucket.list(sessionId, { limit: 100 });
      if (le) { ok = false; error = le.message || "list failed"; break; }
      const names = (data ?? []).map((f) => f?.name).filter((n) => typeof n === "string" && n && !n.includes("/") && !n.includes(".."));
      if (!names.length) break;
      const { error: re } = await bucket.remove(names.map((n) => `${sessionId}/${n}`));
      if (re) { ok = false; error = re.message || "remove failed"; break; }
      removed += names.length;
      if ((data ?? []).length < 100) break;
    }
  } catch (e) { ok = false; error = String(e?.message || e).slice(0, 120); }
  try {                                                                         // always remove the row, even if the file removal failed: the user must stop seeing the picture
    const { error: de } = await db.from("screen_frames").delete().eq("session_id", sessionId);
    if (de) { ok = false; error = error || de.message || "row delete failed"; }
  } catch (e) { ok = false; error = error || String(e?.message || e).slice(0, 120); }
  return { ok, removed, ...(error ? { error } : {}) };
}
