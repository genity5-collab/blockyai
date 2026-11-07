import test from "node:test"; import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
// findItem lives in a Deno .ts file. Strip the types and import the pure function.
const src = readFileSync(new URL("../../supabase/functions/agent-plan/index.ts", import.meta.url), "utf8");
const body = src.slice(src.indexOf("export function findItem"), src.indexOf("Deno.serve")).replace(/: any\[\]|: unknown|: any \| null|: string|\(x\) =>/g, (m) => (m === "(x) =>" ? m : "")).replace(/\(items, ref\)/, "(items, ref)");
assert.ok(body.includes("function findItem") && body.length > 200, "could not extract findItem from agent-plan/index.ts");
const tmp = new URL("./.findItem.tmp.mjs", import.meta.url); writeFileSync(tmp, body.replace("items: any[], ref: unknown", "items, ref").replace("(t: string)", "(t)").replace("(items,", "(items,"));
const { findItem } = await import(tmp.href);
const items = [
  { id: 1, text: "Create ServerScriptService/Services folder structure" }, { id: 2, text: "Create ReplicatedStorage/Shared and Remotes folders" },
  { id: 3, text: "Create StarterGui/ObbyUI screen" }, { id: 4, text: "Create Workspace.TrollObby folder" }, { id: 5, text: "Build stage 1" }, { id: 6, text: "Build stage 2" },
];
test("numbers in every form", () => { for (const r of [1, "1", "#1", " 1 "]) assert.equal(findItem(items, r).id, 1); });
test("THE REPORTED FAILURE: the full item text resolves to its item", () => { assert.equal(findItem(items, "Create ServerScriptService/Services folder structure").id, 1); assert.equal(findItem(items, "Create Workspace.TrollObby folder").id, 4); });
test("case and spacing do not matter", () => assert.equal(findItem(items, "  create   starterGUI/obbyui SCREEN ").id, 3));
test("a unique fragment matches", () => assert.equal(findItem(items, "ObbyUI").id, 3));
test("an AMBIGUOUS fragment matches nothing (never guesses)", () => { assert.equal(findItem(items, "Create"), null); assert.equal(findItem(items, "Build stage"), null); });
test("unknown, empty and out-of-range refs are null", () => { for (const r of ["", "nope", 99, "#99", null, undefined]) assert.equal(findItem(items, r), null); });
