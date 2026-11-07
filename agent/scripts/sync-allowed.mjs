// Regenerates test/allowed.js from the server allowlist so tests always check the REAL list.
import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync(new URL("../../supabase/functions/_shared/lib.ts", import.meta.url), "utf8");
const block = src.slice(src.indexOf("export const ALLOWED = new Set(["), src.indexOf("export const DESTRUCTIVE"));
const names = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
writeFileSync(new URL("../test/allowed.js", import.meta.url), `// GENERATED from supabase/functions/_shared/lib.ts ALLOWED. Regenerate with: node scripts/sync-allowed.mjs\nexport const ALLOWED_PLUGIN_COMMANDS = new Set(${JSON.stringify(names)});\n`);
console.log(names.length, "commands");
