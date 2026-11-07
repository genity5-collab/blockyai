// Parsing the model's tool calls. Three accepted forms, tried in this order of position in the text:
//
//   1. RAW-BODY (preferred; code and big specs never go through JSON escaping):
//        <tool name="roblox_write_script" path="ServerScriptService.A" class="Script"><source>
//        ...raw Lua, any characters...
//        </source></tool>
//        <tool name="build_model" parent="Workspace"><spec>{ ...JSON... }</spec></tool>
//   2. JSON:  <tool>{"name":"x","args":{...}}</tool>   (also accepted without a closing tag)
//   3. A bare ```json fence containing {"name": "<known tool prefix>_...", ...}
//
// A body element (<source>, <code>, <content>, <spec>, <find>, <replace>) ends ONLY at its own exact closing tag, so tool-call text
// inside a script is data. If the output was cut off, an unclosed body runs to the end of the text (and is flagged `unclosed`).
// parse errors are RETURNED with a position, never thrown, so the loop can send them back to the model.

export const MAX_CALLS_PER_REPLY = 6;
export const TOOL_NAME = /^(roblox_|vm_|plan_|local_|sync_mirror$|push_changed$|build_|template_|duplicate_|terrain_|lighting_|ui_|screenshot_|insert_|snap_|find_|get_|measure_|camera_|mirror$|scale_|align$|distribute$|raycast$|verify_)[A-Za-z0-9_]*$/;
const BODY_TAGS = ["source", "code", "content", "spec", "find", "replace"];
const JSON_BODY = new Set(["spec"]);                       // these bodies are parsed as JSON; the others stay text

const unq = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
function attrs(s) { const o = {}; for (const m of s.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/g)) o[m[1]] = unq(m[2]); return o; }
const coerce = (v) => (v === "true" ? true : v === "false" ? false : v !== "" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);

// Balanced {...} (respects strings/escapes). Returns {json,start,end} or null.
export function firstObject(text, from = 0) {
  const start = text.indexOf("{", from); if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) return { json: text.slice(start, i + 1), start, end: i + 1 }; }
  }
  return null;
}
// JSON.parse with the two repairs models need (trailing commas, curly quotes). Returns {ok,value} or {ok:false,error,pos}.
export function parseJsonLoose(s) {
  let firstErr = null;
  for (const attempt of [s, s.replace(/,\s*([}\]])/g, "$1"), s.replace(/[\u201c\u201d]/g, '"').replace(/,\s*([}\]])/g, "$1")]) {
    try { return { ok: true, value: JSON.parse(attempt) }; } catch (e) { firstErr ??= e; }
  }
  const m = /position (\d+)/.exec(String(firstErr?.message)); return { ok: false, error: String(firstErr?.message ?? "invalid JSON").slice(0, 160), pos: m ? Number(m[1]) : null };
}
const lineCol = (text, pos) => { if (pos == null) return ""; const before = text.slice(0, pos); const line = before.split("\n").length; const col = pos - before.lastIndexOf("\n"); return ` (line ${line}, column ${col})`; };

// One raw-body call starting at `m` (a regex match of <tool name="...") . Returns {call?, error?, end}.
function parseRawAt(text, m) {
  const tagEnd = text.indexOf(">", m.index); if (tagEnd < 0) return { error: `a <tool name="${m[1]}"> tag was never closed with ">"`, end: text.length };
  const selfClose = text[tagEnd - 1] === "/";
  const name = m[1]; const a = attrs(text.slice(m.index + 5, tagEnd)); delete a.name;
  const args = {}; for (const [k, v] of Object.entries(a)) args[k] = coerce(v);
  let pos = tagEnd + 1, end = pos, unclosed = false;
  if (!selfClose) {
    const closeTool = text.indexOf("</tool>", pos);
    // body elements, in order, each ending only at its own closing tag
    let cur = pos;
    for (;;) {
      const rest = text.slice(cur);
      const bm = /^\s*<(source|code|content|spec|find|replace)>/.exec(rest);
      if (!bm) break;
      const tag = bm[1], bodyStart = cur + bm[0].length, closeTag = `</${tag}>`;
      let bodyEnd = text.indexOf(closeTag, bodyStart), next;
      if (bodyEnd < 0) { bodyEnd = text.length; next = text.length; unclosed = true; } else next = bodyEnd + closeTag.length;
      let body = text.slice(bodyStart, bodyEnd).replace(/^\r?\n/, "").replace(/\r?\n[ \t]*$/, "");
      if (JSON_BODY.has(tag)) {
        const j = parseJsonLoose(body);
        if (!j.ok) return { error: `${name}: the <${tag}> body is not valid JSON: ${j.error}${lineCol(body, j.pos)}`, end: next };
        args[tag] = j.value;
      } else args[tag] = body;
      cur = next; if (unclosed) break;
    }
    end = cur;
    if (!unclosed) { const t = text.indexOf("</tool>", cur); end = t >= 0 && /^\s*$/.test(text.slice(cur, t)) ? t + 7 : cur; }
    void closeTool;
  }
  return { call: { name, args, form: "raw", ...(unclosed ? { unclosed: true } : {}) }, end };
}

// JSON form starting at index of "<tool>" (or a fence). Returns {call?, error?, end}.
function parseJsonAt(text, from) {
  const obj = firstObject(text, from);
  if (!obj) return { error: "no complete {...} object follows the tool tag (the output may have been cut off)", end: text.length };
  const j = parseJsonLoose(obj.json);
  if (!j.ok) return { error: `the tool call is not valid JSON: ${j.error}${lineCol(text, obj.start + (j.pos ?? 0))}`, end: obj.end };
  const v = j.value;
  if (!v || typeof v.name !== "string") return { error: 'the tool call JSON has no string "name"', end: obj.end };
  const args = v.args ?? v.arguments ?? {};
  if (args === null || typeof args !== "object" || Array.isArray(args)) return { error: `"args" for ${v.name} must be an object`, end: obj.end };
  let end = obj.end; const tail = /^\s*<\/tool>/.exec(text.slice(end)); if (tail) end += tail[0].length;
  return { call: { name: v.name, args, form: "json" }, end };
}

// Parse EVERY tool call in a reply. Never throws. Returns { calls, errors:[{message}], attempted }.
//   attempted = the text contained something that was meant to be a tool call (a <tool tag or a fenced JSON naming a tool),
//   so a reply with attempted && !calls.length is a PARSE FAILURE, not a final answer.
export function parseReply(text) {
  const calls = [], errors = []; let attempted = false, cappedAt = null;
  const s = String(text ?? ""); let i = 0;
  const OPEN = /<tool\b/gi, FENCE = /```(?:json)?\s*(?=\{[^`]*"name"\s*:\s*"(?:roblox_|vm_|plan_|build_|local_)[^`]*)/gi;
  for (let guard = 0; guard < 40 && i < s.length; guard++) {
    OPEN.lastIndex = i; FENCE.lastIndex = i;
    const a = OPEN.exec(s), f = FENCE.exec(s);
    if (!a && !f) break;
    attempted = true;
    let r;
    if (a && (!f || a.index < f.index)) {
      const raw = /^<tool\s+name\s*=\s*"([A-Za-z0-9_]+)"/i.exec(s.slice(a.index));
      if (raw) r = parseRawAt(s, { index: a.index, 1: raw[1] });
      else r = parseJsonAt(s, a.index + 5);
    } else r = parseJsonAt(s, f.index + f[0].length);
    if (r.call) {
      if (calls.length >= MAX_CALLS_PER_REPLY) { cappedAt = calls.length; break; }
      calls.push(r.call);
    } else errors.push({ message: r.error });
    i = Math.max(r.end, i + 1);
  }
  return { calls, errors, attempted, cappedAt };
}
