// Checks every reference spec against what the plugin's build_model really supports.
import { readFileSync, readdirSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, join } from "node:path";
const dir = dirname(fileURLToPath(import.meta.url));
const OK = new Set(["Part","WedgePart","CornerWedgePart","TrussPart","MeshPart","Seat","VehicleSeat","SpawnLocation","Script","LocalScript","ModuleScript","WeldConstraint","Motor6D","HingeConstraint","PointLight","SpotLight","SurfaceLight","ParticleEmitter","Sound","Attachment","Decal","Texture","SurfaceGui","SpecialMesh","ProximityPrompt","ClickDetector","Folder","Model","BillboardGui","TextLabel","Frame","UnionOperation","BoolValue","IntValue","NumberValue","StringValue","ObjectValue"]);
const MATS = new Set(["Plastic","SmoothPlastic","Wood","Metal","Glass","Neon","Concrete","Grass","Brick","Slate","Fabric","Cobblestone","Granite","Marble","Sand","Ice","Rubber","Foil","Pebble","WoodPlanks","DiamondPlate","CorrodedMetal","Asphalt","Cardboard"]);
let bad = 0;
export function check(spec, path = "") {
  const errs = []; const names = new Set();
  const walk = (n, p) => {
    const where = `${p}/${n.name}`;
    if (!n.name) errs.push(`${where}: no name`);
    if (!OK.has(n.class ?? "Part")) errs.push(`${where}: class ${n.class} unsupported`);
    if (n.material && !MATS.has(n.material)) errs.push(`${where}: unknown material ${n.material}`);
    if (n.size && (!Array.isArray(n.size) || n.size.length !== 3 || n.size.some((v) => !(v > 0)))) errs.push(`${where}: bad size ${JSON.stringify(n.size)}`);
    if (n.position && (!Array.isArray(n.position) || n.position.length !== 3)) errs.push(`${where}: bad position`);
    if (n.color && !/^#[0-9A-Fa-f]{6}$/.test(n.color)) errs.push(`${where}: bad color ${n.color}`);
    if (["Script","LocalScript","ModuleScript"].includes(n.class) && typeof n.source !== "string") errs.push(`${where}: script without source`);
    if (n.class === "MeshPart") errs.push(`${where}: MeshPart cannot be built from a spec`);
    names.add(n.name); for (const c of n.children ?? []) walk(c, where);
  };
  walk(spec, path);
  if (spec.primary_part && !names.has(spec.primary_part)) errs.push(`primary_part ${spec.primary_part} not found`);
  const count = (n) => 1 + (n.children ?? []).reduce((a, c) => a + count(c), 0);
  return { errs, count: count(spec) };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const { errs, count } = check(JSON.parse(readFileSync(join(dir, f), "utf8")));
    console.log(`${errs.length ? "FAIL" : "ok  "} ${f.padEnd(16)} ${String(count).padStart(3)} instances${errs.length ? "\n   " + errs.join("\n   ") : ""}`); bad += errs.length;
  }
  process.exit(bad ? 1 : 0);
}
