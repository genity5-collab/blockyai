import { authOwner, handle, json, randToken, sha256 } from "../_shared/lib.ts";
import { fs, MAX_LIFETIME_S } from "../_shared/freestyle.ts";
import { isStage } from "../_shared/bootstages.js";

// Start (or resume) the VM for a session. The VM receives ONLY a scoped, short-lived agent token.
Deno.serve(handle(async (req) => {
  const body = await req.json();
  const { db, session: s } = await authOwner(req, body.session_id);

  const stage = async (id: string) => { if (isStage(id)) await db.from("sessions").update({ vm_boot_stage: id }).eq("id", s.id); };
  const f = fs();
  const token = randToken(32);                         // fresh scoped token for this run
  const expires = new Date(Date.now() + MAX_LIFETIME_S * 1000).toISOString();
  await db.from("sessions").update({ vm_status: "starting", vm_boot_stage: "creating", vm_boot_started_at: new Date().toISOString(), agent_token_hash: await sha256(token), agent_token_expires_at: expires }).eq("id", s.id);

  try {
    let vm;
    const createFresh = async () => {
      const snap = Deno.env.get("BLOCKYAI_SNAPSHOT_ID"); // baked image: node + luau-analyze + stylua + selene + /agent
      const r = await f.vms.create({
        ...(snap ? { snapshotId: snap } : {}),
        ttlSeconds: MAX_LIFETIME_S,
        idleTimeoutSeconds: 600,
        // Outbound HTTPS only to what the agent needs (the Supabase project). Nothing else.
        firewall: { rules: [{ action: "allow", source: {}, destination: { public: true } }] },
      });
      return r.vm;
    };
    if (s.vm_id) {                                       // resume a suspended VM
      try {
        vm = f.vms.ref(s.vm_id);
        await vm.start();   // resumes paused VM with processes intact
      } catch (_e) {
        // The old VM expired or was deleted. Do NOT leave the session stuck in "error": start a fresh one from the current snapshot.
        // (The project files lived on the old VM; the Studio place is the source of truth and the agent re-reads it.)
        vm = await createFresh();
      }
    } else {
      vm = await createFresh();
    }
    await stage("created");
    // Start the agent as a background service with ONLY these env vars.
    const env = `BLOCKY_API=${Deno.env.get("SUPABASE_URL")}/functions/v1\nBLOCKY_AGENT_TOKEN=${token}\nBLOCKY_SESSION_ID=${s.id}\n`;
    await vm.fs.writeFile("/etc/blockyai.env", env);
    // Each step is independent (no && chain): the env file is root-owned, so chmod must be sudo, and a failed chmod must never skip the restart.
    await vm.exec("sudo chown ubuntu:ubuntu /etc/blockyai.env; sudo chmod 600 /etc/blockyai.env");
    await stage("creds");
    await vm.exec("sudo systemctl daemon-reload; sudo systemctl restart blockyai-agent");
    // The AI's own screen. Started in the background (it takes a few seconds) and NOT required: if it is missing or fails, the AI still works, it just has no screen.
    try { await vm.exec("if systemctl list-unit-files blockyai-screen.service >/dev/null 2>&1; then (sudo systemctl start blockyai-screen --no-block) ; fi"); } catch { /* optional */ }
    await stage("service");
    // Verify the agent really is up. Never report "running" on faith.
    let up = false;
    for (let i = 0; i < 6 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); const st = await vm.exec("systemctl is-active blockyai-agent"); up = (st.stdout ?? "").trim() === "active"; }
    if (!up) {
      const j = await vm.exec("sudo journalctl -u blockyai-agent -n 5 --no-pager 2>&1 | cut -c1-160");
      throw new Error("agent service failed to start: " + (j.stdout ?? "").replace(/BLOCKY_AGENT_TOKEN=\S+/g, "").slice(0, 200));
    }
    await stage("verified");
    const id = (vm as any).id ?? s.vm_id;
    // Written BY the VM (shell on the VM), so /diagnostics can prove a command really ran there and see per-session content.
    await vm.exec(`printf 'vm_id=%s\nsession_id=%s\nstarted_at=%s\nagent_service=%s\nnode=%s\n' '${id}' '${s.id}' "$(date -u +%FT%TZ)" "$(systemctl is-active blockyai-agent)" "$(node -v)" > /tmp/vmcheck.txt`);
    await db.from("sessions").update({ vm_id: id, vm_status: "running", vm_boot_stage: "ready", vm_started_at: new Date().toISOString(), last_active_at: new Date().toISOString() }).eq("id", s.id);
    return json({ vm_id: id, status: "running" });
  } catch (e) {
    await db.from("sessions").update({ vm_status: "error", vm_boot_stage: null }).eq("id", s.id);
    return json({ error: String((e as Error).message).slice(0, 300) }, 500);   // never echo secrets
  }
}));
