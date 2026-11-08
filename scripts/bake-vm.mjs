import { Freestyle } from "freestyle";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
// Bake from the checkout this script lives in (never a hard-coded path: an old copy once baked stale agent code).
import { fileURLToPath } from "url"; import { execSync } from "child_process";
const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const ROOT = REPO + "/agent";
// Refuse to bake code that is behind GitHub, or that has uncommitted changes in agent/ (the VM must run exactly what is on main).
try {
  execSync("git fetch -q origin", { cwd: REPO, stdio: "pipe" });
  const behind = execSync("git rev-list --count HEAD..origin/main", { cwd: REPO }).toString().trim();
  const dirty = execSync("git status --porcelain -- agent", { cwd: REPO }).toString().trim();
  if (behind !== "0") { console.log(`ABORT: this checkout is ${behind} commit(s) behind origin/main. Run git merge --ff-only origin/main first.`); process.exit(1); }
  if (dirty) { console.log("ABORT: agent/ has uncommitted changes:\n" + dirty); process.exit(1); }
  console.log("baking agent code at commit", execSync("git rev-parse --short HEAD", { cwd: REPO }).toString().trim());
} catch (e) { console.log("ABORT: could not verify the checkout against GitHub:", String(e.message).slice(0, 160)); process.exit(1); }
const f = new Freestyle();
const { vm } = await f.vms.create({ ttlSeconds: 1800, firewall: { rules: [{ action: "allow", source: {}, destination: { public: true } }] } });
const sh = async (c) => { const r = await vm.exec(c); return { out: (r.stdout + r.stderr).trim(), code: r.statusCode ?? r.exitCode }; };
const fail = async (msg) => { console.log("ABORT:", msg); try { await vm.delete(); } catch {} process.exit(1); };
console.log("builder vm", vm.id);

// 1. toolchain
await vm.fs.writeFile("/tmp/bootstrap.sh", readFileSync(ROOT + "/bootstrap-vm.sh", "utf8"));
const boot = await sh("bash /tmp/bootstrap.sh 2>&1 | tail -8");
console.log(boot.out); if (boot.code !== 0 || /MISSING|FAILED/.test(boot.out)) await fail("toolchain install failed");

// 2. copy the WHOLE agent folder (everything except tests/node_modules/hidden), so no file can be forgotten
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); if (n === "node_modules" || n.startsWith(".")) return []; return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(ROOT).filter((p) => !p.includes("/test/") && !p.endsWith("bootstrap-vm.sh"));
await sh("sudo mkdir -p /opt/blockyai/agent && sudo chown -R ubuntu:ubuntu /opt/blockyai && mkdir -p /home/ubuntu/project");
for (const p of files) { const rel = relative(ROOT, p); await sh(`mkdir -p /opt/blockyai/agent/$(dirname ${rel})`); await vm.fs.writeFile("/opt/blockyai/agent/" + rel, readFileSync(p, "utf8")); }
// Shared server files the agent imports from outside agent/ (e.g. policy.js). They must sit at the SAME relative path on the VM
// (/opt/blockyai/supabase/functions/_shared/...), or the agent crashes at start. test/phase1-bakedeps.test.js keeps this list honest.
const SHARED = ["supabase/functions/_shared/policy.js", "supabase/functions/_shared/screenguard.js"];
await sh("mkdir -p /opt/blockyai/supabase/functions/_shared");
for (const f of SHARED) await vm.fs.writeFile("/opt/blockyai/" + f, readFileSync(ROOT + "/../" + f, "utf8"));
// tests too, but kept outside the service path, to run them here
// acceptance.test.js judges SERVER code (supabase/functions/_shared) that is not on the VM, so it stays in the repo and is not baked.
const tests = readdirSync(ROOT + "/test").filter((n) => n.endsWith(".js") && !n.startsWith(".") && n !== "acceptance.test.js");
await sh("mkdir -p /opt/blockyai/agent/test"); for (const n of tests) await vm.fs.writeFile("/opt/blockyai/agent/test/" + n, readFileSync(ROOT + "/test/" + n, "utf8"));
console.log("copied", files.length, "files +", tests.length, "tests");

// 2b. The AI's own screen (virtual display + Chrome + mouse/keyboard library). Kept in screen/, separate from agent/. Installer is slow (about 90 s), so it runs in
// the background and is polled, as Freestyle recommends for browser installs.
const SCREEN = join(ROOT, "..", "screen");
await sh("sudo mkdir -p /opt/blockyai/screen && sudo chown -R ubuntu:ubuntu /opt/blockyai");
for (const n of ["screen.js", "install-screen.sh", "start-screen.sh", "blockyai-screen.service"]) await vm.fs.writeFile("/opt/blockyai/screen/" + n, readFileSync(join(SCREEN, n), "utf8"));
for (const n of ["screenflow.js", "mediacheck.js"]) await vm.fs.writeFile("/opt/blockyai/supabase/functions/_shared/" + n, readFileSync(join(ROOT, "..", "supabase/functions/_shared", n), "utf8"));
await sh("chmod +x /opt/blockyai/screen/*.sh; rm -f /tmp/screen-install.done; (nohup bash /opt/blockyai/screen/install-screen.sh > /tmp/screen-install.out 2>&1; touch /tmp/screen-install.done) > /dev/null 2>&1 &");
for (let i = 0; i < 40; i++) { if ((await sh("test -f /tmp/screen-install.done && echo D")).out === "D") break; await new Promise((r) => setTimeout(r, 8000)); }
const scr = await sh("tail -4 /tmp/screen-install.out"); console.log(scr.out);
if (!/ALL TOOLS PRESENT/.test(scr.out)) await fail("the screen tools did not install");
await sh("sudo cp /opt/blockyai/screen/blockyai-screen.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable blockyai-screen 2>&1 | tail -1");
// PROVE the screen really works before snapshotting: start it, capture a real frame, read the page through the browser, run the privacy check on it.
await sh("sudo systemctl restart blockyai-screen"); await new Promise((r) => setTimeout(r, 5000));
await vm.fs.writeFile("/opt/blockyai/screen/selfcheck.mjs", `import * as S from "/opt/blockyai/screen/screen.js"; import { planFrame } from "/opt/blockyai/supabase/functions/_shared/screenflow.js";
const w = (ms) => new Promise((r) => setTimeout(r, ms)); let o = {};
o.open = (await S.openUrl({ url: "https://example.com/" })).ok; await w(4000);
const fr = await S.frame({ activity: "self check" }); o.frame = fr.ok; o.title = fr.payload?.title; o.shape = fr.ok && fr.payload.image.length > 5000;
const plan = fr.ok ? planFrame(fr.payload, null, Date.now()) : { action: "none" }; o.decision = plan.action; o.size = plan.row ? plan.row.width + "x" + plan.row.height : null;
o.loginHidden = planFrame({ ...fr.payload, url: "https://example.com/login" }, null, Date.now()).action === "hide";
o.k = (await S.pressKey({ key: "ctrl+l" })).ok; o.c = (await S.click({ x: 400, y: 300 })).ok;
console.log("SELFCHECK " + JSON.stringify(o)); process.exit(o.open && o.frame && o.shape && o.decision === "show" && o.loginHidden && o.k && o.c ? 0 : 1);`);
const sc = await sh("cd /opt/blockyai/screen && DISPLAY=:0 timeout 60 node selfcheck.mjs 2>&1 | tail -3"); console.log(sc.out);
if (sc.code !== 0 || !/"decision":"show"/.test(sc.out)) await fail("the AI screen does not work on the VM: " + sc.out.slice(0, 300));
await sh("sudo systemctl stop blockyai-screen");   // a fresh VM starts it on demand; the snapshot must not carry a running browser or a used profile
await sh("rm -rf /home/ubuntu/chrome-profile /tmp/chrome.deb /tmp/screen-*.jpg");

// 3. templates and reference specs go where the agent can read them
await sh("mkdir -p /home/ubuntu/project/templates /home/ubuntu/project/reference && cp /opt/blockyai/agent/templates/* /home/ubuntu/project/templates/ && cp /opt/blockyai/agent/reference/* /home/ubuntu/project/reference/");

// 4. PROVE the agent loads on the VM before snapshotting
const node = await sh("node --version");
console.log("node", node.out);
const load = await sh("cd /opt/blockyai/agent && node --input-type=module -e \"const m=await import('./src/loop.js');const t=await import('./src/tools.js');console.log('SYSTEM chars',m.SYSTEM.length,'| tools',Object.keys(t.TOOLS).length,'| has build_model',!!t.TOOLS.build_model,'| has plan_create',!!t.TOOLS.plan_create)\" 2>&1");
console.log(load.out); if (load.code !== 0 || !/has build_model true/.test(load.out)) await fail("agent does not load on the VM");
const tst = await sh("cd /opt/blockyai/agent && node --test test/loop.test.js test/never-stop.test.js test/routing.test.js 2>&1 | grep -E '^ℹ (tests|pass|fail)'");
console.log(tst.out); if (!/fail 0/.test(tst.out)) await fail("agent tests fail on the VM");
// Start the REAL service entry point (src/index.js), the file systemd runs. Importing loop.js and tools.js is not enough: a bad import in index.js
// once made every new session's agent crash on start while all tests passed. It must still be ALIVE after 4 seconds (it idles waiting for messages).
const boot2 = await sh("cd /opt/blockyai/agent && (BLOCKY_API=https://127.0.0.1:9 BLOCKY_AGENT_TOKEN=bake-check BLOCKY_SESSION_ID=bake-check timeout 4 node src/index.js > /tmp/entry.log 2>&1; echo exit=$? >> /tmp/entry.log); tail -12 /tmp/entry.log");
console.log("entry point:", boot2.out.split("\n").slice(-4).join(" | ").slice(0, 300));
// timeout kills a healthy process with exit 124. Any other exit, or a module/syntax error in the log, means the service would crash.
if (!/exit=124/.test(boot2.out) || /SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export|Cannot find module|ReferenceError/.test(boot2.out)) await fail("the agent entry point (src/index.js) does not start: " + boot2.out.slice(0, 300));
// real lint on the VM with a shipped template
const lint = await sh("cd /home/ubuntu/project && cp templates/RemoteGuard.luau lint/t.luau 2>/dev/null; luau-lsp analyze --definitions=types/globalTypes.d.luau lint/t.luau 2>&1 | head -3; echo exit=$?");
console.log("lint check:", lint.out);

// 5. service unit
await vm.fs.writeFile("/tmp/blockyai-agent.service", "[Unit]\nDescription=BlockyAI agent\nAfter=network-online.target\n[Service]\nUser=ubuntu\nWorkingDirectory=/opt/blockyai/agent\nEnvironmentFile=-/etc/blockyai.env\nExecStart=/usr/bin/env node src/index.js\nRestart=always\nRestartSec=3\n[Install]\nWantedBy=multi-user.target\n");
console.log("svc:", (await sh("sudo mv /tmp/blockyai-agent.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable blockyai-agent 2>&1 | tail -1; sudo touch /etc/blockyai.env; sudo chmod 600 /etc/blockyai.env")).out);

// 6. snapshot with NO arguments (standing rule), then delete the builder
let snapshotId;
try { ({ snapshotId } = await vm.snapshot()); }
catch (e) { console.log("SNAPSHOT FAILED:", String(e?.message ?? e).slice(0, 200)); try { await vm.delete(); console.log("builder deleted"); } catch {} process.exit(1); }   // never leak the builder VM
console.log("SNAPSHOT_ID", snapshotId);
await vm.delete(); console.log("builder deleted");
