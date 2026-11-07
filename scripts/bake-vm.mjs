import { Freestyle } from "freestyle";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
const ROOT = "/app/conversations/6aeefb11bd089151b44c96ea/blockyai/agent";
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
const SHARED = ["supabase/functions/_shared/policy.js"];
await sh("mkdir -p /opt/blockyai/supabase/functions/_shared");
for (const f of SHARED) await vm.fs.writeFile("/opt/blockyai/" + f, readFileSync(ROOT + "/../" + f, "utf8"));
// tests too, but kept outside the service path, to run them here
// acceptance.test.js judges SERVER code (supabase/functions/_shared) that is not on the VM, so it stays in the repo and is not baked.
const tests = readdirSync(ROOT + "/test").filter((n) => n.endsWith(".js") && !n.startsWith(".") && n !== "acceptance.test.js");
await sh("mkdir -p /opt/blockyai/agent/test"); for (const n of tests) await vm.fs.writeFile("/opt/blockyai/agent/test/" + n, readFileSync(ROOT + "/test/" + n, "utf8"));
console.log("copied", files.length, "files +", tests.length, "tests");

// 3. templates and reference specs go where the agent can read them
await sh("mkdir -p /home/ubuntu/project/templates /home/ubuntu/project/reference && cp /opt/blockyai/agent/templates/* /home/ubuntu/project/templates/ && cp /opt/blockyai/agent/reference/* /home/ubuntu/project/reference/");

// 4. PROVE the agent loads on the VM before snapshotting
const node = await sh("node --version");
console.log("node", node.out);
const load = await sh("cd /opt/blockyai/agent && node --input-type=module -e \"const m=await import('./src/loop.js');const t=await import('./src/tools.js');console.log('SYSTEM chars',m.SYSTEM.length,'| tools',Object.keys(t.TOOLS).length,'| has build_model',!!t.TOOLS.build_model,'| has plan_create',!!t.TOOLS.plan_create)\" 2>&1");
console.log(load.out); if (load.code !== 0 || !/has build_model true/.test(load.out)) await fail("agent does not load on the VM");
const tst = await sh("cd /opt/blockyai/agent && node --test test/loop.test.js test/never-stop.test.js test/routing.test.js 2>&1 | grep -E '^ℹ (tests|pass|fail)'");
console.log(tst.out); if (!/fail 0/.test(tst.out)) await fail("agent tests fail on the VM");
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
