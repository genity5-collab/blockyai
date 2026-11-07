import { authOwner, handle, json, randToken, publicSession, ALLOWED, DESTRUCTIVE } from "../_shared/lib.ts";
import { fs } from "../_shared/freestyle.ts";

// The ONLY door the browser uses. Authorizes by x-client-key (hash compared to sessions.owner_key_hash).
// Actions: sessions_list, session_create, session_get, session_update, session_delete, poll, send_message,
//          confirm_command, cancel_command, undo_edit, vm_status, queue (user-issued commands like screenshot/snapshot)
const FIELDS_OK = new Set(["title", "run_lua_enabled", "max_iterations", "max_batch_size", "live_sync"]);
const clamp = (n: unknown, a: number, b: number) => Math.max(a, Math.min(b, Number(n) || a));

Deno.serve(handle(async (req) => {
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const action = body.action ?? new URL(req.url).searchParams.get("action");
  const { db, oh, session } = await authOwner(req, body.session_id);
  const need = () => { if (!session) throw new Response("session_id required", { status: 400 }); return session; };

  switch (action) {
    case "sessions_list": {
      const { data } = await db.from("sessions").select("*").eq("owner_key_hash", oh).order("created_at", { ascending: false }).limit(50);
      return json((data ?? []).map(publicSession));
    }
    case "session_create": {
      const code = randToken(3).toUpperCase();   // 6 hex chars
      const { data, error } = await db.from("sessions").insert({
        owner_key_hash: oh, client_id: String(body.client_id ?? "").slice(0, 64), title: "New session",
        pairing_code: code, pairing_expires_at: new Date(Date.now() + 600_000).toISOString(),
      }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ session: publicSession(data), pairing_code: code, expires_in: 600 });
    }
    case "pairing_refresh": {
      need(); if (session.plugin_connected_at) return json({ error: "already paired" }, 400);
      const code = randToken(3).toUpperCase();
      await db.from("sessions").update({ pairing_code: code, pairing_expires_at: new Date(Date.now() + 600_000).toISOString() }).eq("id", session.id);
      return json({ pairing_code: code, expires_in: 600 });
    }
    case "session_get": { need(); return json(publicSession(session)); }
    case "session_update": {
      need(); const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body.patch ?? {})) if (FIELDS_OK.has(k)) patch[k] = v;
      if ("max_iterations" in patch) patch.max_iterations = clamp(patch.max_iterations, 1, 40);
      if ("max_batch_size" in patch) patch.max_batch_size = clamp(patch.max_batch_size, 1, 100);
      if ("title" in patch) patch.title = String(patch.title).slice(0, 60);
      const { data } = await db.from("sessions").update(patch).eq("id", session.id).select().single();
      return json(publicSession(data));
    }
    case "session_delete": {
      need();
      if (session.vm_id) { try { await fs().vms.ref(session.vm_id).delete(); } catch { /* already gone */ } }
      await db.from("sessions").delete().eq("id", session.id);
      return json({ ok: true });
    }
    // One cursor-based poll returns everything the HUD needs. Cheap, and no table is exposed to the browser.
    case "poll": {
      need(); const c = body.cursors ?? {};
      const [msgs, cmds, edits, logs, shots, snaps] = await Promise.all([
        db.from("messages").select("*").eq("session_id", session.id).order("created_at").limit(300),
        db.from("commands").select("id,type,payload,status,result,error,needs_confirm,confirmed,created_at,finished_at").eq("session_id", session.id).order("created_at", { ascending: false }).limit(60),
        db.from("edit_log").select("*").eq("session_id", session.id).order("created_at", { ascending: false }).limit(150),
        db.from("playtest_logs").select("*").eq("session_id", session.id).gt("id", Number(c.log ?? 0)).order("id").limit(300),
        db.from("screenshots").select("*").eq("session_id", session.id).order("created_at", { ascending: false }).limit(24),
        db.from("snapshots").select("id,label,created_at").eq("session_id", session.id).order("created_at", { ascending: false }).limit(30),
      ]);
      const shotsOut = [];
      for (const s of shots.data ?? []) { const { data: sig } = await db.storage.from("screenshots").createSignedUrl(s.storage_path, 900); shotsOut.push({ id: s.id, created_at: s.created_at, url: sig?.signedUrl }); }
      const online = !!session.plugin_last_seen_at && Date.now() - new Date(session.plugin_last_seen_at).getTime() < 30_000;
      return json({ session: publicSession(session), plugin_online: online, messages: msgs.data, commands: cmds.data, edit_log: edits.data, playtest_logs: logs.data, screenshots: shotsOut, snapshots: snaps.data, server_time: Date.now() });
    }
    case "send_message": {
      need(); const text = String(body.content ?? "").trim().slice(0, 4000); if (!text) return json({ error: "empty" }, 400);
      const { data } = await db.from("messages").insert({ session_id: session.id, role: "user", content: text }).select().single();
      await db.from("sessions").update({ last_active_at: new Date().toISOString() }).eq("id", session.id);
      if (session.title === "New session") await db.from("sessions").update({ title: text.slice(0, 40) }).eq("id", session.id);
      return json(data);
    }
    // The user confirms or rejects a destructive command (the plugin only runs it after confirmed = true).
    case "confirm_command": {
      need(); const { command_id, approve } = body;
      const q = db.from("commands").update(approve ? { confirmed: true } : { status: "cancelled", error: "rejected by user", finished_at: new Date().toISOString() })
        .eq("id", command_id).eq("session_id", session.id).eq("status", "pending");
      await q; return json({ ok: true });
    }
    case "cancel_command": {
      need(); await db.from("commands").update({ status: "cancelled", error: "cancelled by user", finished_at: new Date().toISOString() }).eq("id", body.command_id).eq("session_id", session.id).in("status", ["pending"]);
      return json({ ok: true });
    }
    // Commands the USER triggers from the UI (screenshot, snapshot, selection, restore). Same allowlist as the agent.
    case "queue": {
      need(); const type = String(body.type);
      if (!ALLOWED.has(type) || type === "run_lua" || type === "batch") return json({ error: "not allowed from UI" }, 400);
      if (DESTRUCTIVE.has(type) && type !== "snapshot_restore") return json({ error: "use the agent for destructive edits" }, 400);
      const { data } = await db.from("commands").insert({ session_id: session.id, type, payload: body.payload ?? {}, needs_confirm: type === "snapshot_restore", confirmed: type !== "snapshot_restore" }).select("id,status,needs_confirm").single();
      return json(data);
    }
    // Undo one logged edit by queueing the inverse. Only simple, safe inverses are supported.
    case "undo_edit": {
      need(); const { data: e } = await db.from("edit_log").select("*").eq("id", body.edit_id).eq("session_id", session.id).maybeSingle();
      if (!e || e.undone) return json({ error: "nothing to undo" }, 400);
      let cmd: { type: string; payload: unknown } | null = null;
      if (e.action === "set" && e.target) { const i = e.target.lastIndexOf("."); cmd = { type: "set_properties", payload: { path: e.target.slice(0, i), properties: { [e.target.slice(i + 1)]: e.before } } }; }
      else if (e.action === "create" && e.target) cmd = { type: "delete", payload: { path: e.target } };
      else if (e.action === "move" && e.target && e.before) cmd = { type: "move", payload: { path: e.target, new_parent: e.before } };
      if (!cmd) return json({ error: "this kind of edit cannot be auto-undone; restore a snapshot instead" }, 400);
      await db.from("commands").insert({ session_id: session.id, type: "snapshot_save", payload: { label: "auto before undo" } });
      await db.from("commands").insert({ session_id: session.id, type: cmd.type, payload: cmd.payload });
      await db.from("edit_log").update({ undone: true }).eq("id", e.id);
      return json({ ok: true });
    }
    case "vm_status": {
      need(); let live: string | null = null;
      if (session.vm_id) { try { live = (await fs().vms.ref(session.vm_id).data() as any).state; } catch { live = "unknown"; } }
      return json({ vm_status: session.vm_status, freestyle_state: live });
    }
    default: return json({ error: "unknown action" }, 400);
  }
}));
