import { authOwner, handle, json, randToken, publicSession, ALLOWED, DESTRUCTIVE } from "../_shared/lib.ts";
import { fs } from "../_shared/freestyle.ts";

// The ONLY door the browser uses. Authorizes by x-client-key (hash compared to sessions.owner_key_hash).
// Actions: sessions_list, session_create, session_get, session_update, session_delete, poll, send_message,
//          confirm_command, cancel_command, undo_edit, vm_status, queue (user-issued commands like screenshot/snapshot)
const FIELDS_OK = new Set(["title", "run_lua_enabled", "max_iterations", "max_batch_size", "live_sync", "mode", "genre"]);
const MODES = new Set(["chat", "game"]);
const GENRES = new Set(["obby", "tycoon", "simulator", "racing", "horror", "rpg", "shooter"]);
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
    case "templates_list": {
      const { data } = await db.from("templates").select("id,name,kind,description,instance_count,session_id,created_at").or(`session_id.is.null${session ? `,session_id.eq.${session.id}` : ""}`).order("name").limit(200);
      return json((data ?? []).map((t: any) => ({ ...t, builtin: t.session_id === null, session_id: undefined })));
    }
    case "template_delete": {
      need(); const name = String(body.name ?? "");
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(name)) return json({ error: "bad name" }, 400);
      await db.from("templates").delete().eq("session_id", session.id).eq("name", name);       // built-ins (session_id null) can never be deleted from the browser
      return json({ ok: true });
    }
    case "plugin_info": {
      const { data } = await db.from("plugin_releases").select("version,label,changelog,created_at").order("version", { ascending: false }).limit(20);
      return json({ latest: data?.[0]?.version ?? null, releases: data ?? [] });
    }
    case "session_get": { need(); return json(publicSession(session)); }
    case "session_update": {
      need(); const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body.patch ?? {})) if (FIELDS_OK.has(k)) patch[k] = v;
      if ("max_iterations" in patch) patch.max_iterations = clamp(patch.max_iterations, 1, 80);
      if ("mode" in patch && !MODES.has(String(patch.mode))) delete patch.mode;
      if ("genre" in patch) patch.genre = GENRES.has(String(patch.genre)) ? patch.genre : null;
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
      const [msgs, cmds, edits, logs, shots, snaps, atts, plan, calls] = await Promise.all([
        db.from("messages").select("*").eq("session_id", session.id).order("created_at").limit(300),
        db.from("commands").select("id,type,payload,status,result,error,needs_confirm,confirmed,created_at,finished_at").eq("session_id", session.id).order("created_at", { ascending: false }).limit(60),
        db.from("edit_log").select("*").eq("session_id", session.id).order("created_at", { ascending: false }).limit(150),
        db.from("playtest_logs").select("*").eq("session_id", session.id).gt("id", Number(c.log ?? 0)).order("id").limit(300),
        db.from("screenshots").select("*").eq("session_id", session.id).order("created_at", { ascending: false }).limit(24),
        db.from("snapshots").select("id,label,created_at").eq("session_id", session.id).order("created_at", { ascending: false }).limit(30),
        db.from("attachments").select("id,kind,name,mime,size,description,created_at").eq("session_id", session.id).order("created_at").limit(60),
        db.from("agent_plans").select("id,title,items,status,target_path,updated_at").eq("session_id", session.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("tool_calls").select("id,name,family,ok,error,duration_ms,args_summary,created_at").eq("session_id", session.id).order("created_at", { ascending: false }).limit(60),
      ]);
      const shotsOut = [];
      for (const s of shots.data ?? []) { const { data: sig } = await db.storage.from("screenshots").createSignedUrl(s.storage_path, 900); shotsOut.push({ id: s.id, created_at: s.created_at, label: s.label ?? null, command_id: s.command_id, url: sig?.signedUrl }); }
      const online = !!session.plugin_last_seen_at && Date.now() - new Date(session.plugin_last_seen_at).getTime() < 30_000;
      return json({ session: publicSession(session), plugin_online: online, messages: msgs.data, commands: cmds.data, edit_log: edits.data, playtest_logs: logs.data, screenshots: shotsOut, snapshots: snaps.data, attachments: atts.data, plan: plan.data ?? null, tool_calls: calls.data ?? [], server_time: Date.now() });
    }

    // ---- attachments: images (described by qwen25-vl + OCR paddleocr-vl, both self-hosted) and text/code files ----
    case "upload_attachment": {
      need();
      const name = String(body.name ?? "file").replace(/[^\w.\- ]/g, "_").slice(0, 80);
      const mime = String(body.mime ?? "application/octet-stream").toLowerCase();
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(String(body.data ?? "")), (c) => c.charCodeAt(0)); } catch { return json({ error: "bad file data" }, 400); }
      if (!bytes.length) return json({ error: "empty file" }, 400);
      const isImg = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime);
      const TEXT_EXT = /\.(lua|luau|txt|md|json|csv|log|rbxlx|rbxmx|xml|html|css|js|ts)$/i;
      const isText = !isImg && (mime.startsWith("text/") || mime === "application/json" || TEXT_EXT.test(name));
      if (!isImg && !isText) return json({ error: "Only images (png, jpg, webp, gif) and text or code files are supported." }, 400);
      if (bytes.length > (isImg ? 4_000_000 : 300_000)) return json({ error: isImg ? "Image is over 4 MB." : "Text file is over 300 KB." }, 400);
      const { count } = await db.from("attachments").select("id", { count: "exact", head: true }).eq("session_id", session.id);
      if ((count ?? 0) >= 40) return json({ error: "This session has reached its 40 file limit." }, 400);
      const path = `${session.id}/${crypto.randomUUID()}-${name}`;
      const up = await db.storage.from("attachments").upload(path, bytes, { contentType: isImg ? mime : "text/plain", upsert: false });
      if (up.error) return json({ error: "storage: " + up.error.message }, 500);
      let description: string | null = null, ocr: string | null = null, text: string | null = null;
      if (isImg) {
        const key = Deno.env.get("BLOCKY_LLM_API_KEY");
        const call = async (ep: string, model: string) => {
          const fd = new FormData(); fd.append("image", new Blob([bytes], { type: mime }), name); fd.append("model", model);
          const r = await fetch(`https://api.free.ai/v1/${ep}/`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(50000) });
          return r.ok ? await r.json().catch(() => ({})) : {};
        };
        const [d, o] = await Promise.all([call("image/describe", "qwen25-vl"), call("ocr", "paddleocr-vl")]);
        description = (d.model === "qwen25-vl" ? String(d.description ?? "") : "").slice(0, 1500) || null;
        ocr = (o.model === "paddleocr-vl" ? String(o.text ?? "") : "").slice(0, 3000) || null;
      } else {
        text = new TextDecoder().decode(bytes).replace(/\u0000/g, "").slice(0, 60000);
      }
      const { data, error } = await db.from("attachments").insert({
        session_id: session.id, kind: isImg ? "image" : "text", name, mime, size: bytes.length, storage_path: path,
        description, ocr_text: ocr, text_content: text,
      }).select("id,kind,name,mime,size,description,created_at").single();
      if (error) return json({ error: error.message }, 500);
      return json(data);
    }
    case "attachment_url": {
      need();
      const { data: a } = await db.from("attachments").select("storage_path").eq("id", body.id).eq("session_id", session.id).maybeSingle();
      if (!a) return json({ error: "not found" }, 404);
      const { data: sig } = await db.storage.from("attachments").createSignedUrl(a.storage_path, 600);
      return json({ url: sig?.signedUrl ?? null });
    }
    case "stop_agent": {
      need();
      await db.from("sessions").update({ agent_state: "idle", last_active_at: new Date().toISOString() }).eq("id", session.id);
      await db.from("messages").insert({ session_id: session.id, role: "system", content: "__STOP__" });
      await db.from("commands").update({ status: "cancelled", error: "stopped by user", finished_at: new Date().toISOString() }).eq("session_id", session.id).in("status", ["pending", "running"]);
      return json({ ok: true });
    }
    case "send_message": {
      need(); const text = String(body.content ?? "").trim().slice(0, 4000); if (!text && !(Array.isArray(body.attachment_ids) && body.attachment_ids.length)) return json({ error: "empty" }, 400);
      // One message at a time: refuse while the agent is still answering. A stale lock (agent crashed) expires after 3 minutes.
      if (["thinking", "working"].includes(session.agent_state) && Date.now() - new Date(session.last_active_at ?? 0).getTime() < 180_000)
        return json({ error: "Blocky is still working. Wait for it to finish, or press Stop.", busy: true }, 409);
      const ids: string[] = Array.isArray(body.attachment_ids) ? body.attachment_ids.map(String).slice(0, 6) : [];
      let okIds: string[] = [];
      if (ids.length) { const { data: own } = await db.from("attachments").select("id").eq("session_id", session.id).in("id", ids); okIds = (own ?? []).map((r: { id: string }) => r.id); }
      const { data } = await db.from("messages").insert({ session_id: session.id, role: "user", content: text, attachment_ids: okIds }).select().single();
      await db.from("sessions").update({ last_active_at: new Date().toISOString(), agent_state: "thinking" }).eq("id", session.id);
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
