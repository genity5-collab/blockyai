// The VM gets agent/ plus a short list of shared server files. If the agent imports anything else from outside agent/, it would crash on the VM.
import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync, readdirSync } from "node:fs"; import { join, resolve, relative, dirname } from "node:path";
const AGENT = resolve(import.meta.dirname, ".."), REPO = resolve(AGENT, "..");
const SHARED = (readFileSync(join(REPO, "scripts/bake-vm.mjs"), "utf8").match(/const SHARED = \[([^\]]*)\]/)?.[1] ?? "").match(/"([^"]+)"/g)?.map((x) => x.slice(1, -1)) ?? [];

test("[mock] the bake script ships every shared file the agent imports from outside agent/", () => {
  const outside = new Set();
  for (const f of readdirSync(join(AGENT, "src")).filter((n) => n.endsWith(".js"))) {
    for (const m of readFileSync(join(AGENT, "src", f), "utf8").matchAll(/from\s+"(\.[^"]+)"/g)) {
      const target = resolve(AGENT, "src", m[1]);
      if (!target.startsWith(AGENT + "/")) outside.add(relative(REPO, target));
    }
  }
  assert.ok(outside.size > 0, "expected at least policy.js");
  for (const t of outside) assert.ok(SHARED.includes(t), `agent imports ${t} but scripts/bake-vm.mjs does not ship it: the agent would crash on the VM`);
});
test("[mock] every shared file shipped to the VM is self-contained (no imports of its own)", () => {
  for (const f of SHARED) assert.ok(!/^\s*import\s/m.test(readFileSync(join(REPO, f), "utf8")), `${f} has its own imports, which would also need shipping`);
});
