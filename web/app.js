// BlockyAI web app. Only the public anon key lives here. No Freestyle/LLM/service keys, ever.
const { url, anon } = window.BLOCKY;
const sb = supabase.createClient(url, anon);
const $ = (id) => document.getElementById(id);
let sess = null, chan = null, poll = null;
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

async function fn(name, body, method = "POST", qs = "") {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${url}/functions/v1/${name}${qs}`, { method, headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  return r.json();
}
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  $("auth").hidden = !!session; $("app").hidden = !session;
  if (session) loadSessions();
}
$("login").onclick = async () => { const { error } = await sb.auth.signInWithPassword({ email: $("email").value, password: $("pw").value }); $("autherr").textContent = error?.message ?? ""; boot(); };
$("signup").onclick = async () => { const { error } = await sb.auth.signUp({ email: $("email").value, password: $("pw").value }); $("autherr").textContent = error ? error.message : "Account created. If asked, confirm your email, then sign in."; boot(); };
$("logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

async function loadSessions(selectId) {
  const { data } = await sb.from("sessions").select("id,title,created_at").order("created_at", { ascending: false });
  $("sessions").innerHTML = (data ?? []).map((s) => `<li data-id="${s.id}" class="${s.id === (selectId ?? sess?.id) ? "on" : ""}">${esc(s.title)} <small>${new Date(s.created_at).toLocaleDateString()}</small></li>`).join("");
  $("sessions").querySelectorAll("li").forEach((li) => (li.onclick = () => open(li.dataset.id)));
  if (!sess && data?.length) open(data[0].id);
}
$("newsess").onclick = async () => { const r = await fn("pair-create"); if (r.session_id) { await loadSessions(r.session_id); open(r.session_id, r.pairing_code); } };

async function open(id, code) {
  if (chan) sb.removeChannel(chan); clearInterval(poll);
  const { data } = await sb.from("sessions").select("*").eq("id", id).single(); sess = data;
  $("title").textContent = data.title; renderPair(code); await renderMessages();
  chan = sb.channel("s" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `session_id=eq.${id}` }, renderMessages)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sessions", filter: `id=eq.${id}` }, (p) => { sess = p.new; badges(); })
    .subscribe();
  poll = setInterval(() => { refreshStatus(); renderMessages(); }, 4000);   // polling fallback
  refreshStatus(); loadSessions(id);
}
function renderPair(code) {
  const b = $("pair"); const paired = sess.plugin_connected_at;
  if (code && !paired) { b.hidden = false; b.innerHTML = `Pair your Studio plugin with code <b>${esc(code)}</b> (valid 10 minutes).`; }
  else if (!paired) { b.hidden = false; b.innerHTML = `Plugin not paired yet. Create a <b>New session</b> to get a pairing code.`; } else b.hidden = true;
}
let lastSig = "";
async function renderMessages() {
  if (!sess) return;
  const { data } = await sb.from("messages").select("*").eq("session_id", sess.id).order("created_at");
  const sig = JSON.stringify(data); if (sig === lastSig) return; lastSig = sig;
  const el = $("chat"); const stick = el.scrollTop + el.clientHeight > el.scrollHeight - 80;
  el.innerHTML = (data ?? []).filter((m) => m.role !== "system").map((m) => `<div class="m ${m.role}">${esc(m.content)}${(m.tool_calls ?? []).map((c) => `<div class="cmd ${c.status}">${esc(c.name)} ${esc(JSON.stringify(c.args)).slice(0, 160)} - ${esc(c.status)}${c.result ? " : " + esc(c.result) : ""}</div>`).join("")}</div>`).join("");
  if (stick) el.scrollTop = el.scrollHeight;
}
async function refreshStatus() { if (!sess) return; const r = await fn("vm-status", null, "GET", `?session_id=${sess.id}`); if (!r.error) { sess = { ...sess, ...r }; badges(r); } }
function badges(r = {}) {
  const v = sess.vm_status, vb = $("vmbadge"); vb.textContent = "VM: " + v; vb.className = "badge " + (v === "running" ? "ok" : v === "starting" ? "busy" : v === "error" ? "bad" : "");
  const on = r.plugin_online ?? (sess.plugin_last_seen_at && Date.now() - new Date(sess.plugin_last_seen_at) < 30000);
  $("plbadge").textContent = "Studio: " + (on ? "online" : "offline"); $("plbadge").className = "badge " + (on ? "ok" : "");
  const a = sess.agent_state; $("agbadge").textContent = "Agent: " + (a === "idle" ? "idle" : a === "error" ? "error" : a + "..."); $("agbadge").className = "badge " + (a === "working" || a === "thinking" ? "busy" : a === "error" ? "bad" : "");
}
$("vmstart").onclick = async () => { if (!sess) return; sess.vm_status = "starting"; badges(); const r = await fn("vm-start", { session_id: sess.id }); if (r.error) alert(r.error); refreshStatus(); };
$("vmstop").onclick = async () => { if (!sess) return; await fn("vm-stop", { session_id: sess.id, mode: "suspend" }); refreshStatus(); };
$("vmrestart").onclick = async () => { if (!sess) return; await fn("vm-stop", { session_id: sess.id, mode: "destroy" }); $("vmstart").click(); };
$("form").onsubmit = async (e) => {
  e.preventDefault(); const t = $("msg").value.trim(); if (!t || !sess) return; $("msg").value = "";
  if (sess.vm_status !== "running") $("vmstart").click();   // auto-start the agent VM
  await sb.from("messages").insert({ session_id: sess.id, role: "user", content: t }); renderMessages();
};
boot();
