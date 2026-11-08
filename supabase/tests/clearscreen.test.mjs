// When the AI's screen goes away (session deleted, VM destroyed or paused), its last picture must go too: stored file AND the row the site reads.
import test from "node:test"; import assert from "node:assert/strict";
import { clearScreen } from "../functions/_shared/clearscreen.js";

const SID = "11111111-1111-4111-8111-111111111111";
// A fake database that records exactly what was asked of it.
function fakeDb({ files = [], listError = null, removeError = null, deleteError = null } = {}) {
  const calls = { list: [], remove: [], del: [] };
  return {
    calls,
    storage: { from: (b) => ({
      list: async (folder, o) => { calls.list.push([b, folder, o]); return listError ? { data: null, error: listError } : { data: files.map((name) => ({ name })), error: null }; },
      remove: async (names) => { calls.remove.push([b, names]); return { error: removeError }; },
    }) },
    from: (t) => ({ delete: () => ({ eq: async (c, v) => { calls.del.push([t, c, v]); return { error: deleteError }; } }) }),
  };
}

test("removes every picture in the session's folder, from the private 'screen' bucket only", async () => {
  const db = fakeDb({ files: ["1.jpg", "2.png"] });
  const r = await clearScreen(db, SID);
  assert.deepEqual(db.calls.remove, [["screen", [`${SID}/1.jpg`, `${SID}/2.png`]]]);
  assert.equal(db.calls.list[0][0], "screen"); assert.equal(db.calls.list[0][1], SID);
  assert.equal(r.ok, true); assert.equal(r.removed, 2);
});
test("deletes the frame row the site reads, for that session only", async () => {
  const db = fakeDb(); await clearScreen(db, SID);
  assert.deepEqual(db.calls.del, [["screen_frames", "session_id", SID]]);
});
test("nothing stored: still deletes the row, and does not call remove with an empty list", async () => {
  const db = fakeDb({ files: [] }); const r = await clearScreen(db, SID);
  assert.equal(db.calls.remove.length, 0); assert.equal(db.calls.del.length, 1); assert.equal(r.removed, 0); assert.equal(r.ok, true);
});
test("a storage error never blocks the row delete (the user must stop seeing it), and is reported", async () => {
  const db = fakeDb({ files: ["1.jpg"], removeError: { message: "boom" } }); const r = await clearScreen(db, SID);
  assert.equal(db.calls.del.length, 1); assert.equal(r.ok, false);
});
test("a listing error still deletes the row and reports it", async () => {
  const db = fakeDb({ listError: { message: "nope" } }); const r = await clearScreen(db, SID);
  assert.equal(db.calls.del.length, 1); assert.equal(r.ok, false);
});
test("a row delete error is reported", async () => {
  const db = fakeDb({ deleteError: { message: "x" } }); assert.equal((await clearScreen(db, SID)).ok, false);
});
test("a thrown error is caught: clearing the screen can never break deleting a session", async () => {
  const db = { storage: { from: () => { throw new Error("storage down"); } }, from: () => ({ delete: () => ({ eq: async () => ({ error: null }) }) }) };
  const r = await clearScreen(db, SID); assert.equal(r.ok, false);
});
test("a session id that is not a UUID is refused, so a path like '../x' can never be built", async () => {
  for (const bad of ["../other", "", null, undefined, "a/b", `${SID}/..`, 123, "11111111-1111-4111-8111-11111111111g"]) {
    const db = fakeDb({ files: ["1.jpg"] }); const r = await clearScreen(db, bad);
    assert.equal(r.ok, false, String(bad)); assert.equal(db.calls.list.length + db.calls.remove.length + db.calls.del.length, 0, "touched storage for " + String(bad));
  }
});
test("file names from storage are used as they are inside the session folder, nothing else", async () => {
  const db = fakeDb({ files: ["a.jpg", "../b.jpg", ".emptyFolderPlaceholder"] }); await clearScreen(db, SID);
  assert.ok(db.calls.remove[0][1].every((p) => p.startsWith(SID + "/") && !p.includes("..")), JSON.stringify(db.calls.remove));
});
test("a large folder is removed in more than one round (storage lists at most 100)", async () => {
  let round = 0; const db = fakeDb();
  db.storage.from = () => ({ list: async () => { round++; return { data: round <= 2 ? Array.from({ length: 100 }, (_, i) => ({ name: `${round}-${i}.jpg` })) : [], error: null }; }, remove: async (n) => { db.calls.remove.push(n); return { error: null }; } });
  const r = await clearScreen(db, SID); assert.equal(r.removed, 200); assert.equal(db.calls.remove.length, 2);
});
