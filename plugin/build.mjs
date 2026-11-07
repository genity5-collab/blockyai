// Bundles plugin/src/*.luau into ONE pasteable file: dist/BlockyAI.server.lua.
// Each module becomes a local table via a function wrapper so names don't collide. No remote code, no loadstring of anything fetched.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
const MODS = { bridge: "Bridge", selftest: "SelfTest", builder: "Builder", transform: "Transform", uibuild: "UIBuild", studio_cmds: "Cmds", ui: "UI" };
let main = readFileSync("src/main.luau", "utf8");
for (const [file, name] of Object.entries(MODS)) {
  let src = readFileSync(`src/${file}.luau`, "utf8").replace(/^--!strict\n/, "");
  // remove "return X" at the end, wrap as: local Name = (function() ... return X end)()
  src = src.trimEnd();
  const wrapped = `local ${name} = (function()\n${src}\nend)()\n`;
  main = main.replace(`--@@MODULE:${file}@@`, () => wrapped);
}
if (/--@@MODULE:/.test(main)) throw new Error("unresolved module marker");
const ver = Number((main.match(/local PLUGIN_VERSION = (\d+)/) || [])[1]);
if (!ver) throw new Error("PLUGIN_VERSION not found in src/main.luau");
mkdirSync("dist", { recursive: true });
writeFileSync("dist/BlockyAI.server.lua", main);
// One source of truth: the site serves exactly this file and shows exactly this version.
if (existsSync("../web-src/public")) {
  copyFileSync("dist/BlockyAI.server.lua", "../web-src/public/BlockyAI.lua");
  writeFileSync("../web-src/public/plugin-version.json", JSON.stringify({ version: ver, bytes: Buffer.byteLength(main), lines: main.split("\n").length, built_at: new Date().toISOString() }));
}
console.log("wrote dist/BlockyAI.server.lua", main.split("\n").length, "lines", Buffer.byteLength(main), "bytes");
