// The service entry point (src/index.js) is the file systemd runs on every VM. A bad import there crashed every new session's agent while all
// other tests passed, because none of them loaded it. These tests start the REAL files in REAL child processes.
import test from "node:test"; import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AGENT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = { ...process.env, BLOCKY_API: "https://127.0.0.1:9", BLOCKY_AGENT_TOKEN: "entry-test", BLOCKY_SESSION_ID: "entry-test" };

// Run node with args for up to `ms`; resolve with the exit code (null if we had to kill it = it was still running = healthy) and all output.
const run = (args, ms) => new Promise((resolve) => {
  const p = spawn(process.execPath, args, { cwd: AGENT, env: ENV }); let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  const t = setTimeout(() => p.kill("SIGKILL"), ms);
  p.on("exit", (code, sig) => { clearTimeout(t); resolve({ code, killed: sig === "SIGKILL", out }); });
});
const MODULE_ERRORS = /SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export|Cannot find module|ReferenceError|before initialization/;

test("entry: src/index.js starts and keeps running (it idles, polling for messages)", async () => {
  const r = await run(["src/index.js"], 3000);
  assert.equal(r.killed, true, "it must still be alive when we stop it, but it exited with code " + r.code + ":\n" + r.out.slice(0, 600));
  assert.doesNotMatch(r.out, MODULE_ERRORS);
  assert.match(r.out, /\[blockyai-agent\] started/);
});

test("entry: it really enters the polling loop (not just printing a banner)", async () => {
  const r = await run(["src/index.js"], 3500);
  assert.match(r.out, /tick fetch failed|messages:/, "expected at least one poll attempt against the unreachable test address:\n" + r.out.slice(0, 400));
});

test("circular import: tools-vm.js loaded on its own does not crash (only the reverse order inside index.js did)", async () => {
  // Loading tools-vm.js first pulls in tools.js, which finishes loading while tools-vm.js is still empty. That is fine when nothing reads
  // VM_EXTRA_TOOLS during load. If this ever starts failing, the cycle got worse and index.js must keep importing tools.js first.
  const r = await run(["--input-type=module", "-e", "await import('./src/tools-vm.js'); console.log('LOADED')"], 8000);
  assert.match(r.out, /LOADED|before initialization/, "unexpected failure:\n" + r.out.slice(0, 400));
  assert.doesNotMatch(r.out, /SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export|Cannot find module/);
});

test("circular import: tools.js first, then tools-vm.js, gives a full tool set including the VM tools", async () => {
  const r = await run(["--input-type=module", "-e", "const t=await import('./src/tools.js'); await import('./src/tools-vm.js'); console.log('N='+Object.keys(t.TOOLS).length, 'HAS='+['vm_memory_note','vm_run_luau','vm_web_fetch'].every(k=>k in t.TOOLS), 'WORK='+t.WORK)"], 8000);
  assert.doesNotMatch(r.out, MODULE_ERRORS, r.out.slice(0, 400));
  assert.match(r.out, /HAS=true/, r.out); assert.match(r.out, /WORK=\/home\/ubuntu\/project/);
});

test("entry: WORK comes from tools.js (the module that defines it), and index.js no longer imports it from tools-vm.js", async () => {
  const { readFile } = await import("node:fs/promises"); const src = await readFile(join(AGENT, "src/index.js"), "utf8");
  assert.match(src, /import \{ WORK \} from "\.\/tools\.js"/);
  assert.doesNotMatch(src, /import \{[^}]*WORK[^}]*\} from "\.\/tools-vm\.js"/);
  const iTools = src.indexOf('from "./tools.js"'), iVm = src.indexOf('from "./tools-vm.js"');
  assert.ok(iTools > 0 && iVm > 0 && iTools < iVm, "tools.js must be imported before tools-vm.js");
});
