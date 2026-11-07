// Two protections against the model destroying a script it never fully saw:
//
//   1. windowText: any text shown to the model that is cut says so LOUDLY, with the exact range left and how to read the rest.
//   2. ScriptGuard: overwriting an EXISTING script needs base_hash = the hash of the script's FULL text from the last complete read.
//      A partial read cannot unlock an overwrite. A stale hash (the script changed since) is refused.
//
// This lives in the agent (code), not in a prompt, so the model cannot talk its way past it. It does not replace the plugin; it only
// decides whether the agent may send a write.
import { createHash } from "node:crypto";

export const sha = (text) => createHash("sha256").update(String(text)).digest("hex").slice(0, 16);
export const DEFAULT_WINDOW = 6000;
export const TRUNC_MARK = "[truncated";

const toInt = (v, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : d; };

// Cut `text` to a window. Returns { text, total, offset, truncated, next_offset, marker }.
export function windowText(text, { offset = 0, limit = DEFAULT_WINDOW } = {}) {
  const t = String(text ?? ""); const total = t.length;
  const off = Math.max(0, Math.min(toInt(offset, 0), total));
  let lim = toInt(limit, DEFAULT_WINDOW); if (lim <= 0) lim = DEFAULT_WINDOW; lim = Math.min(lim, 200_000);
  const end = Math.min(total, off + lim);
  const truncated = end < total;
  const marker = truncated ? `[truncated ${total - end} of ${total} chars, use offset=${end} (and limit) to read the rest]` : "";
  return { text: t.slice(off, end), total, offset: off, truncated, next_offset: truncated ? end : null, marker };
}

// Normalise a Studio path so Game.X, game/X, X.Y and "x/y" compare equal.
const key = (p) => String(p ?? "").replace(/^(game|datamodel)[./]/i, "").replace(/[./]+/g, ".").replace(/^\.|\.$/g, "").toLowerCase();

export class ScriptGuard {
  constructor() { this.known = new Map(); }          // key -> { hash, complete, nextOffset }
  // Record a read of the WHOLE script (complete:true) or of part of it. Returns the hash of the full text.
  recordRead(path, fullText, { complete }) {
    const h = sha(fullText); this.known.set(key(path), { hash: h, complete: !!complete }); return h;
  }
  // Windowed read: the read is complete once a window reaches the end AND the windows so far were contiguous from 0.
  recordWindow(path, fullText, { offset, next_offset, truncated }) {
    const k = key(path), h = sha(fullText); const cur = this.known.get(k);
    const contiguous = offset === 0 ? true : cur && cur.hash === h && cur.upTo === offset;
    this.known.set(k, { hash: h, complete: !truncated && contiguous, upTo: truncated ? next_offset : null });
    return h;
  }
  recordWrite(path, newText) { const h = sha(newText); this.known.set(key(path), { hash: h, complete: true }); return h; }
  currentHash(path) { return this.known.get(key(path))?.hash; }
  forget(path) { this.known.delete(key(path)); }
  // May the agent overwrite `path`? exists = the script is already in Studio.
  checkWrite(path, { exists, base_hash }) {
    if (!exists) return { ok: true };
    const k = this.known.get(key(path));
    const how = "Call roblox_read_script on this path (read ALL of it; use offset/limit if it says truncated) and pass the returned hash as base_hash.";
    if (!base_hash) return { ok: false, error: `REFUSED: ${path} already exists and no base_hash was given. Overwriting a script you have not fully read can destroy code. ${how}` };
    if (!k) return { ok: false, error: `REFUSED: base_hash was given but ${path} has not been read in this session. ${how}` };
    if (!k.complete) return { ok: false, error: `REFUSED: only part of ${path} has been read. Overwriting needs the whole script: keep reading with offset until nothing is truncated. ${how}` };
    if (String(base_hash) !== k.hash) return { ok: false, error: `REFUSED: base_hash is stale or wrong (the script changed since you read it, or the hash is invented). ${how}` };
    return { ok: true };
  }
}
