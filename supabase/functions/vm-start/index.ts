import { authUser, handle, json, randToken, sha256 } from "../_shared/lib.ts";
import { fs, MAX_LIFETIME_S } from "../_shared/freestyle.ts";

// Start (or resume) the VM for a session. The VM receives ONLY a scoped, short-lived agent token.
Deno.serve(handle(async (req) => {
  const { db, user } = await authUser(req);
  const { session_id } = await req.json();
  const { data: s } = await db.from("sessions").select("*").eq("id", session_id).eq("user_id", user.id).maybeSingle();
  if (!s) return json({ error: "session not found" }, 404);

  const f = fs();
  const token = randToken(32);                         // fresh scoped token for this run
  const expires = new Date(Date.now() + MAX_LIFETIME_S * 1000).toISOString();
  await db.from("sessions").update({ vm_status: "starting", agent_token_hash: await sha256(token), agent_token_expires_at: expires }).eq("id", s.id);

  try {
    let vm;
    if (s.vm_id) {                                       // resume a suspended VM
      vm = f.vms.ref(s.vm_id);
      await vm.start();   // resumes paused VM with processes intact
    } else {
      const snap = Deno.env.get("BLOCKYAI_SNAPSHOT_ID"); // baked image: node + luau-analyze + stylua + selene + /agent
      ({ vm } = await f.vms.create({
        ...(snap ? { snapshotId: snap } : {}),
        ttlSeconds: MAX_LIFETIME_S,
        idleTimeoutSeconds: 600,
        // Outbound HTTPS only to what the agent needs (the Supabase project). Nothing else.
        firewall: { rules: [{ action: "allow", source: {}, destination: { public: true } }] },
      }));
    }
    // Start the agent as a background service with ONLY these env vars.
    const env = `BLOCKY_API=${Deno.env.get("SUPABASE_URL")}/functions/v1\nBLOCKY_AGENT_TOKEN=${token}\nBLOCKY_SESSION_ID=${s.id}\n`;
    await vm.fs.writeFile("/etc/blockyai.env", env);
    await vm.exec("chmod 600 /etc/blockyai.env && sudo systemctl restart blockyai-agent");
    const id = (vm as any).id ?? s.vm_id;
    await db.from("sessions").update({ vm_id: id, vm_status: "running", vm_started_at: new Date().toISOString(), last_active_at: new Date().toISOString() }).eq("id", s.id);
    return json({ vm_id: id, status: "running" });
  } catch (e) {
    await db.from("sessions").update({ vm_status: "error" }).eq("id", s.id);
    return json({ error: String((e as Error).message).slice(0, 300) }, 500);   // never echo secrets
  }
}));
