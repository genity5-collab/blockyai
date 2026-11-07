// Deploy edge functions to Supabase through the Management API (multipart upload). Usage: node scripts/deploy-functions.mjs [name ...]
// With no names it deploys every folder in supabase/functions except _shared. Every deploy includes the whole _shared folder.
// Needs SUPABASE_ACCESS_TOKEN. verify_jwt is off because the functions do their own token auth (client_key / plugin token / agent token).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "functions");
const P = process.env.SUPABASE_PROJECT_REF || "sqiruowyfjoctskogzjw", T = process.env.SUPABASE_ACCESS_TOKEN;
if (!T) { console.error("SUPABASE_ACCESS_TOKEN missing"); process.exit(1); }
const names = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(ROOT).filter((n) => n !== "_shared" && statSync(join(ROOT, n)).isDirectory());
const shared = readdirSync(join(ROOT, "_shared")).filter((f) => /\.(ts|js)$/.test(f));
let failed = 0;
for (const name of names) {
  const fd = new FormData();
  fd.append("metadata", JSON.stringify({ entrypoint_path: "index.ts", name, verify_jwt: false }));
  fd.append("file", new Blob([readFileSync(join(ROOT, name, "index.ts"))], { type: "application/typescript" }), "index.ts");
  for (const f of shared) fd.append("file", new Blob([readFileSync(join(ROOT, "_shared", f))], { type: "application/typescript" }), `../_shared/${f}`);
  const r = await fetch(`https://api.supabase.com/v1/projects/${P}/functions/deploy?slug=${name}`, { method: "POST", headers: { Authorization: "Bearer " + T }, body: fd });
  const t = await r.text(); const ok = r.ok; if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name} ${r.status} ${ok ? "" : t.slice(0, 200)}`);
}
process.exit(failed ? 1 : 0);
