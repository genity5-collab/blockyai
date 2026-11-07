// Runs the plugin Luau tests on a real Freestyle VM (the only place with the luau runtime). Usage: node run-tests.mjs <test-file>
import { Freestyle } from "freestyle"; import { readFileSync, readdirSync } from "fs";
const f = new Freestyle({ apiKey: process.env.FREESTYLE_API_KEY });
const snap = process.env.BLOCKYAI_SNAPSHOT_ID || "sh-adfbc3e3a77940c8a1cc4d5ddf6d69bd";
const { vm } = await f.vms.create({ snapshotId: snap, ttlSeconds: 600, idleTimeoutSeconds: 120, firewall: { rules: [] } });
const sh = async (c) => { const r = await vm.exec(c); return { out: ((r.stdout ?? "") + (r.stderr ?? "")).trim(), code: r.exitCode ?? r.statusCode }; };
let bad = false;
try {
  await sh("mkdir -p /tmp/p/src /tmp/p/test");
  for (const d of ["src", "test"]) for (const file of readdirSync(d)) if (file.endsWith(".luau")) await vm.fs.writeFile(`/tmp/p/${d}/${file}`, readFileSync(`${d}/${file}`, "utf8"));
  // wrap each src module as a string-returning module for the loadstring-based loader
  const mods = readdirSync("src").filter((x) => x.endsWith(".luau")).map((x) => x.replace(".luau", ""));
  for (const m of mods) await vm.fs.writeFile(`/tmp/p/test/${m}_src.luau`, "return [==========[" + readFileSync(`src/${m}.luau`, "utf8") + "]==========]\n");
  // JSON reference specs -> a Luau table module (plain luau has no JSON decoder; this keeps the parser out of the code under test)
  const lua = (v) => v === null ? "nil" : typeof v === "string" ? JSON.stringify(v).replace(/\$/g, "$") : Array.isArray(v) ? "{" + v.map(lua).join(",") + "}" : typeof v === "object" ? "{" + Object.entries(v).map(([k, x]) => `[${JSON.stringify(k)}]=${lua(x)}`).join(",") + "}" : String(v);
  try {
    const refDir = "../agent/reference"; const data = {};
    for (const f of readdirSync(refDir)) if (f.endsWith(".json")) data[f.replace(".json", "")] = JSON.parse(readFileSync(`${refDir}/${f}`, "utf8"));
    await vm.fs.writeFile("/tmp/p/test/reference_data.luau", "return " + lua(data) + "\n");
  } catch {}
  for (const t of process.argv.slice(2)) {
    const r = await sh(`cd /tmp/p && luau test/${t} > /tmp/out.txt 2>&1; RC=$?; tail -60 /tmp/out.txt; exit $RC`);
    console.log(`$ luau test/${t}  [exit ${r.code}]\n${r.out}\n`);
    if (r.code !== 0 || /FAIL|error/i.test(r.out)) bad = true;
  }
} finally { await vm.delete().catch(() => {}); }
process.exit(bad ? 1 : 0);
