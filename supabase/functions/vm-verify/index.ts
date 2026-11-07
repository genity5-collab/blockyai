import { authOwner, handle, json } from "../_shared/lib.ts";
import { fs } from "../_shared/freestyle.ts";

// /diagnostics "Verify VM". Runs ONE fixed command on the session's VM through Freestyle and returns the RAW result.
// The command is a constant here: the browser can't choose or alter it. Authorized by the owner key like every other call.
const COMMAND = "uname -a; hostname; cat /tmp/vmcheck.txt";

Deno.serve(handle(async (req) => {
  const body = await req.json().catch(() => ({}));
  const { session } = await authOwner(req, body.session_id);
  if (!session) return json({ error: "session_id required" }, 400);
  if (!session.vm_id) return json({ error: "This session has no VM yet (vm_id is empty). Open the chat so it starts.", vm_id: null }, 404);

  const vm = fs().vms.ref(session.vm_id);
  const out: Record<string, unknown> = { vm_id: session.vm_id, command: COMMAND, checked_at: new Date().toISOString() };
  const t0 = Date.now();
  try { const d: any = await vm.data(); out.freestyle = { state: d.state, snapshotId: d.snapshotId, resources: d.resources, ttlSeconds: d.ttlSeconds, idleTimeoutSeconds: d.idleTimeoutSeconds, createdAt: d.createdAt, lastNetworkActivity: d.lastNetworkActivity }; }
  catch (e) { out.freestyle = { error: String((e as Error).message).slice(0, 300) }; }
  try {
    const r: any = await vm.exec(COMMAND);
    out.exec = { exit_code: r.exitCode ?? r.statusCode ?? null, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? ""), ms: Date.now() - t0 };
  } catch (e) { out.exec = { error: String((e as Error).message).slice(0, 400) }; }   // raw failure, never replaced by a fake success
  // Is the agent loop really alive inside this VM? Reported separately and verbatim.
  try { const a: any = await vm.exec("systemctl is-active blockyai-agent; ps -eo pid,etime,cmd | grep '[n]ode src/index.js'"); out.agent = { stdout: String(a.stdout ?? ""), exit_code: a.exitCode ?? a.statusCode ?? null }; }
  catch (e) { out.agent = { error: String((e as Error).message).slice(0, 200) }; }
  return json(out);
}));
