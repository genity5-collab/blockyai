// Build-capable tools. Each one maps to a plugin command and returns the plugin's real counts/paths/errors.
// Nothing here returns a bare "done": a missing field in the plugin's answer is reported as a failure, never invented.
import { run } from "./tools.js";
import { api } from "./api.js";

export const MAX_SPEC_INSTANCES = 1500;
export const SECTION_LIMIT = 500;

export function countSpec(spec) {
  if (!spec || typeof spec !== "object") return 0;
  let n = 1;
  for (const c of Array.isArray(spec.children) ? spec.children : []) n += countSpec(c);
  return n;
}

// Spec over 500 instances is split by top-level child groups. The first call creates the root (with its first chunk);
// later calls build the remaining chunks as named sections under the same root, so one model is still produced.
export function splitSpec(spec, limit = SECTION_LIMIT) {
  if (countSpec(spec) <= limit) return [spec];
  const kids = Array.isArray(spec.children) ? spec.children : [];
  const chunks = []; let cur = [], curN = 0;
  for (const k of kids) {
    const n = countSpec(k);
    if (curN + n > limit && cur.length) { chunks.push(cur); cur = []; curN = 0; }
    cur.push(k); curN += n;
  }
  if (cur.length) chunks.push(cur);
  // An individual child bigger than the limit cannot be split further here: report it instead of silently failing.
  const tooBig = kids.filter((k) => countSpec(k) > limit).map((k) => k.name);
  const parts = chunks.map((c, i) => ({ ...spec, children: c, ...(i > 0 ? { __section: true } : {}) }));
  if (tooBig.length) parts.tooBig = tooBig;
  return parts;
}

const need = (a, ...keys) => keys.filter((k) => a?.[k] == null || a[k] === "").map((k) => `${k} is required`).join("; ");

// Resolve "$1.path" style references against earlier batch results.
export function resolveRefs(value, results) {
  if (typeof value === "string") {
    const whole = value.match(/^\$(\d+)\.([A-Za-z0-9_.\[\]]+)$/);
    const get = (n, path) => {
      const r = results[Number(n) - 1];
      if (!r) throw new Error(`reference $${n} points to a step that has not run`);
      if (!r.ok) throw new Error(`reference $${n} points to a step that failed`);
      let v = r.result;
      for (const p of path.split(".")) { if (v == null) break; v = v[p]; }
      if (v === undefined) throw new Error(`reference $${n}.${path} does not exist in that result`);
      return v;
    };
    if (whole) return get(whole[1], whole[2]);                       // whole-value reference keeps its type (number, array, object)
    return value.replace(/\$(\d+)\.([A-Za-z0-9_.]+)/g, (_, n, p) => String(get(n, p)));
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, results));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, results)]));
  return value;
}

// batch_refs: run steps in order; each step may reference earlier results. Stops at the first failure and says which step.
export async function batchRefs(a, exec = run) {
  const steps = Array.isArray(a?.steps) ? a.steps : null;
  if (!steps || !steps.length) return { ok: false, error: "steps must be a non-empty list of {type, payload}" };
  if (steps.length > 40) return { ok: false, error: "at most 40 steps per batch_refs call" };
  const results = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s?.type) return { ok: false, error: `step ${i + 1} has no type`, completed: results.length, results: results.map(brief) };
    let payload;
    try { payload = resolveRefs(s.payload ?? {}, results); } catch (e) { return { ok: false, error: `step ${i + 1} (${s.type}): ${e.message}`, completed: results.length, results: results.map(brief) }; }
    const r = await exec(s.type, payload);
    results.push(r);
    if (!r.ok) return { ok: false, error: `step ${i + 1} (${s.type}) failed: ${r.error}`, completed: i, results: results.map(brief) };
  }
  return { ok: true, result: { steps: results.length, results: results.map(brief) } };
}
const brief = (r) => ({ ok: r.ok, ...(r.ok ? { result: typeof r.result === "string" ? r.result.slice(0, 200) : r.result } : { error: r.error }) });

// build_model with automatic sectioning. Returns a combined, honest summary.
export async function buildModel(a, exec = run) {
  const miss = need(a, "spec"); if (miss) return { ok: false, error: miss };
  const total = countSpec(a.spec);
  if (!a.spec.name) return { ok: false, error: "spec.name is required" };
  if (total > MAX_SPEC_INSTANCES * 4) return { ok: false, error: `spec has ${total} instances; split it into separate models yourself (limit ${MAX_SPEC_INSTANCES * 4})` };
  const parts = splitSpec(a.spec);
  if (parts.tooBig) return { ok: false, error: `these children are larger than ${SECTION_LIMIT} instances on their own and cannot be split automatically: ${parts.tooBig.join(", ")}. Break each into smaller sub-models.` };
  const out = { sections: parts.length, instances: 0, parts: 0, errors: [], paths: [] };
  for (let i = 0; i < parts.length; i++) {
    const spec = { ...parts[i] }; delete spec.__section;
    // later sections are built as a sibling model named "<name>_part<i>" so the first call's root stays intact; the agent can then merge by move
    if (i > 0) spec.name = `${a.spec.name}_part${i + 1}`;
    const r = await exec("build_model", { parent: a.parent ?? "Workspace", spec, origin: a.origin, allow_scripts: a.allow_scripts });
    if (!r.ok) return { ok: false, error: `section ${i + 1}/${parts.length} failed: ${r.error}`, built_so_far: out };
    const x = r.result ?? {};
    if (typeof x.instances !== "number") return { ok: false, error: "plugin returned no instance count. Update the plugin (the build_model command may be missing).", raw: x };
    out.instances += x.instances; out.parts += x.parts ?? 0; out.paths.push(x.path);
    if (i === 0) { out.primary_part = x.primary_part; out.bounding_box = x.bounding_box; out.by_class = x.by_class; }
    for (const e of x.errors ?? []) out.errors.push(e);
  }
  out.error_count = out.errors.length; out.errors = out.errors.slice(0, 25);
  if (parts.length > 1) out.note = `Built in ${parts.length} sections (siblings named *_partN). Merge them or keep them as sub-assemblies.`;
  return { ok: true, result: out };
}

const pass = (type) => (a) => run(type, a ?? {});

export const BUILD_TOOLS = {
  build_model:        { args: "{parent?, spec:{name,class,children:[...],primary_part?,weld?}, origin?:[x,y,z]}  builds a WHOLE hierarchy; returns instances, parts, bounding_box, errors. See the building guide.", fn: (a) => buildModel(a) },
  build_from_template:{ args: "{template, name?, position?, rotation?, color?, parent?}  load a saved template by name (server copy) and build it", fn: async (a) => {
      const miss = need(a, "template"); if (miss) return { ok: false, error: miss };
      const t = await api.template("load", { name: a.template });
      if (!t?.spec) return { ok: false, error: `template '${a.template}' not found` };
      return run("build_from_template", { ...a, spec: t.spec }); } },
  template_save:      { args: "{name, path?|spec?, description?}  save a model (by path) or a spec as a reusable template", fn: async (a) => {
      const miss = need(a, "name"); if (miss) return { ok: false, error: miss };
      let spec = a.spec;
      if (!spec) { const r = await run("template_save", { name: a.name, path: a.path }); if (!r.ok) return r; const l = await run("template_load", { name: a.name }); if (!l.ok) return l; spec = l.result.spec; }
      const n = countSpec(spec);
      const s = await api.template("save", { name: a.name, spec, description: a.description, instance_count: n });
      return s?.error ? { ok: false, error: s.error } : { ok: true, result: { saved: a.name, instances: n } }; } },
  template_load:      { args: "{name}  returns the saved spec so you can read or adapt it", fn: async (a) => { const t = await api.template("load", { name: a.name }); return t?.spec ? { ok: true, result: { name: a.name, instances: countSpec(t.spec), spec: t.spec } } : { ok: false, error: `template '${a.name}' not found` }; } },
  duplicate_array:    { args: "{path, count, offset:[x,y,z]}", fn: pass("duplicate_array") },
  duplicate_grid:     { args: "{path, nx, nz, dx, dz, ny?, dy?}", fn: pass("duplicate_grid") },
  duplicate_along_path:{ args: "{path, points:[[x,y,z],...], count}", fn: pass("duplicate_along_path") },
  mirror:             { args: "{path, axis:'X'|'Y'|'Z', at?}  creates a mirrored COPY (positions reflect; wedge orientations may need rotating)", fn: pass("mirror") },
  scale_model:        { args: "{path, factor}", fn: pass("scale_model") },
  align:              { args: "{paths:[...], axis, mode:'min'|'center'|'max'}", fn: pass("align") },
  distribute:         { args: "{paths:[...], axis}", fn: pass("distribute") },
  snap_to_ground:     { args: "{paths:[...], offset?}  raycasts down and rests each item on what it hits; misses are reported, not moved", fn: pass("snap_to_ground") },
  get_bounding_box:   { args: "{path}", fn: pass("get_bounding_box") },
  get_pivot:          { args: "{path}", fn: pass("get_pivot") },
  raycast:            { args: "{origin:[x,y,z], direction:[x,y,z]}", fn: pass("raycast") },
  find_empty_space:   { args: "{size:[x,y,z], area:{min:[x,y,z],max:[x,y,z]}, step?}", fn: pass("find_empty_space") },
  measure_distance:   { args: "{a, b}  center distance, per-axis gap, overlapping?", fn: pass("measure_distance") },
  camera_set:         { args: "{position:[x,y,z], look_at:[x,y,z], fov?}  point the viewport camera before a screenshot", fn: pass("camera_set") },
  screenshot_multi:   { args: "{path, angles?:['front','side','top','three_quarter','back','left']}  real viewport PNGs from several angles (needs user permission in Studio); falls back honestly", fn: pass("screenshot_multi") },
  terrain_fill:       { args: "{shape:'block'|'ball'|'cylinder'|'wedge', material, center, size?|radius?|height?}", fn: pass("terrain_fill") },
  terrain_heightmap:  { args: "{heights:[[...]], cell?, base_y?, depth?, material?, snow_above?, rock_above?, origin?}  compute heights in the VM first", fn: pass("terrain_heightmap") },
  lighting_set:       { args: "{lighting?:{}, time_of_day?, atmosphere?, sky?, bloom?, color_correction?, sun_rays?, clouds?}", fn: pass("lighting_set") },
  ui_build:           { args: "{parent?, spec:{name, children:[{class,name,size,position,color,text,corner,stroke,layout,children}]}}  JSON to ScreenGui", fn: (a) => { const miss = need(a, "spec"); return miss ? { ok: false, error: miss } : run("ui_build", { parent: a.parent ?? "StarterGui", spec: a.spec }); } },
  insert_asset:       { args: "{asset_id, parent?, remove_scripts?=true}  inserts a Toolbox asset; ALWAYS reports scripts found inside. Ids can be unavailable or unsafe.", fn: pass("insert_asset") },
  batch_refs:         { args: "{steps:[{type,payload}]}  run Studio commands in order; later payloads may use \"$1.path\" to reference step 1's result", fn: (a) => batchRefs(a) },
};
