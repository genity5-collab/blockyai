// Pure helpers for the web tools: decide whether a URL/IP is safe to fetch from the VM, and turn HTML into plain text.
// The VM can reach the internet. It must never be talked into reaching ITSELF or a private network (cloud metadata, localhost services,
// the Supabase/Freestyle control plane on a private address), so every URL and every redirect hop goes through these checks first.
import { isIP } from "node:net";

const v4 = (s) => s.split(".").map(Number);
function publicV4(s) {
  const [a, b, c] = v4(s);
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;       // carrier-grade NAT
  if (a === 169 && b === 254) return false;                 // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a >= 224) return false;                               // multicast, reserved, broadcast
  return true;
}
function publicV6(s) {
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return publicV4(m[1]);
  const h = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (h) { const x = parseInt(h[1], 16), y = parseInt(h[2], 16); return publicV4(`${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`); }
  if (s === "::" || s === "::1") return false;
  const first = parseInt(s.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return false;            // unique local
  if ((first & 0xffc0) === 0xfe80) return false;            // link-local
  if ((first & 0xff00) === 0xff00) return false;            // multicast
  return true;
}
export function isPublicIp(ip) {
  const s = String(ip ?? "").trim().toLowerCase(); const v = isIP(s);
  return v === 4 ? publicV4(s) : v === 6 ? publicV6(s) : false;
}

const ALLOWED_PORTS = [80, 443, 8080, 8443];
// Throws a message the model can act on. allowHost(host, port) is for tests only: it exempts ONE local test server while every other rule stays on.
export function parseWebUrl(raw, { allowHost = null } = {}) {
  let u; try { u = new URL(String(raw ?? "").trim()); } catch { throw new Error("not a valid URL (use a full https://... address)"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`only http and https URLs are allowed (got ${u.protocol})`);
  if (u.username || u.password) throw new Error("URLs with a username or password are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new Error("the URL has no host");
  const port0 = u.port ? Number(u.port) : (u.protocol === "https:" ? 443 : 80);
  if (typeof allowHost === "function" && allowHost(host, port0)) return u;
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) throw new Error(`refused: ${host} is not a public internet host`);
  if (isIP(host) === 0 && !host.includes(".")) throw new Error(`refused: ${host} is not a public internet host`);
  if (isIP(host) !== 0 && !isPublicIp(host)) throw new Error(`refused: ${host} is a private or reserved address`);
  const port = port0;
  if (!ALLOWED_PORTS.includes(port)) throw new Error(`refused: port ${port} is not allowed (use 80, 443, 8080 or 8443)`);
  return u;
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " "; }
  return ENT[e.toLowerCase()] ?? m;
});
// HTML -> readable text. Tags are removed BEFORE entities are decoded, so "&lt;script&gt;" stays harmless text.
export function htmlToText(html) {
  let s = String(html ?? "");
  s = s.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/pre|\/section|\/article|\/table)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ");
  return decode(s).replace(/[ \t\f\v\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function extractTitle(html) { const m = String(html ?? "").match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m ? htmlToText(m[1]).slice(0, 200) : ""; }

// DuckDuckGo's HTML results page -> [{title,url,snippet}]. Returns {blocked:true} when the page is a bot check instead of results.
export function parseDdgHtml(html, max = 8) {
  const h = String(html ?? "");
  const anchors = [...h.matchAll(/<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi)];
  if (!anchors.length) return { results: [], blocked: /anomaly|captcha|unusual traffic|challenge-form/i.test(h) };
  const results = [];
  for (let i = 0; i < anchors.length && results.length < max; i++) {
    const a = anchors[i]; const tag = a[0];
    const href = (tag.match(/\bhref="([^"]+)"/i) || [])[1]; if (!href) continue;
    let url = decode(href); if (url.startsWith("//")) url = "https:" + url;
    try { const u = new URL(url); if (/(^|\.)duckduckgo\.com$/.test(u.hostname)) { if (u.pathname.startsWith("/y.js")) continue; const t = u.searchParams.get("uddg"); if (!t) continue; url = t; } } catch { continue; }
    if (!/^https?:\/\//i.test(url)) continue;
    const end = i + 1 < anchors.length ? anchors[i + 1].index : h.length;
    const seg = h.slice(a.index + tag.length, end);
    const sn = seg.match(/<a\b[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    results.push({ title: htmlToText(tag).slice(0, 200), url, snippet: sn ? htmlToText(sn[1]).slice(0, 300) : "" });
  }
  return { results, blocked: false };
}
