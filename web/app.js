// BlockyAI web app. Only the public anon key lives here. No Freestyle/LLM/service keys, ever.
// No login screen: each browser gets a private guest identity (Supabase anonymous auth), so sessions stay separate per visitor.
const { url, anon } = window.BLOCKY;
const sb = supabase.createClient(url, anon);
const $ = (id) => document.getElementById(id);
let sess = null, chan = null, poll = null, sending = false, lastSig = "";
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const toast = (t) => { const e = $("toast"); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (e.hidden = true), 3500); };

async function fn(name, body, method = "POST", qs = "") {
  const { data: { session } } = await sb.auth.getSession();
  try {
    const r = await fetch(`${url}/functions/v1/${name}${qs}`, { method, headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
    return await r.json();
  } catch { return { error: "network" }; }
}
async function ensureUser() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) return;
  const { error } = await sb.auth.signInAnonymously();
  if (error) toast("Could not start. Please refresh.");
}
async function boot() { await ensureUser(); await loadSessions(true); }

async function loadSessions(auto) {
  const { data } = await sb.from("sessions").select("id,title,created_at").order("created_at", { ascending: false });
  $("sessions").innerHTML = (data ?? []).map((s) => `<li data-id="${s.id}" class="${s.id === sess?.id ? "on" : ""}"><span>${esc(s.title || "New chat")}</span><small>${new Date(s.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></li>`).join("");
  $("sessions").querySelectorAll("li").forEach((li) => (li.onclick = () => { open(li.dataset.id); $("side").classList.remove("open"); }));
  if (auto && !sess && data?.length) open(data[0].id);
}
async function newChat() {
  const r = await fn("pair-create");
  if (!r.session_id) return toast("Could not create a chat. Try again.");
  await open(r.session_id, r.pairing_code); $("side").classList.remove("open"); $("msg").focus();
}
async function open(id, code) {
  if (chan) sb.removeChannel(chan); clearInterval(poll); lastSig = "";
  const { data } = await sb.from("sessions").select("*").eq("id", id).single(); if (!data) return; sess = data;
  $("title").textContent = data.title || "New chat"; pairPill(code); await renderMessages(true);
  chan = sb.channel("s" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `session_id=eq.${id}` }, () => renderMessages())
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sessions", filter: `id=eq.${id}` }, (p) => { sess = p.new; renderMessages(true); })
    .subscribe();
  poll = setInterval(async () => { const { data: s } = await sb.from("sessions").select("*").eq("id", id).single(); if (s) sess = s; renderMessages(); }, 3000);   // fallback
  loadSessions();
}
// The only "setup" the user sees: a small button with the plugin pairing code until Studio is connected.
function pairPill(code) {
  const b = $("pairbtn"); b.hidden = !!sess.plugin_connected_at || !code;
  if (!b.hidden) b.innerHTML = `Studio code <b>${esc(code)}</b>`;
}
// Hidden VM control: start/resume when needed, restart if it errored. Same backend functions, no buttons.
let vmBusy = false;
async function ensureVm() {
  if (!sess || vmBusy) return; vmBusy = true;
  try {
    const st = await fn("vm-status", null, "GET", `?session_id=${sess.id}`);
    const live = st.freestyle_state, db = st.vm_status ?? sess.vm_status;
    if (db === "running" && live === "running") return;                       // healthy
    if (db === "error" || (db === "running" && live && live !== "running" && live !== "starting")) {
      await fn("vm-stop", { session_id: sess.id, mode: "destroy" });            // clean restart
    }
    const r = await fn("vm-start", { session_id: sess.id });                    // also resumes a suspended VM
    if (r.error) toast("The assistant is waking up, give it a moment...");
  } finally { vmBusy = false; }
}
function working() { return sending || ["thinking", "working"].includes(sess?.agent_state); }

async function renderMessages(force) {
  if (!sess) return;
  const { data } = await sb.from("messages").select("*").eq("session_id", sess.id).order("created_at");
  const msgs = (data ?? []).filter((m) => m.role !== "system");
  const sig = JSON.stringify([msgs, working()]); if (!force && sig === lastSig) return; lastSig = sig;
  const chat = $("chat"); const stick = chat.scrollTop + chat.clientHeight > chat.scrollHeight - 120;
  if (!msgs.length) { chat.innerHTML = `<div id="empty"><div class="logo big">B</div><h1>What should we build?</h1><p>Tell BlockyAI what you want in your Roblox game.</p><div class="chips"><button>Build a spawn area with a fence</button><button>Make a coin pickup script</button><button>Add a day and night cycle</button></div></div>`; bindChips(); return; }
  const html = msgs.map((m) => m.role === "user"
    ? `<div class="m user"><div class="b">${esc(m.content)}</div></div>`
    : `<div class="m assistant"><div class="av"><div class="logo">B</div></div><div class="b">${esc(m.content)}${(m.tool_calls ?? []).map((c) => `<div class="step ${c.status}"><i class="d"></i>${esc(label(c))}</div>`).join("")}</div></div>`).join("");
  const last = msgs[msgs.length - 1];
  const typing = working() && last.role === "user" ? `<div class="m assistant"><div class="av"><div class="logo">B</div></div><div class="b"><div class="typing"><i></i><i></i><i></i></div></div></div>` : "";
  chat.innerHTML = `<div class="wrap">${html}${typing}</div>`;
  if (stick || force) chat.scrollTop = chat.scrollHeight;
}
const label = (c) => ({ roblox_get_tree: "Looking at the game", roblox_find: "Searching", roblox_create: "Creating", roblox_set_properties: "Updating", roblox_delete: "Removing", roblox_move: "Moving", roblox_read_script: "Reading a script", roblox_write_script: "Writing a script", roblox_patch_script: "Editing a script", roblox_get_playtest_logs: "Checking the Output", roblox_snapshot_save: "Saving a backup" }[c.name] || c.name.replace(/^roblox_/, "").replace(/_/g, " "));

function bindChips() { document.querySelectorAll(".chips button").forEach((b) => (b.onclick = () => { $("msg").value = b.textContent; send(); })); }
async function send() {
  const t = $("msg").value.trim(); if (!t || sending) return;
  if (!sess) await newChat(); if (!sess) return;
  sending = true; $("send").disabled = true; $("msg").value = ""; autosize();
  // Start the agent VM silently if it is not running. The user never has to think about it.
  ensureVm();
  await sb.from("messages").insert({ session_id: sess.id, role: "user", content: t });
  if (["New chat", "New session", ""].includes(sess.title || "")) { const title = t.slice(0, 40); await sb.from("sessions").update({ title }).eq("id", sess.id); $("title").textContent = title; loadSessions(); }
  await renderMessages(true);
  setTimeout(() => { sending = false; $("send").disabled = false; renderMessages(true); }, 1500);
}
const autosize = () => { const m = $("msg"); m.style.height = "auto"; m.style.height = Math.min(m.scrollHeight, 180) + "px"; };
$("msg").addEventListener("input", autosize);
$("msg").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
$("form").onsubmit = (e) => { e.preventDefault(); send(); };
$("newsess").onclick = newChat; $("menu").onclick = () => $("side").classList.toggle("open");
bindChips(); boot();
