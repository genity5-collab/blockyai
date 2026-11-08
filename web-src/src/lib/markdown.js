// Tiny, SAFE markdown parser for chat replies. It returns plain data (blocks and inline spans), never HTML.
// React renders the result as TEXT, so nothing the AI (or text read from a game) says can inject markup or run.
// Supported: fenced code (```lang), headings (#..######), bullet and numbered lists, quotes, hr, paragraphs,
// and inline **bold**, *italic*, `code`, [text](http/https link), and bare http/https links.

const SAFE_URL = /^https?:\/\/[^\s<>"')]+$/i;
export const safeUrl = (u) => (SAFE_URL.test(String(u).trim()) ? String(u).trim() : null);

export function parseInline(src) {
  const out = []; let s = String(src ?? ""); let buf = "";
  const flush = () => { if (buf) { out.push({ t: "text", v: buf }); buf = ""; } };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "`") { const j = s.indexOf("`", i + 1); if (j > i + 1) { flush(); out.push({ t: "code", v: s.slice(i + 1, j) }); i = j + 1; continue; } }
    if (c === "*" && s[i + 1] === "*") { const j = s.indexOf("**", i + 2); if (j > i + 2) { flush(); out.push({ t: "bold", c: parseInline(s.slice(i + 2, j)) }); i = j + 2; continue; } }
    if ((c === "*" || c === "_") && s[i + 1] && !/\s/.test(s[i + 1]) && (i === 0 || /[\s(]/.test(s[i - 1]))) {
      const j = s.indexOf(c, i + 1); if (j > i + 1 && !/\s/.test(s[j - 1]) && (j + 1 >= s.length || /[\s).,;:!?]/.test(s[j + 1]))) { flush(); out.push({ t: "em", c: parseInline(s.slice(i + 1, j)) }); i = j + 1; continue; } }
    if (c === "[") { const m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(s.slice(i)); if (m) { const u = safeUrl(m[2]); flush(); if (u) out.push({ t: "link", href: u, c: parseInline(m[1]) }); else out.push({ t: "text", v: m[1] }); i += m[0].length; continue; } }
    if (c === "h" && /^https?:\/\//i.test(s.slice(i, i + 8))) { const m = /^https?:\/\/[^\s<>"')]+/i.exec(s.slice(i)); if (m) { const tail = /[.,;:!?]+$/.exec(m[0]); const url = tail ? m[0].slice(0, -tail[0].length) : m[0]; const u = safeUrl(url); if (u) { flush(); out.push({ t: "link", href: u, c: [{ t: "text", v: url }] }); i += url.length; continue; } } }
    buf += c; i++;
  }
  flush(); return out;
}

export function parseBlocks(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n"); const blocks = []; let i = 0; let para = [];
  const endPara = () => { if (para.length) { blocks.push({ t: "p", c: parseInline(para.join("\n")) }); para = []; } };
  while (i < lines.length) {
    const ln = lines[i]; const fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(ln);
    if (fence) { endPara(); const mark = fence[1][0].repeat(fence[1].length); const body = []; i++;
      while (i < lines.length && !new RegExp("^\\s*" + mark[0] + "{" + mark.length + ",}\\s*$").test(lines[i])) { body.push(lines[i]); i++; }
      const closed = i < lines.length; i++;                                   // an unclosed fence (a reply that is still streaming) is shown as code so far
      blocks.push({ t: "code", lang: fence[2] || "", v: body.join("\n"), open: !closed }); continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(ln); if (h) { endPara(); blocks.push({ t: "h", n: Math.min(h[1].length, 4), c: parseInline(h[2]) }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) { endPara(); blocks.push({ t: "hr" }); i++; continue; }
    if (/^\s*>\s?/.test(ln)) { endPara(); const q = []; while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, "")); i++; } blocks.push({ t: "quote", c: parseInline(q.join("\n")) }); continue; }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(ln);
    if (li) { endPara(); const ordered = /\d/.test(li[2]); const items = [];
      while (i < lines.length) { const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]); if (!m || /\d/.test(m[2]) !== ordered) break; items.push({ c: parseInline(m[3]), depth: Math.min(Math.floor(m[1].length / 2), 3) }); i++; }
      blocks.push({ t: ordered ? "ol" : "ul", items }); continue; }
    if (!ln.trim()) { endPara(); i++; continue; }
    para.push(ln); i++;
  }
  endPara(); return blocks;
}

// Plain text length of a parsed message, used so the typewriter can reveal a rendered message without cutting markup in half.
export function textLen(blocks) { const inl = (a) => a.reduce((n, x) => n + (x.v ? x.v.length : x.c ? inl(x.c) : 0), 0); return blocks.reduce((n, b) => n + (b.t === "code" ? b.v.length : b.items ? b.items.reduce((m, it) => m + inl(it.c), 0) : b.c ? inl(b.c) : 0), 0); }

// Returns a copy of the parsed blocks cut to `n` visible characters (for the typing effect). Pure data in, pure data out.
export function truncateBlocks(blocks, n) {
  let left = n; const out = [];
  const inl = (arr) => { const r = []; for (const x of arr) { if (left <= 0) break;
    if (x.t === "text" || x.t === "code") { const v = x.v.slice(0, left); left -= v.length; r.push({ ...x, v }); }
    else if (x.c) { const c = inl(x.c); if (c.length) r.push({ ...x, c }); } else r.push(x); } return r; };
  for (const b of blocks) {
    if (left <= 0) break;
    if (b.t === "code") { const v = b.v.slice(0, left); left -= v.length; out.push({ ...b, v, open: b.open || v.length < b.v.length }); }
    else if (b.items) { const items = []; for (const it of b.items) { if (left <= 0) break; const c = inl(it.c); if (c.length) items.push({ ...it, c }); } if (items.length) out.push({ ...b, items }); }
    else if (b.c) { const c = inl(b.c); if (c.length) out.push({ ...b, c }); }
    else out.push(b);
  }
  return out;
}
